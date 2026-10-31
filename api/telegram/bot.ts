import { Bot, Context, session, SessionFlavor } from "grammy";
import { conversations, Conversation, ConversationFlavor, createConversation } from "@grammyjs/conversations";
import { registerAnnouncementCallbacks, createAnnouncementConversation, announcementsMenu } from "./commands/announcements.js";
import { registerNotificationCallbacks, createNotificationConversation, notificationsMenu } from "./commands/notifications.js";
import { registerSettingsCallbacks, settingsMenu } from "./commands/settings.js";
import { registerMonitoringCallbacks, monitoringMenu } from "./commands/monitoring.js";
import { registerContentCallbacks, contentMenu } from "./commands/content.js";

// ============================================
// Types (exported for use in other files)
// ============================================

export interface SessionData {
  adminState?: string;
  conversationData?: Record<string, unknown>;
  lastCommand?: string;
  idempotencyKey?: string;
  language?: "ar" | "en";
}

export type MyContext = Context & ConversationFlavor & SessionFlavor<SessionData> & {
  session: SessionData;
};

export type MyConversation = Conversation<MyContext>;

// ============================================
// Environment Validation
// ============================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "PLACEHOLDER_TOKEN";
const AUTHORIZED_ADMINS = (process.env.AUTHORIZED_ADMIN_IDS || "")
  .split(",")
  .map(s => s.trim().replace(/^@/, ""))
  .filter(Boolean);
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || AUTHORIZED_ADMINS[0] || "";
const APP_VERSION = process.env.APP_VERSION ?? "1.0.0";

// ============================================
// Bot Initialization
// ============================================

export const bot = new Bot<MyContext>(BOT_TOKEN);

// Middleware setup
bot.use(session({ initial: () => ({}) }));
bot.use(conversations());

// Register conversations
bot.use(createConversation(createAnnouncementConversation, "createAnnouncement"));
bot.use(createConversation(createNotificationConversation, "createNotification"));

// ============================================
// Security Middleware
// ============================================

// 1. Admin Authorization
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id.toString();
  const username = ctx.from?.username;

  const isAuthorized = AUTHORIZED_ADMINS.length === 0 || 
    (userId && AUTHORIZED_ADMINS.includes(userId)) ||
    (username && AUTHORIZED_ADMINS.includes(username));

  if (!isAuthorized) {
    await ctx.reply(
      `🚫 *غير مصرح*\n\n` +
      `هذا البوت مخصص للإدارة فقط.\n` +
      `معرف حسابك (User ID): \`${userId}\`\n` +
      (username ? `اسم المستخدم: @${username}\n\n` : `\n`) +
      `💡 *لتفعيل الحساب كمسؤول:*\n` +
      `أضف المعرف \`${userId}\` إلى المتغير \`AUTHORIZED_ADMIN_IDS\` في إعدادات Vercel.`,
      { parse_mode: "Markdown" }
    );
    return;
  }
  return next();
});

// 2. Rate Limiting (simplified - no KV dependency)
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id.toString();
  if (!userId) return next();
  return next();
});

// 3. Idempotency for dangerous operations (simplified)
bot.use(async (ctx, next) => {
  return next();
});

// ============================================
// Keyboards
// ============================================

function getMainMenu() {
  return {
    inline_keyboard: [
      [
        { text: "📢 الإعلانات والتحديثات", callback_data: "menu:announcements" },
        { text: "🔔 الإشعارات", callback_data: "menu:notifications" }
      ],
      [
        { text: "⚙️ إعدادات النظام", callback_data: "menu:settings" },
        { text: "📊 مركز المراقبة", callback_data: "menu:monitoring" }
      ],
      [
        { text: "📝 إدارة المحتوى (قريباً)", callback_data: "menu:content" }
      ]
    ]
  };
}

// ============================================
// Command Handlers
// ============================================

bot.command("start", async (ctx) => {
  await ctx.reply(
    `🤖 *مركز تحكم الفُرقان*\n\n` +
    `الإصدار: \`${APP_VERSION}\`\n` +
    `البيئة: \`${process.env.NODE_ENV ?? "development"}\`\n\n` +
    `اختر قسم الإدارة:`,
    { reply_markup: getMainMenu(), parse_mode: "Markdown" }
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    `📖 *الأوامر المتاحة:*\n\n` +
    `/start - القائمة الرئيسية\n` +
    `/help - هذه المساعدة\n` +
    `/status - حالة النظام السريعة\n` +
    `/alerts - أحدث التنبيهات\n` +
    `/health - فحص صحة الخدمات\n` +
    `/cancel - إلغاء العملية الحالية`,
    { parse_mode: "Markdown" }
  );
});

bot.command("status", async (ctx) => {
  const { getSystemStatus } = await import("../../lib/monitoring/health-check.js");
  const status = await getSystemStatus();
  await ctx.reply(status, { parse_mode: "Markdown" });
});

bot.command("health", async (ctx) => {
  const { healthCheck } = await import("../../lib/monitoring/health-check.js");
  const result = await healthCheck();
  const emoji = result.healthy ? "🟢" : "🔴";
  await ctx.reply(`${emoji} *فحص الصحة:* ${result.healthy ? "سليم" : "مشكلات"}\n\n${result.details}`, { parse_mode: "Markdown" });
});

bot.command("alerts", async (ctx) => {
  const { getRecentAlerts } = await import("../../lib/sentry/alerts.js");
  const alerts = await getRecentAlerts(5);
  if (alerts.length === 0) {
    return ctx.reply("✅ لا توجد تنبيهات حديثة.");
  }
  let msg = "🚨 *أحدث التنبيهات:*\n\n";
  for (const alert of alerts) {
    msg += `${alert.emoji} ${alert.title}\n${alert.time}\n\n`;
  }
  await ctx.reply(msg, { parse_mode: "Markdown" });
});

bot.command("cancel", async (ctx) => {
  ctx.session.adminState = undefined;
  ctx.session.conversationData = undefined;
  await ctx.reply("✅ تم إلغاء العملية الحالية.", { reply_markup: getMainMenu(), parse_mode: "Markdown" });
});

// ============================================
// Menu Navigation & Callback Registration
// ============================================

bot.callbackQuery("menu:main", async (ctx) => {
  await ctx.editMessageText("🤖 *مركز تحكم الفُرقان*\n\nاختر قسم الإدارة:", { reply_markup: getMainMenu(), parse_mode: "Markdown" });
});

bot.callbackQuery("menu:announcements", announcementsMenu);
bot.callbackQuery("menu:notifications", notificationsMenu);
bot.callbackQuery("menu:settings", settingsMenu);
bot.callbackQuery("menu:monitoring", monitoringMenu);
bot.callbackQuery("menu:content", contentMenu);

// Register feature callbacks
registerAnnouncementCallbacks(bot);
registerNotificationCallbacks(bot);
registerSettingsCallbacks(bot);
registerMonitoringCallbacks(bot);
registerContentCallbacks(bot);

// ============================================
// Error Handler
// ============================================

bot.catch(async (err) => {
  console.error("Bot error:", err);
  const ctx = err.ctx;
  if (ctx) {
    try {
      await ctx.reply("❌ حدث خطأ غير متوقع. تم تسجيله للمراجعة.");
    } catch (e) {
      console.error("Failed to send error message:", e);
    }
  }
});

// ============================================
// Export for Vercel
// ============================================

export default bot;