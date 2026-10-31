import { supabase } from "../../lib/supabase/client.js";
import { sendAnnouncementPush } from "../../lib/fcm/index.js";
import { getEnv } from "../../lib/utils/env.js";

export default async function handler(req: any, res?: any) {
  const isWeb = typeof req.headers?.get === "function";

  const send = (code: number, body: any) => {
    if (res && typeof res.status === "function") {
      return res.status(code).json(body);
    }
    return new Response(JSON.stringify(body), {
      status: code,
      headers: { "Content-Type": "application/json" },
    });
  };

  const authHeader = isWeb
    ? req.headers.get("authorization")
    : (req.headers?.authorization || req.headers?.Authorization);

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return send(401, { error: "Unauthorized" });
  }

  try {
    const now = new Date().toISOString();

    // استخراج الإعلانات المجدولة التي حان وقت نشرها
    const { data: pending, error } = await supabase
      .from("announcements")
      .select("*")
      .eq("is_published", false)
      .lte("scheduled_at", now);

    if (error) {
      throw error;
    }

    const publishedList = [];

    if (pending && pending.length > 0) {
      for (const ann of pending) {
        const { error: updateErr } = await supabase
          .from("announcements")
          .update({
            is_published: true,
            published_at: now,
          })
          .eq("id", ann.id);

        if (!updateErr) {
          publishedList.push(ann.title);

          // إرسال إشعار FCM للمستخدمين
          await sendAnnouncementPush(ann);

          // إشعار المشرفين على تيليجرام
          await notifyAdminOnTelegram(
            `📢 *تم نشر إعلان مجدول تلقائياً:*\n` +
            `• *العنوان:* ${ann.title}\n` +
            `• *النوع:* ${ann.type || "عام"}\n` +
            `• *الوقت:* ${new Date().toLocaleTimeString("ar-EG")}`
          );
        }
      }
    }

    return send(200, {
      ok: true,
      checked_at: now,
      published_count: publishedList.length,
      published_titles: publishedList,
    });
  } catch (err: any) {
    console.error("Scheduled announcements error:", err);
    return send(500, { ok: false, error: err?.message || String(err) });
  }
}

async function notifyAdminOnTelegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.ADMIN_CHAT_ID;
  if (!token || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
      }),
    });
  } catch (_) {}
}
