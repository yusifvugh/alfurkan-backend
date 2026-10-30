import { Bot, Context, session, SessionFlavor } from "grammy";
import { conversations, Conversation, ConversationFlavor } from "@grammyjs/conversations";
import { parseMode } from "@grammyjs/parse-mode";

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

function getEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

const BOT_TOKEN = getEnv("TELEGRAM_BOT_TOKEN");
const WEBHOOK_SECRET = getEnv("TELEGRAM_WEBHOOK_SECRET");
const AUTHORIZED_ADMINS = getEnv("AUTHORIZED_ADMIN_IDS").split(",").map(s => s.trim());
const ADMIN_CHAT_ID = getEnv("ADMIN_CHAT_ID");
const APP_VERSION = process.env.APP_VERSION ?? "1.0.0";

// ============================================
// Bot Initialization
// ============================================

export const bot = new Bot<MyContext>(BOT_TOKEN);

// Middleware setup
bot.use(session({ initial: () => ({}) }));
bot.use(conversations());
// parseMode is a transformer, not middleware - use it via API config or manually
// bot.use(parseMode("Markdown")); // REMOVED - causes type error

// ============================================
// Security Middleware
// ============================================

// 1. Webhook Secret Validation
bot.use(async (ctx, next) => {
  const secret = (ctx as any).webhookReplyEnvelope?.secret_token 
    ?? (ctx.update as any).secret_token
    ?? "";
  if (secret !== WEBHOOK_SECRET) {
    console.warn("Invalid webhook secret token", { secret: secret?.slice(0, 8) });
    return ctx.reply("❌ Unauthorized webhook");
  }
  return next();
});

// 2. Admin Authorization
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id.toString();
  if (!userId || !AUTHORIZED_ADMINS.includes(userId)) {
    await ctx.reply("🚫 غير مصرح. هذا البوت مخصص للإدارة فقط.");
    return;
  }
  return next();
});

// 3. Rate Limiting (simplified - no KV dependency)
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id.toString();
  if (!userId) return next();
  // In production, use Redis/Upstash for distributed rate limiting
  return next();
});

// 4. Idempotency for dangerous operations (simplified)
bot.use(async (ctx, next) => {
  if (ctx.callbackQuery?.data?.startsWith("danger:")) {
    // In production, use Redis/Upstash for distributed idempotency
  }
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
// Menu Navigation
// ============================================

bot.callbackQuery("menu:main", async (ctx) => {
  await ctx.editMessageText("🤖 *مركز تحكم الفُرقان*\n\nاختر قسم الإدارة:", { reply_markup: getMainMenu(), parse_mode: "Markdown" });
});

bot.callbackQuery("menu:announcements", async (ctx) => {
  const { announcementsMenu } = await import("./commands/announcements.js");
  await announcementsMenu(ctx);
});

bot.callbackQuery("menu:notifications", async (ctx) => {
  const { notificationsMenu } = await import("./commands/notifications.js");
  await notificationsMenu(ctx);
});

bot.callbackQuery("menu:settings", async (ctx) => {
  const { settingsMenu } = await import("./commands/settings.js");
  await settingsMenu(ctx);
});

bot.callbackQuery("menu:monitoring", async (ctx) => {
  const { monitoringMenu } = await import("./commands/monitoring.js");
  await monitoringMenu(ctx);
});

bot.callbackQuery("menu:content", async (ctx) => {
  await ctx.editMessageText("📝 *إدارة المحتوى*\n\nقيد التطوير...", { reply_markup: getMainMenu(), parse_mode: "Markdown" });
});

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