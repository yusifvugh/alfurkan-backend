import { createClient } from "@supabase/supabase-js";
import { getEnv } from "../../lib/utils/env.js";
import { sendAnnouncementPush } from "../../lib/fcm/index.js";
import { createHmac, timingSafeEqual } from "crypto";

const supabase = createClient(
  getEnv("SUPABASE_URL"),
  getEnv("SUPABASE_SERVICE_ROLE_KEY")
);

// ============================================
// Main Consolidated Monitoring Handler
// Combines: health, daily-summary, publish-scheduled, sentry-webhook
// Keeps total serverless functions within Vercel Hobby plan limit (<=12)
// ============================================
export default async function handler(req: any, res?: any) {
  const isWeb = typeof req.headers?.get === "function";
  const urlStr = req.url || "";
  let action = "";

  // 1. Resolve requested action from query parameter or pathname
  if (req.query && req.query.action) {
    action = String(req.query.action);
  } else {
    try {
      const parsed = new URL(urlStr, "http://localhost");
      action = parsed.searchParams.get("action") || "";
      if (!action) {
        const segments = parsed.pathname.split("/").filter(Boolean);
        // segments e.g. ["api", "monitoring", "health"]
        const idx = segments.indexOf("monitoring");
        if (idx !== -1 && idx + 1 < segments.length) {
          action = segments[idx + 1];
        }
      }
    } catch (_) {}
  }

  // Normalize action name
  action = action.toLowerCase().trim();

  // Helper response sender
  const send = (code: number, body: any) => {
    if (res && typeof res.status === "function") {
      return res.status(code).json(body);
    }
    return new Response(JSON.stringify(body), {
      status: code,
      headers: { "Content-Type": "application/json" },
    });
  };

  // Route to the appropriate sub-handler
  switch (action) {
    case "daily-summary":
      return handleDailySummary(req, res, send, isWeb);

    case "publish-scheduled":
      return handlePublishScheduled(req, res, send, isWeb);

    case "sentry-webhook":
      return handleSentryWebhook(req, res, send, isWeb);

    case "health":
    default:
      return handleHealth(send);
  }
}

// --------------------------------------------
// 1. Health Handler
// --------------------------------------------
function handleHealth(send: (code: number, body: any) => any) {
  return send(200, {
    healthy: true,
    status: "healthy",
    uptime: "100%",
    timestamp: new Date().toISOString(),
  });
}

// --------------------------------------------
// 2. Publish Scheduled Announcements Handler
// --------------------------------------------
async function handlePublishScheduled(
  req: any,
  res: any,
  send: (code: number, body: any) => any,
  isWeb: boolean
) {
  const authHeader = isWeb
    ? req.headers.get("authorization")
    : (req.headers?.authorization || req.headers?.Authorization);

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return send(401, { error: "Unauthorized" });
  }

  try {
    const now = new Date().toISOString();

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
          await sendAnnouncementPush(ann);
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

// --------------------------------------------
// 3. Daily Summary Handler
// --------------------------------------------
async function handleDailySummary(
  req: any,
  res: any,
  send: (code: number, body: any) => any,
  isWeb: boolean
) {
  const authHeader = isWeb
    ? req.headers.get("authorization")
    : (req.headers?.authorization || req.headers?.Authorization);

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return send(401, { error: "Unauthorized" });
  }

  try {
    const sentryStats = await fetchSentryStats();
    const notificationStats = { campaignsSent: 0, notificationsDelivered: 0, notificationsFailed: 0 };
    const message = formatDailySummary(sentryStats, notificationStats);

    const adminChat = process.env.ADMIN_CHAT_ID;
    if (adminChat) {
      await notifyAdminOnTelegram(message, adminChat);
    }

    return send(200, { ok: true, sent: true });
  } catch (error) {
    console.error("Daily summary error:", error);
    return send(500, { ok: false, error: String(error) });
  }
}

async function fetchSentryStats() {
  try {
    const org = process.env.SENTRY_ORG;
    const token = process.env.SENTRY_AUTH_TOKEN;
    const project = process.env.SENTRY_PROJECT;
    if (!org || !token || !project) {
      return { totalErrors: 0, fatalErrors: 0, affectedUsers: 0, newIssues: 0, resolvedIssues: 0, avgResponseTime: 0, errorRate: 0, uptime: 100 };
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const url = `https://sentry.io/api/0/projects/${org}/${project}/stats/?since=${since}&resolution=1h&stat=received&stat=rejected&stat=blacklisted&stat=generated`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as { received?: number }[];

    return {
      totalErrors: data[0]?.received ?? 0,
      fatalErrors: 0,
      affectedUsers: 0,
      newIssues: 0,
      resolvedIssues: 0,
      avgResponseTime: 0,
      errorRate: 0,
      uptime: 100,
    };
  } catch (_) {
    return { totalErrors: 0, fatalErrors: 0, affectedUsers: 0, newIssues: 0, resolvedIssues: 0, avgResponseTime: 0, errorRate: 0, uptime: 100 };
  }
}

function formatDailySummary(sentry: any, notifications: any): string {
  const date = new Date().toLocaleDateString("ar-SA", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  let msg = `📅 *الملخص اليومي - ${date}*\n\n`;
  msg += `📊 *الأخطاء:*\n`;
  msg += `   • إجمالي: ${sentry.totalErrors}\n`;
  msg += `   • حرجة (Fatal): ${sentry.fatalErrors}\n`;
  msg += `   • مستخدمون متأثرون: ${sentry.affectedUsers}\n`;
  msg += `   • قضايا جديدة: ${sentry.newIssues}\n`;
  msg += `   • قضايا محلولة: ${sentry.resolvedIssues}\n\n`;
  msg += `📈 *الأداء:*\n`;
  msg += `   • متوسط زمن الاستجابة: ${sentry.avgResponseTime}ms\n`;
  msg += `   • معدل الأخطاء: ${sentry.errorRate}%\n`;
  msg += `   • Uptime: ${sentry.uptime}%\n\n`;
  msg += `🔔 *الإشعارات:*\n`;
  msg += `   • حملات مرسلة: ${notifications.campaignsSent}\n`;
  msg += `   • إشعارات مسلمة: ${notifications.notificationsDelivered}\n`;
  msg += `   • فاشلة: ${notifications.notificationsFailed}\n\n`;
  return msg;
}

// --------------------------------------------
// 4. Sentry Webhook Handler
// --------------------------------------------
function verifySentrySignature(signature: string | null, payload: string): boolean {
  if (!signature) return false;
  const secret = getEnv("SENTRY_WEBHOOK_SECRET");
  if (!secret) return false;
  if (!signature.startsWith("sha256=")) return false;

  const providedSignature = signature.slice(7);
  const expectedSignature = createHmac("sha256", secret).update(payload).digest("hex");

  const providedBuffer = Buffer.from(providedSignature, "hex");
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

async function handleSentryWebhook(
  req: any,
  res: any,
  send: (code: number, body: any) => any,
  isWeb: boolean
) {
  if (req.method !== "POST") {
    return send(405, { error: "Method Not Allowed" });
  }

  try {
    let payloadText = "";
    if (typeof req.text === "function") {
      payloadText = await req.text();
    } else if (typeof req.body === "string") {
      payloadText = req.body;
    } else if (req.body) {
      payloadText = JSON.stringify(req.body);
    }

    const signature = isWeb
      ? req.headers.get("sentry-hook-signature")
      : (req.headers?.["sentry-hook-signature"] || req.headers?.["Sentry-Hook-Signature"]);

    if (!verifySentrySignature(signature, payloadText)) {
      console.warn("Invalid Sentry webhook signature");
      return send(401, { error: "Invalid signature" });
    }

    const payload = JSON.parse(payloadText);
    if (payload.action === "created" && payload.data?.issue) {
      const issue = payload.data.issue;
      const shouldAlert = issue.level === "fatal" || (issue.userCount && issue.userCount > 100) || (issue.count && issue.count > 50);
      if (shouldAlert) {
        const msg = `🚨 *خطأ حرج في التطبيق!*\n\n• *العنوان:* ${issue.title}\n• *المستوى:* ${issue.level}\n• *المتأثرون:* ${issue.userCount ?? 0}\n[🔗 عرض التفاصيل](${issue.permalink})`;
        await notifyAdminOnTelegram(msg);
      }
    }

    return send(200, { ok: true });
  } catch (error) {
    console.error("Sentry webhook error:", error);
    return send(500, { ok: false, error: String(error) });
  }
}

async function notifyAdminOnTelegram(text: string, overrideChatId?: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = overrideChatId || process.env.ADMIN_CHAT_ID;
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
