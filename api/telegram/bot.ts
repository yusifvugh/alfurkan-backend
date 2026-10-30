import { Bot, Context, session, SessionFlavor } from "grammy";
import { conversations, Conversation, ConversationFlavor } from "@grammyjs/conversations";
import { parseMode } from "@grammyjs/parse-mode";
import { hydrateFiles } from "@grammyjs/files";

// ============================================
// Types
// ============================================

interface SessionData {
  adminState?: string;
  conversationData?: Record<string, unknown>;
  lastCommand?: string;
  idempotencyKey?: string;
  language?: "ar" | "en";
}

type MyContext = Context & ConversationFlavor & SessionFlavor<SessionData> & {
  session: SessionData;
};

type MyConversation = Conversation<MyContext>;

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
bot.use(hydrateFiles(bot.token));
bot.use(conversations());
bot.use(parseMode("Markdown"));

// ============================================
// Security Middleware
// ============================================

// 1. Webhook Secret Validation
bot.use(async (ctx, next) => {
  const secret = ctx.webhookReplyEnvelope?.secret_token;
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

// 3. Rate Limiting (باستخدام Vercel KV)
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id.toString();
  if (!userId) return next();
  
  const rateLimitKey = `ratelimit:${userId}`;
  try {
    const kv = (globalThis as any).kv;
    if (kv) {
      const current = (await kv.get<number>(rateLimitKey)) ?? 0;
      if (current > 30) { // 30 طلب/دقيقة
        return ctx.reply("⏳ تجاوزت حد الطلبات. انتظر دقيقة.");
      }
      await kv.set(rateLimitKey, current + 1, { ex: 60 });
    }
  } catch (e) {
    console.warn("Rate limit check failed:", e);
  }
  return next();
});

// 4. Idempotency للعمليات الخطيرة
bot.use(async (ctx, next) => {
  if (ctx.callbackQuery?.data?.startsWith("danger:")) {
    const key = `idempotency:${ctx.callbackQuery.data}`;
    try {
      const kv = (globalThis as any).kv;
      if (kv) {
        const exists = await kv.get(key);
        if (exists) return ctx.answerCallbackQuery("⚠️ تم تنفيذ هذا الأمر بالفعل");
        await kv.set(key, "done", { ex: 3600 });
      }
    } catch (e) {
      console.warn("Idempotency check failed:", e);
    }
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
    { reply_markup: getMainMenu() }
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
    `/cancel - إلغاء العملية الحالية`
  );
});

bot.command("status", async (ctx) => {
  // استيراد دوالة الفحص من monitoring
  const { getSystemStatus } = await import("../lib/monitoring/health-check");
  const status = await getSystemStatus();
  await ctx.reply(status, { parse_mode: "Markdown" });
});

bot.command("health", async (ctx) => {
  const { healthCheck } = await import("../lib/monitoring/health-check");
  const result = await healthCheck();
  const emoji = result.healthy ? "🟢" : "🔴";
  await ctx.reply(`${emoji} *فحص الصحة:* ${result.healthy ? "سليم" : "مشكلات"}\n\n${result.details}`, { parse_mode: "Markdown" });
});

bot.command("alerts", async (ctx) => {
  const { getRecentAlerts } = await import("../lib/sentry/alerts");
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
  await ctx.reply("✅ تم إلغاء العملية الحالية.", { reply_markup: getMainMenu() });
});

// ============================================
// Menu Navigation
// ============================================

bot.callbackQuery("menu:main", async (ctx) => {
  await ctx.editMessageText("🤖 *مركز تحكم الفُرقان*\n\nاختر قسم الإدارة:", { reply_markup: getMainMenu() });
});

bot.callbackQuery("menu:announcements", async (ctx) => {
  const { announcementsMenu } = await import("./commands/announcements");
  await announcementsMenu(ctx);
});

bot.callbackQuery("menu:notifications", async (ctx) => {
  const { notificationsMenu } = await import("./commands/notifications");
  await notificationsMenu(ctx);
});

bot.callbackQuery("menu:settings", async (ctx) => {
  const { settingsMenu } = await import("./commands/settings");
  await settingsMenu(ctx);
});

bot.callbackQuery("menu:monitoring", async (ctx) => {
  const { monitoringMenu } = await import("./commands/monitoring");
  await monitoringMenu(ctx);
});

bot.callbackQuery("menu:content", async (ctx) => {
  await ctx.editMessageText("📝 *إدارة المحتوى*\n\nقيد التطوير...", { reply_markup: getMainMenu() });
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