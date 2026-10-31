import { Context, InlineKeyboard } from "grammy";
import { MyContext, MyConversation } from "../bot.js";
import { formatAnnouncementPreview } from "../../telegram/formatters/announcements.js";
import { supabase } from "../../supabase/client.js";
import { sendAnnouncementPush } from "../../fcm/index.js";

// ============================================
// Main Menu
// ============================================

export async function announcementsMenu(ctx: MyContext) {
  const keyboard = new InlineKeyboard()
    .text("➕ إعلان جديد", "ann:create")
    .text("📋 قائمة الإعلانات", "ann:list")
    .row()
    .text("📦 المسودات", "ann:drafts")
    .text("📜 الأرشيف", "ann:archive")
    .row()
    .text("🔙 القائمة الرئيسية", "menu:main");

  await ctx.editMessageText("📢 *إدارة الإعلانات والتحديثات*", {
    reply_markup: keyboard,
  });
}

// ============================================
// Create Announcement Conversation
// ============================================

export async function createAnnouncementConversation(
  conversation: MyConversation,
  ctx: MyContext
) {
  // 1. العنوان
  await ctx.reply("📝 أدخل عنوان الإعلان:");
  const title = await conversation.form.text();

  // 2. المحتوى
  await ctx.reply("📄 أدخل محتوى الإعلان (يدعم Markdown):");
  const body = await conversation.form.text();

  // 3. نوع الإعلان
  const typeKeyboard = new InlineKeyboard()
    .text("📢 إعلان عام", "type:general")
    .text("🔄 تحديث تطبيق", "type:update")
    .text("⚠️ صيانة", "type:maintenance")
    .text("🎉 ميزة جديدة", "type:feature");
  
  await ctx.reply("🏷️ اختر نوع الإعلان:", { reply_markup: typeKeyboard });
  const typeCtx = await conversation.waitFor("callback_query:data");
  const type = typeCtx.callbackQuery.data.split(":")[1];

  // 4. الإصدار المستهدف (للتحديثات)
  let targetVersion: string | null = null;
  let mandatory = false;
  if (type === "update") {
    await ctx.reply("🔢 أدخل رقم الإصدار المستهدف (مثال: 1.2.0):");
    targetVersion = (await conversation.form.text()).trim();
    
    const mandatoryKeyboard = new InlineKeyboard()
      .text("✅ إلزامي", "mandatory:true")
      .text("⭕ اختياري", "mandatory:false");
    await ctx.reply("هل التحديث إلزامي؟", { reply_markup: mandatoryKeyboard });
    const mandCtx = await conversation.waitFor("callback_query:data");
    mandatory = mandCtx.callbackQuery.data.split(":")[1] === "true";
  }

  // 5. أولوية العرض
  const priorityKeyboard = new InlineKeyboard()
    .text("🔴 عالية (بانر علوي)", "priority:high")
    .text("🟡 متوسطة (بطاقة)", "priority:medium")
    .text("🟢 منخفضة (في القائمة)", "priority:low");
  
  await ctx.reply("📊 أولوية العرض:", { reply_markup: priorityKeyboard });
  const prioCtx = await conversation.waitFor("callback_query:data");
  const priority = prioCtx.callbackQuery.data.split(":")[1];

  // 6. روابط التنزيل (للتحديثات)
  let downloadLinks: Record<string, string> = {};
  if (type === "update") {
    await ctx.reply(
      "🔗 أدخل روابط التنزيل بصيغة JSON:\n" +
      'مثال: `{"playstore": "https://...", "github": "https://...", "apkpure": "https://..."}`'
    );
    const linksText = await conversation.form.text();
    try {
      downloadLinks = JSON.parse(linksText);
    } catch {
      await ctx.reply("⚠️ صيغة JSON غير صحيحة، سيتم تجاهل الروابط.");
    }
  }

  // 7. جدولة النشر (اختياري)
  const scheduleKeyboard = new InlineKeyboard()
    .text("📅 جدولة", "schedule:yes")
    .text("🚀 نشر الآن", "schedule:no");
  
  await ctx.reply("⏰ هل تريد جدولة النشر لوقت لاحق؟", { reply_markup: scheduleKeyboard });
  const schedCtx = await conversation.waitFor("callback_query:data");
  let scheduledAt: Date | null = null;
  
  if (schedCtx.callbackQuery.data.split(":")[1] === "yes") {
    await ctx.reply("أدخل التاريخ والوقت (ISO 8601):\nمثال: `2025-12-25T10:00:00Z`");
    const dateText = await conversation.form.text();
    scheduledAt = new Date(dateText);
  }

  // 8. معاينة وتأكيد
  const preview = formatAnnouncementPreview({
    title, body, type, targetVersion, mandatory,
    priority, downloadLinks, scheduledAt
  });
  
  const confirmKeyboard = new InlineKeyboard()
    .text("✅ تأكيد وإنشاء", "confirm:create")
    .text("✏️ تعديل", "confirm:edit")
    .text("❌ إلغاء", "confirm:cancel");
  
  await ctx.reply(preview, { parse_mode: "Markdown", reply_markup: confirmKeyboard });
  const confirmCtx = await conversation.waitFor("callback_query:data");
  
  if (confirmCtx.callbackQuery.data === "confirm:create") {
    const { data, error } = await supabase.from("announcements").insert({
      title, body, type, target_version: targetVersion,
      mandatory, priority, download_links: downloadLinks,
      scheduled_at: scheduledAt?.toISOString() ?? null,
      is_published: !scheduledAt,
      created_by: ctx.from!.id,
    }).select().single();
    
    if (error) throw error;
    
    // تسجيل في Audit Log
    await supabase.from("audit_logs").insert({
      action: "announcement_created",
      entity_type: "announcement",
      entity_id: data.id,
      user_id: ctx.from!.id,
      metadata: { title, type, priority },
    });
    
    // إذا كان مجدول - إضافة مهمة cron (يمكن تنفيذها لاحقاً)
    if (scheduledAt) {
      await scheduleAnnouncementPublish(data.id, scheduledAt);
    }
    
    await ctx.reply(`✅ تم إنشاء الإعلان بنجاح!\nالمعرف: \`${data.id}\``, { parse_mode: "Markdown" });
  }
}

// ============================================
// List Announcements
// ============================================

export async function listAnnouncements(ctx: MyContext, status: "published" | "draft" | "archived" = "published") {
  let query = supabase.from("announcements").select("*").order("created_at", { ascending: false });
  
  if (status === "published") {
    query = query.eq("is_published", true).is("scheduled_at", null);
  } else if (status === "draft") {
    query = query.eq("is_published", false);
  } else if (status === "archived") {
    query = query.eq("is_published", true).not("scheduled_at", "is", null);
  }
  
  const { data, error } = await query.limit(20);
  
  if (error) throw error;
  
  if (!data || data.length === 0) {
    return ctx.reply(`📭 لا توجد إعلانات في حالة: ${status}`);
  }
  
  let msg = `📋 *قائمة الإعلانات (${status})*\n\n`;
  const keyboard = new InlineKeyboard();
  
  for (const ann of data) {
    const statusEmoji = ann.is_published ? "🟢" : "🟡";
    const typeEmoji = ann.type === "update" ? "🔄" : ann.type === "maintenance" ? "⚠️" : "📢";
    msg += `${statusEmoji} ${typeEmoji} *${ann.title}*\n`;
    msg += `   🆔 \`${ann.id.slice(0, 8)}...\` | 📅 ${new Date(ann.created_at).toLocaleDateString("ar-SA")}\n\n`;
    
    keyboard.text(`${statusEmoji} ${ann.title.slice(0, 30)}`, `ann:view:${ann.id}`).row();
  }
  
  keyboard.text("🔙 العودة", "menu:announcements");
  
  await ctx.reply(msg, { parse_mode: "Markdown", reply_markup: keyboard });
}

// ============================================
// View Announcement Details
// ============================================

export async function viewAnnouncement(ctx: MyContext, announcementId: string) {
  const { data, error } = await supabase
    .from("announcements")
    .select("*")
    .eq("id", announcementId)
    .single();
  
  if (error || !data) {
    return ctx.answerCallbackQuery("❌ لم يتم العثور على الإعلان");
  }
  
  const statusEmoji = data.is_published ? "🟢" : "🟡";
  const typeEmoji = data.type === "update" ? "🔄" : data.type === "maintenance" ? "⚠️" : "📢";
  
  let msg = `${statusEmoji} ${typeEmoji} *${data.title}*\n\n`;
  msg += `${data.body}\n\n`;
  msg += `🆔 \`${data.id}\`\n`;
  msg += `📅 تم الإنشاء: ${new Date(data.created_at).toLocaleString("ar-SA")}\n`;
  if (data.published_at) {
    msg += `📅 تم النشر: ${new Date(data.published_at).toLocaleString("ar-SA")}\n`;
  }
  if (data.scheduled_at) {
    msg += `⏰ مجدول: ${new Date(data.scheduled_at).toLocaleString("ar-SA")}\n`;
  }
  msg += `👤 بواسطة: ${data.created_by}\n`;
  
  const keyboard = new InlineKeyboard();
  
  if (!data.is_published && !data.scheduled_at) {
    keyboard.text("🚀 نشر الآن وإرسال إشعار", `ann:publish:${data.id}`).row();
  }
  if (data.is_published) {
    keyboard.text("🛑 إيقاف النشر", `ann:unpublish:${data.id}`)
      .text("🔔 إعادة إرسال الإشعار", `ann:resend_push:${data.id}`)
      .row();
  }
  keyboard.text("📦 أرشفة", `ann:archive:${data.id}`)
    .text("🗑️ حذف نهائي", `ann:delete_prompt:${data.id}`)
    .row();
  keyboard.text("🔙 العودة للقائمة", "ann:list");
  
  await ctx.editMessageText(msg, { parse_mode: "Markdown", reply_markup: keyboard });
}

// ============================================
// Publish/Unpublish & Delete
// ============================================

export async function publishAnnouncement(ctx: MyContext, announcementId: string) {
  const { data, error } = await supabase
    .from("announcements")
    .update({ is_published: true, published_at: new Date().toISOString() })
    .eq("id", announcementId)
    .select()
    .single();
  
  if (error) throw error;
  
  // إرسال إشعار Push للمستخدمين عبر FCM
  const pushResult = await sendAnnouncementPush(data);
  
  await supabase.from("audit_logs").insert({
    action: "announcement_published",
    entity_type: "announcement",
    entity_id: announcementId,
    user_id: ctx.from!.id,
    metadata: { push_sent: pushResult.sent, push_failed: pushResult.failed },
  });
  
  await ctx.answerCallbackQuery(`✅ تم النشر (أُرسل لـ ${pushResult.sent} جهاز)`);
  await viewAnnouncement(ctx, announcementId);
}

export async function unpublishAnnouncement(ctx: MyContext, announcementId: string) {
  await supabase
    .from("announcements")
    .update({ is_published: false })
    .eq("id", announcementId);
  
  await supabase.from("audit_logs").insert({
    action: "announcement_unpublished",
    entity_type: "announcement",
    entity_id: announcementId,
    user_id: ctx.from!.id,
  });
  
  await ctx.answerCallbackQuery("✅ تم إيقاف الإعلان");
  await viewAnnouncement(ctx, announcementId);
}

async function scheduleAnnouncementPublish(announcementId: string, scheduledAt: Date) {
  console.log(`Announcement ${announcementId} scheduled for ${scheduledAt.toISOString()}`);
}

// ============================================
// Register Callbacks
// ============================================

export function registerAnnouncementCallbacks(bot: any) {
  bot.callbackQuery("ann:create", async (ctx: any) => {
    await ctx.conversation.enter("createAnnouncement");
  });
  
  bot.callbackQuery("ann:list", (ctx: any) => listAnnouncements(ctx, "published"));
  bot.callbackQuery("ann:drafts", (ctx: any) => listAnnouncements(ctx, "draft"));
  bot.callbackQuery("ann:archive", (ctx: any) => listAnnouncements(ctx, "archived"));
  
  bot.callbackQuery(/ann:view:(.+)/, (ctx: any) => viewAnnouncement(ctx, ctx.match[1]));
  bot.callbackQuery(/ann:publish:(.+)/, (ctx: any) => publishAnnouncement(ctx, ctx.match[1]));
  bot.callbackQuery(/ann:unpublish:(.+)/, (ctx: any) => unpublishAnnouncement(ctx, ctx.match[1]));

  bot.callbackQuery(/ann:resend_push:(.+)/, async (ctx: any) => {
    const id = ctx.match[1];
    const { data: ann } = await supabase.from("announcements").select("*").eq("id", id).single();
    if (!ann) return ctx.answerCallbackQuery("❌ الإعلان غير موجود");
    const result = await sendAnnouncementPush(ann);
    await ctx.answerCallbackQuery(`✅ تم إرسال الإشعار لـ ${result.sent} جهاز`);
  });

  bot.callbackQuery(/ann:delete_prompt:(.+)/, async (ctx: any) => {
    const id = ctx.match[1];
    const keyboard = new InlineKeyboard()
      .text("⚠️ نعم، احذف نهائياً", `ann:confirm_delete:${id}`)
      .text("❌ تراجع", `ann:view:${id}`);
    await ctx.editMessageText("⚠️ *تأكيد الحذف*\n\nهل أنت متأكد من حذف هذا الإعلان نهائياً؟ لا يمكن التراجع عن هذا الإجراء.", {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery(/ann:confirm_delete:(.+)/, async (ctx: any) => {
    const id = ctx.match[1];
    await supabase.from("announcements").delete().eq("id", id);
    await supabase.from("audit_logs").insert({
      action: "announcement_deleted",
      entity_type: "announcement",
      entity_id: id,
      user_id: ctx.from!.id,
    });
    await ctx.answerCallbackQuery("🗑️ تم حذف الإعلان نهائياً");
    await listAnnouncements(ctx, "published");
  });

  bot.callbackQuery(/ann:archive:(.+)/, async (ctx: any) => {
    await supabase.from("announcements").update({ is_published: false }).eq("id", ctx.match[1]);
    await ctx.answerCallbackQuery("✅ تم أرشفة الإعلان");
    await listAnnouncements(ctx, "published");
  });
}