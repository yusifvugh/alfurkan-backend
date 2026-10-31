import { Bot, Context, session, SessionFlavor, InlineKeyboard } from "grammy";
import { conversations, Conversation, ConversationFlavor, createConversation } from "@grammyjs/conversations";
import { registerAnnouncementCallbacks, createAnnouncementConversation, announcementsMenu } from "./commands/announcements.js";
import { registerNotificationCallbacks, createNotificationConversation, notificationsMenu } from "./commands/notifications.js";
import { registerSettingsCallbacks, settingsMenu } from "./commands/settings.js";
import { registerMonitoringCallbacks, monitoringMenu } from "./commands/monitoring.js";
import { registerContentCallbacks, contentMenu } from "./commands/content.js";
import { supabase } from "../supabase/client.js";
import { getSystemStatus, healthCheck } from "../monitoring/health-check.js";
import { getRecentAlerts } from "../sentry/alerts.js";

// ============================================
// Types
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
// Environment & Security
// ============================================

const BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "PLACEHOLDER_TOKEN").trim().replace(/^["']|["']$/g, "");
const rawAdminIds = (process.env.AUTHORIZED_ADMIN_IDS || "").trim().replace(/^["']|["']$/g, "");
const AUTHORIZED_ADMINS = rawAdminIds
  .split(",")
  .map(s => s.trim().replace(/^@/, "").replace(/^["']|["']$/g, ""))
  .filter(Boolean);

const APP_VERSION = process.env.APP_VERSION ?? "1.0.0";

// ============================================
// Bot Initialization
// ============================================

export const bot = new Bot<MyContext>(BOT_TOKEN);

// Setup middleware
bot.use(session({ initial: () => ({}) }));
bot.use(conversations());

// Register conversations
bot.use(createConversation(createAnnouncementConversation, "createAnnouncement"));
bot.use(createConversation(createNotificationConversation, "createNotification"));

// ============================================
// Security Middleware (Admin Authorization)
// ============================================

bot.use(async (ctx, next) => {
  const userId = ctx.from?.id.toString();
  const username = ctx.from?.username;

  // Filter out any default placeholder strings
  const validAdmins = AUTHORIZED_ADMINS.filter(
    id => id && id !== "your-telegram-user-id" && id !== "PLACEHOLDER"
  );

  const isAuthorized = validAdmins.length === 0 || 
    (userId && validAdmins.includes(userId)) ||
    (username && validAdmins.includes(username));

  if (!isAuthorized) {
    await ctx.reply(
      `🚫 <b>غير مصرح لك بالوصول</b>\n\n` +
      `هذا البوت مخصص لإدارة تطبيق <b>الفُرقان</b> فقط.\n\n` +
      `🆔 <b>معرف حسابك (User ID):</b> <code>${userId}</code>\n` +
      (username ? `👤 <b>اسم المستخدم:</b> @${username}\n\n` : `\n`) +
      `💡 <b>لتفعيل الحساب كمسؤول:</b>\n` +
      `أضف المعرف <code>${userId}</code> إلى المتغير <code>AUTHORIZED_ADMIN_IDS</code> في إعدادات Vercel.`,
      { parse_mode: "HTML" }
    );
    return;
  }
  return next();
});

// ============================================
// Helper with Timeout
// ============================================

function withTimeout<T>(promise: PromiseLike<T>, ms: number, fallback: T): Promise<T> {
  let timer: any;
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// ============================================
// Live Dashboard Builder
// ============================================

export async function buildDashboardData() {
  const emptyRes = { count: 0, data: null, error: null };

  const [
    usersRes,
    activeAnnRes,
    campaignsRes,
    configRes,
  ] = await Promise.allSettled([
    withTimeout(supabase.from("app_users").select("device_id", { count: "exact", head: true }), 2500, emptyRes as any),
    withTimeout(supabase.from("announcements").select("id", { count: "exact", head: true }).eq("is_published", true), 2500, emptyRes as any),
    withTimeout(supabase.from("notification_campaigns").select("id", { count: "exact", head: true }), 2500, emptyRes as any),
    withTimeout(supabase.from("system_config").select("key, value").in("key", ["maintenance_mode", "min_supported_version", "latest_version"]), 2500, emptyRes as any),
  ]);

  const userCount = usersRes.status === "fulfilled" && usersRes.value.count !== null ? usersRes.value.count : 0;
  const annCount = activeAnnRes.status === "fulfilled" && activeAnnRes.value.count !== null ? activeAnnRes.value.count : 0;
  const campCount = campaignsRes.status === "fulfilled" && campaignsRes.value.count !== null ? campaignsRes.value.count : 0;

  let isMaintenance = false;
  let minVer = "1.0.0";
  let latestVer = APP_VERSION;

  if (configRes.status === "fulfilled" && configRes.value.data) {
    for (const row of configRes.value.data) {
      if (row.key === "maintenance_mode") isMaintenance = row.value === true || row.value === "true";
      if (row.key === "min_supported_version") minVer = String(row.value ?? "1.0.0");
      if (row.key === "latest_version") latestVer = String(row.value ?? APP_VERSION);
    }
  }

  const now = new Date();
  const timeStr = now.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", hour12: true });

  const text =
    `🌟 <b>لوحة تحكّم تطبيق الفُرقان</b> 🌟\n` +
    `<i>مركز الإدارة، المراقبة والإشعارات الشامل</i>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `📊 <b>المؤشرات الحية للمنظومة:</b>\n` +
    `• 👥 المستخدمون المسجلون: <b>${userCount} مستخدم</b>\n` +
    `• 📢 الإعلانات النشطة: <b>${annCount} إعلان</b>\n` +
    `• 🔔 حملات الإشعارات: <b>${campCount} حملة</b>\n` +
    `• ⚙️ وضع الصيانة: <b>${isMaintenance ? "🔴 مفعل (التطبيق متوقف)" : "🟢 معطل (يعمل بكفاءة)"}</b>\n` +
    `• 📱 الإصدار المعتمد: <b>v${latestVer}</b> (أدنى مدعوم: v${minVer})\n` +
    `• ⚡ حالة الخادم: <b>🟢 متصل وجاهز (Vercel Production)</b>\n` +
    `• 🕒 التحديث: <b>${timeStr}</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `اختر من اللوحة التفاعلية أدناه:`;

  const keyboard = new InlineKeyboard()
    .text("📢 إدارة الإعلانات", "menu:announcements")
    .text("🔔 مركز الإشعارات", "menu:notifications")
    .row()
    .text("👥 بيانات المستخدمين", "menu:users")
    .text("⚙️ إعدادات النظام", "menu:settings")
    .row()
    .text("📊 صحة الخوادم والأداء", "menu:monitoring")
    .text("⚡ فحص فوري", "mon:quick_health")
    .row()
    .text("🔄 تحديث المؤشرات الحية", "menu:main");

  return { text, keyboard };
}

// ============================================
// Command Handlers
// ============================================

bot.command("start", async (ctx) => {
  try {
    const { text, keyboard } = await buildDashboardData();
    await ctx.reply(text, { reply_markup: keyboard, parse_mode: "HTML" });
  } catch (err) {
    console.error("Start command fallback:", err);
    await ctx.reply(
      "🌟 <b>مركز تحكم الفُرقان</b>\n\nأهلاً بك في لوحة الإدارة.\nاختر من الأقسام التالية:",
      {
        reply_markup: new InlineKeyboard()
          .text("📢 إدارة الإعلانات", "menu:announcements")
          .text("🔔 مركز الإشعارات", "menu:notifications")
          .row()
          .text("⚙️ إعدادات النظام", "menu:settings")
          .text("📊 مركز المراقبة", "menu:monitoring")
          .row()
          .text("🔄 تحديث", "menu:main"),
        parse_mode: "HTML",
      }
    );
  }
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    `📖 <b>أوامر مركز تحكم الفُرقان:</b>\n\n` +
    `/start - فتح لوحة التحكم الرئيسية\n` +
    `/status - تقرير حالة الأنظمة والخوادم\n` +
    `/health - فحص تفصيلي لصحة الربط\n` +
    `/alerts - أحدث التنبيهات والأخطاء\n` +
    `/users - إحصائيات المستخدمين والأجهزة\n` +
    `/cancel - إلغاء أي إجراء محادثة حالي\n` +
    `/help - عرض هذه القائمة`,
    { parse_mode: "HTML" }
  );
});

bot.command("status", async (ctx) => {
  const status = await getSystemStatus();
  await ctx.reply(status, { parse_mode: "Markdown" });
});

bot.command("health", async (ctx) => {
  const result = await healthCheck();
  const emoji = result.healthy ? "🟢" : "🔴";
  await ctx.reply(`${emoji} <b>فحص الصحة:</b> ${result.healthy ? "سليم تماماً" : "توجد مشكلات"}\n\n${result.details}`, { parse_mode: "HTML" });
});

bot.command("alerts", async (ctx) => {
  const alerts = await getRecentAlerts(5);
  if (alerts.length === 0) {
    return ctx.reply("✅ لا توجد تنبيهات حديثة. المنظومة مستقرة.");
  }
  let msg = "🚨 <b>أحدث التنبيهات:</b>\n\n";
  for (const alert of alerts) {
    msg += `${alert.emoji} ${alert.title}\n${alert.time}\n\n`;
  }
  await ctx.reply(msg, { parse_mode: "HTML" });
});

bot.command("users", async (ctx) => {
  await handleUsersDashboard(ctx);
});

bot.command("cancel", async (ctx) => {
  ctx.session.adminState = undefined;
  ctx.session.conversationData = undefined;
  const { keyboard } = await buildDashboardData();
  await ctx.reply("✅ تم إلغاء العملية الحالية والعودة للرئيسية.", { reply_markup: keyboard, parse_mode: "HTML" });
});

// ============================================
// Users Statistics Sub-dashboard
// ============================================

async function handleUsersDashboard(ctx: MyContext) {
  const emptyRes = { count: 0, data: null };
  const [totalRes, platformsRes, versionsRes] = await Promise.allSettled([
    withTimeout(supabase.from("app_users").select("device_id", { count: "exact", head: true }), 2500, emptyRes as any),
    withTimeout(supabase.from("app_users").select("platform"), 2500, emptyRes as any),
    withTimeout(supabase.from("app_users").select("app_version"), 2500, emptyRes as any),
  ]);

  const total = totalRes.status === "fulfilled" && totalRes.value.count !== null ? totalRes.value.count : 0;

  let androidCount = 0;
  let iosCount = 0;
  if (platformsRes.status === "fulfilled" && platformsRes.value.data) {
    for (const row of platformsRes.value.data) {
      const p = (row.platform || "").toLowerCase();
      if (p.includes("android")) androidCount++;
      else if (p.includes("ios")) iosCount++;
    }
  }

  const verMap: Record<string, number> = {};
  if (versionsRes.status === "fulfilled" && versionsRes.value.data) {
    for (const row of versionsRes.value.data) {
      const v = row.app_version || "غير معروف";
      verMap[v] = (verMap[v] || 0) + 1;
    }
  }

  const topVersions = Object.entries(verMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([v, count]) => `• v${v}: <b>${count} جهاز</b>`)
    .join("\n") || "• لا توجد بيانات كافية بعد";

  const msg =
    `👥 <b>إحصائيات مستخدمي تطبيق الفُرقان</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `📱 <b>إجمالي الأجهزة المسجلة:</b> <code>${total}</code>\n\n` +
    `🤖 <b>أجهزة Android:</b> <code>${androidCount}</code>\n` +
    `🍏 <b>أجهزة iOS:</b> <code>${iosCount}</code>\n` +
    `🌐 <b>أخرى/غير محدد:</b> <code>${Math.max(0, total - androidCount - iosCount)}</code>\n\n` +
    `📊 <b>توزيع الإصدارات:</b>\n${topVersions}\n` +
    `━━━━━━━━━━━━━━━━━━`;

  const keyboard = new InlineKeyboard()
    .text("🔄 تحديث", "menu:users")
    .text("🏠 الرئيسية", "menu:main");

  if (ctx.callbackQuery) {
    await ctx.editMessageText(msg, { reply_markup: keyboard, parse_mode: "HTML" });
  } else {
    await ctx.reply(msg, { reply_markup: keyboard, parse_mode: "HTML" });
  }
}

// ============================================
// Menu Navigation Callbacks
// ============================================

bot.callbackQuery("menu:main", async (ctx) => {
  const { text, keyboard } = await buildDashboardData();
  try {
    await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: "HTML" });
  } catch (e) {
    await ctx.reply(text, { reply_markup: keyboard, parse_mode: "HTML" });
  }
  await ctx.answerCallbackQuery("تم تحديث اللوحة بنجاح ✅");
});

bot.callbackQuery("menu:users", async (ctx) => {
  await handleUsersDashboard(ctx);
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("mon:quick_health", async (ctx) => {
  const start = Date.now();
  const { error } = await supabase.from("system_config").select("key").limit(1);
  const latency = Date.now() - start;
  const isHealthy = !error;

  const alertMsg = isHealthy
    ? `🟢 المنظومة متصلة وسليمة!\nاستجابة Supabase: ${latency}ms`
    : `🔴 تنبيه: مشكلة في الاتصال بقاعدة البيانات!\n${error?.message}`;

  await ctx.answerCallbackQuery({
    text: alertMsg,
    show_alert: true,
  });
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
  console.error("Bot runtime exception:", err);
  const ctx = err.ctx;
  if (ctx) {
    try {
      await ctx.reply("⚠️ حدث خطأ أثناء معالجة الطلب، تم تسجيل التفاصيل للمراجعة.");
    } catch (e) {
      console.error("Failed to reply with error message:", e);
    }
  }
});

export default bot;
