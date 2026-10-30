import { Context, InlineKeyboard } from "grammy";
import { MyContext, MyConversation } from "../bot.js";
import { createClient } from "@supabase/supabase-js";
import { getEnv } from "../../../lib/utils/env.js";
import { formatNotificationPreview } from "../../../lib/telegram/formatters/announcements.js";

const supabase = createClient(
  getEnv("SUPABASE_URL"),
  getEnv("SUPABASE_SERVICE_ROLE_KEY")
);

interface NotificationCampaign {
  id: string;
  title: string;
  body: string;
  target_audience: string;
  target_filter: Record<string, any>;
  related_announcement_id?: string;
  scheduled_at?: string;
  status: "draft" | "scheduled" | "sending" | "sent" | "failed" | "cancelled";
  stats: { sent: number; failed: number; opened: number };
}

// ============================================
// Main Menu
// ============================================

export async function notificationsMenu(ctx: MyContext) {
  const keyboard = new InlineKeyboard()
    .text("📤 إرسال إشعار جديد", "notif:create")
    .text("📋 الحملات المجدولة", "notif:scheduled")
    .row()
    .text("📊 الحملات المرسلة", "notif:sent")
    .text("⏸️ الحملات المعلقة", "notif:paused")
    .row()
    .text("🔙 القائمة الرئيسية", "menu:main");

  await ctx.editMessageText("🔔 *إدارة الإشعارات*", {
    reply_markup: keyboard,
  });
}

// ============================================
// Create Notification Conversation
// ============================================

export async function createNotificationConversation(
  conversation: MyConversation,
  ctx: MyContext
) {
  // 1. اختيار الجمهور
  const audienceKeyboard = new InlineKeyboard()
    .text("👥 جميع المستخدمين", "audience:all")
    .text("📱 إصدار محدد", "audience:version")
    .text("🌍 منطقة/دولة", "audience:region")
    .text("🎯 مخصص", "audience:custom");
  
  await ctx.reply("👥 اختر الجمهور المستهدف:", { reply_markup: audienceKeyboard });
  const audCtx = await conversation.waitFor("callback_query:data");
  const audience = audCtx.callbackQuery.data.split(":")[1];
  
  let targetFilter: Record<string, any> = {};
  if (audience === "version") {
    await ctx.reply("أدخل رقم الإصدار (مثال: 1.0.0):");
    targetFilter.version = (await conversation.form.text()).trim();
  } else if (audience === "region") {
    await ctx.reply("أدخل كود الدولة (ISO 3166-1 alpha-2):");
    targetFilter.country = (await conversation.form.text()).trim().toUpperCase();
  }
  
  // 2. العنوان والمحتوى
  await ctx.reply("📝 عنوان الإشعار:");
  const title = await conversation.form.text();
  
  await ctx.reply("📄 محتوى الإشعار:");
  const body = await conversation.form.text();
  
  // 3. ربط بإعلان (اختياري)
  const linkKeyboard = new InlineKeyboard()
    .text("🔗 ربط بإعلان", "link:yes")
    .text("➡️ تخطي", "link:no");
  
  await ctx.reply("هل تريد ربط الإشعار بإعلان منشور؟", { reply_markup: linkKeyboard });
  const linkCtx = await conversation.waitFor("callback_query:data");
  
  let relatedAnnouncementId: string | null = null;
  if (linkCtx.callbackQuery.data === "link:yes") {
    const { data: announcements } = await supabase
      .from("announcements")
      .select("id, title")
      .eq("is_published", true)
      .order("published_at", { ascending: false })
      .limit(10);
    
    const listKeyboard = new InlineKeyboard();
    announcements?.forEach(a => {
      listKeyboard.text(a.title.slice(0, 40), `link_ann:${a.id}`).row();
    });
    
    await ctx.reply("اختر الإعلان:", { reply_markup: listKeyboard });
    const annCtx = await conversation.waitFor("callback_query:data");
    relatedAnnouncementId = annCtx.callbackQuery.data.split(":")[1];
  }
  
  // 4. جدولة أو إرسال فوري
  const scheduleKeyboard = new InlineKeyboard()
    .text("📅 جدولة", "sched:yes")
    .text("🚀 إرسال الآن", "sched:no");
  
  await ctx.reply("⏰ وقت الإرسال:", { reply_markup: scheduleKeyboard });
  const schedCtx = await conversation.waitFor("callback_query:data");
  
  let scheduledAt: Date | null = null;
  if (schedCtx.callbackQuery.data === "sched:yes") {
    await ctx.reply("أدخل التاريخ والوقت (ISO 8601):");
    scheduledAt = new Date((await conversation.form.text()).trim());
  }
  
  // 5. معاينة وتأكيد
  const preview = formatNotificationPreview({
    title, body, audience, targetFilter, scheduledAt, relatedAnnouncementId
  });
  
  const confirmKeyboard = new InlineKeyboard()
    .text("✅ تأكيد وإرسال", "confirm:send")
    .text("❌ إلغاء", "confirm:cancel");
  
  await ctx.reply(preview, { parse_mode: "Markdown", reply_markup: confirmKeyboard });
  const confirmCtx = await conversation.waitFor("callback_query:data");
  
  if (confirmCtx.callbackQuery.data === "confirm:send") {
    // إنشاء الحملة
    const { data: campaign } = await supabase.from("notification_campaigns").insert({
      title, body, target_audience: audience,
      target_filter: targetFilter,
      related_announcement_id: relatedAnnouncementId,
      scheduled_at: scheduledAt?.toISOString(),
      status: scheduledAt ? "scheduled" : "sending",
    }).select().single();
    
    if (!scheduledAt) {
      // إرسال فوري - في الخلفية
      executeCampaign(campaign.id);
    }
    
    await supabase.from("audit_logs").insert({
      action: "notification_campaign_created",
      entity_type: "notification_campaign",
      entity_id: campaign.id,
      user_id: ctx.from!.id,
      metadata: { title, audience, scheduled: !!scheduledAt },
    });
    
    await ctx.reply(`✅ ${scheduledAt ? "تمت جدولة" : "جاري إرسال"} الحملة!\nالمعرف: \`${campaign.id}\``, { parse_mode: "Markdown" });
  }
}

// ============================================
// Execute Campaign (Background)
// ============================================

async function executeCampaign(campaignId: string) {
  const { data: campaign } = await supabase
    .from("notification_campaigns")
    .update({ status: "sending" })
    .eq("id", campaignId)
    .select()
    .single();
  
  if (!campaign) return;
  
  // بناء استعلام المستخدمين المستهدفين
  let query = supabase.from("app_users").select("fcm_token, device_id");
  
  if (campaign.target_audience === "version") {
    query = query.eq("app_version", campaign.target_filter?.version);
  } else if (campaign.target_audience === "region") {
    query = query.eq("country", campaign.target_filter?.country);
  }
  
  const { data: users } = await query;
  const tokens = users?.map(u => u.fcm_token).filter(Boolean) ?? [];
  
  // إرسال عبر FCM (batches من 500)
  const results = await sendFCMBatch(tokens, {
    title: campaign.title,
    body: campaign.body,
    data: {
      type: "notification",
      campaign_id: campaignId,
      announcement_id: campaign.related_announcement_id ?? "",
    },
  });
  
  // تحديث الإحصائيات
  await supabase.from("notification_campaigns").update({
    status: "sent",
    stats: results,
    sent_at: new Date().toISOString(),
  }).eq("id", campaignId);
}

async function sendFCMBatch(tokens: string[], message: { title: string; body: string; data: Record<string, string> }): Promise<{ sent: number; failed: number; opened: number }> {
  if (tokens.length === 0) return { sent: 0, failed: 0, opened: 0 };
  
  const serverKey = process.env.FCM_SERVER_KEY;
  if (!serverKey) {
    console.error("FCM_SERVER_KEY not configured");
    return { sent: 0, failed: tokens.length, opened: 0 };
  }
  
  let sent = 0;
  let failed = 0;
  
  // إرسال دفعات من 500
  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500);
    try {
      const response = await fetch("https://fcm.googleapis.com/fcm/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `key=${serverKey}`,
        },
        body: JSON.stringify({
          registration_ids: batch,
          notification: {
            title: message.title,
            body: message.body,
          },
          data: message.data,
        }),
      });
      
      const result = await response.json() as { success?: number; failure?: number };
      sent += result.success ?? 0;
      failed += result.failure ?? 0;
    } catch (e) {
      failed += batch.length;
      console.error("FCM batch error:", e);
    }
  }
  
  return { sent, failed, opened: 0 };
}

// ============================================
// List Campaigns
// ============================================

export async function listCampaigns(ctx: MyContext, status: string = "all") {
  let query = supabase.from("notification_campaigns").select("*").order("created_at", { ascending: false });
  
  if (status !== "all") {
    query = query.eq("status", status);
  }
  
  const { data, error } = await query.limit(20);
  
  if (error) throw error;
  
  if (!data || data.length === 0) {
    return ctx.reply(`📭 لا توجد حملات في حالة: ${status}`);
  }
  
  let msg = `📋 *قائمة الحملات (${status})*\n\n`;
  const keyboard = new InlineKeyboard();
  
  for (const camp of data) {
    const statusEmoji = camp.status === "sent" ? "🟢" : 
                        camp.status === "sending" ? "🔄" : 
                        camp.status === "scheduled" ? "🟡" : "🔴";
    msg += `${statusEmoji} *${camp.title}*\n`;
    msg += `   🆔 \`${camp.id.slice(0, 8)}...\` | 📅 ${new Date(camp.created_at).toLocaleDateString("ar-SA")}\n`;
    msg += `   📊 مرسلة: ${camp.stats?.sent ?? 0} | فاشلة: ${camp.stats?.failed ?? 0}\n\n`;
    
    keyboard.text(`${statusEmoji} ${camp.title.slice(0, 30)}`, `notif:view:${camp.id}`).row();
  }
  
  keyboard.text("🔙 العودة", "menu:notifications");
  
  await ctx.reply(msg, { parse_mode: "Markdown", reply_markup: keyboard });
}

// ============================================
// View Campaign Details
// ============================================

export async function viewCampaign(ctx: MyContext, campaignId: string) {
  const { data, error } = await supabase
    .from("notification_campaigns")
    .select("*")
    .eq("id", campaignId)
    .single();
  
  if (error || !data) {
    return ctx.answerCallbackQuery("❌ لم يتم العثور على الحملة");
  }
  
  const statusEmoji = data.status === "sent" ? "🟢" : 
                      data.status === "sending" ? "🔄" : 
                      data.status === "scheduled" ? "🟡" : "🔴";
  
  let msg = `${statusEmoji} *${data.title}*\n\n`;
  msg += `${data.body}\n\n`;
  msg += `🆔 \`${data.id}\`\n`;
  msg += `👥 الجمهور: ${formatAudience(data.target_audience, data.target_filter)}\n`;
  msg += `📊 الحالة: ${data.status}\n`;
  msg += `📈 مرسلة: ${data.stats?.sent ?? 0} | فاشلة: ${data.stats?.failed ?? 0} | مفتوحة: ${data.stats?.opened ?? 0}\n`;
  msg += `📅 تم الإنشاء: ${new Date(data.created_at).toLocaleString("ar-SA")}\n`;
  if (data.sent_at) {
    msg += `📅 أُرسلت: ${new Date(data.sent_at).toLocaleString("ar-SA")}\n`;
  }
  if (data.scheduled_at) {
    msg += `⏰ مجدولة: ${new Date(data.scheduled_at).toLocaleString("ar-SA")}\n`;
  }
  if (data.related_announcement_id) {
    msg += `🔗 إعلان مرتبط: ${data.related_announcement_id}\n`;
  }
  
  const keyboard = new InlineKeyboard();
  
  if (data.status === "scheduled") {
    keyboard.text("🚀 إرسال الآن", `notif:sendnow:${data.id}`).row();
    keyboard.text("❌ إلغاء", `notif:cancel:${data.id}`).row();
  } else if (data.status === "sending") {
    keyboard.text("⏸️ إيقاف", `notif:pause:${data.id}`).row();
  }
  
  keyboard.text("🔙 العودة", "notif:sent");
  
  await ctx.editMessageText(msg, { parse_mode: "Markdown", reply_markup: keyboard });
}

function formatAudience(audience: string, filter?: Record<string, any>): string {
  switch (audience) {
    case "all": return "جميع المستخدمين";
    case "version": return `إصدار: ${filter?.version ?? "غير محدد"}`;
    case "region": return `منطقة: ${filter?.country ?? "غير محدد"}`;
    case "custom": return "مخصص";
    default: return audience;
  }
}

// ============================================
// Register Callbacks
// ============================================

export function registerNotificationCallbacks(bot: any) {
  bot.callbackQuery("notif:create", async (ctx: any) => {
    await ctx.conversation.enter("createNotification");
  });
  
  bot.callbackQuery("notif:scheduled", (ctx: any) => listCampaigns(ctx, "scheduled"));
  bot.callbackQuery("notif:sent", (ctx: any) => listCampaigns(ctx, "sent"));
  bot.callbackQuery("notif:paused", (ctx: any) => listCampaigns(ctx, "failed"));
  
  bot.callbackQuery(/notif:view:(.+)/, (ctx: any) => viewCampaign(ctx, ctx.match[1]));
  bot.callbackQuery(/notif:sendnow:(.+)/, async (ctx: any) => {
    await supabase.from("notification_campaigns").update({ status: "sending" }).eq("id", ctx.match[1]);
    await executeCampaign(ctx.match[1]);
    await ctx.answerCallbackQuery("✅ جاري الإرسال");
    await viewCampaign(ctx, ctx.match[1]);
  });
  bot.callbackQuery(/notif:cancel:(.+)/, async (ctx: any) => {
    await supabase.from("notification_campaigns").update({ status: "cancelled" }).eq("id", ctx.match[1]);
    await ctx.answerCallbackQuery("✅ تم إلغاء الحملة");
    await listCampaigns(ctx, "scheduled");
  });
  bot.callbackQuery(/notif:pause:(.+)/, async (ctx: any) => {
    await supabase.from("notification_campaigns").update({ status: "failed" }).eq("id", ctx.match[1]);
    await ctx.answerCallbackQuery("✅ تم إيقاف الحملة");
    await viewCampaign(ctx, ctx.match[1]);
  });
}