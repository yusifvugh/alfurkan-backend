import { Context, InlineKeyboard } from "grammy";
import { MyContext } from "../bot.js";
import { createClient } from "@supabase/supabase-js";
import { getEnv } from "../../utils/env.js";

const supabase = createClient(
  getEnv("SUPABASE_URL"),
  getEnv("SUPABASE_SERVICE_ROLE_KEY")
);

interface SystemConfig {
  maintenanceMode: boolean;
  maintenanceMessage: string;
  forceUpdateVersion: string | null;
  minSupportedVersion: string;
  announcementsEnabled: boolean;
  maxAnnouncementPriority: "high" | "medium" | "low";
  autoArchiveDays: number;
  notificationsEnabled: boolean;
  maxDailyNotificationsPerUser: number;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  alertingEnabled: boolean;
  crashAlertThreshold: number;
  performanceAlertThresholdMs: number;
  errorRateAlertThreshold: number;
  fcmEnabled: boolean;
  sentryEnabled: boolean;
  supabaseEnabled: boolean;
  latestVersion: string;
  latestBuildNumber: number;
  releaseNotesUrl: string;
}

async function getSystemConfig(): Promise<SystemConfig> {
  const { data, error } = await supabase
    .from("system_config")
    .select("key, value")
    .in("key", [
      "maintenance_mode", "maintenance_message", "force_update_version",
      "min_supported_version", "announcements_enabled", "max_announcement_priority",
      "auto_archive_days", "notifications_enabled", "max_daily_notifications_per_user",
      "quiet_hours_enabled", "quiet_hours_start", "quiet_hours_end",
      "alerting_enabled", "crash_alert_threshold", "performance_alert_threshold_ms",
      "error_rate_alert_threshold", "fcm_enabled", "sentry_enabled", "supabase_enabled",
      "latest_version", "latest_build_number", "release_notes_url"
    ]);
  
  if (error) throw error;
  
  const config: Partial<SystemConfig> = {};
  data?.forEach(row => {
    config[row.key as keyof SystemConfig] = row.value;
  });
  
  return {
    maintenanceMode: config.maintenanceMode ?? false,
    maintenanceMessage: config.maintenanceMessage ?? "التطبيق تحت الصيانة، سيعمل قريباً",
    forceUpdateVersion: config.forceUpdateVersion ?? null,
    minSupportedVersion: config.minSupportedVersion ?? "1.0.0",
    announcementsEnabled: config.announcementsEnabled ?? true,
    maxAnnouncementPriority: config.maxAnnouncementPriority ?? "high",
    autoArchiveDays: config.autoArchiveDays ?? 30,
    notificationsEnabled: config.notificationsEnabled ?? true,
    maxDailyNotificationsPerUser: config.maxDailyNotificationsPerUser ?? 5,
    quietHoursEnabled: config.quietHoursEnabled ?? true,
    quietHoursStart: config.quietHoursStart ?? "22:00",
    quietHoursEnd: config.quietHoursEnd ?? "08:00",
    alertingEnabled: config.alertingEnabled ?? true,
    crashAlertThreshold: config.crashAlertThreshold ?? 10,
    performanceAlertThresholdMs: config.performanceAlertThresholdMs ?? 3000,
    errorRateAlertThreshold: config.errorRateAlertThreshold ?? 5,
    fcmEnabled: config.fcmEnabled ?? true,
    sentryEnabled: config.sentryEnabled ?? true,
    supabaseEnabled: config.supabaseEnabled ?? true,
    latestVersion: config.latestVersion ?? "1.0.0",
    latestBuildNumber: config.latestBuildNumber ?? 1,
    releaseNotesUrl: config.releaseNotesUrl ?? "https://github.com/yusifvugh/al-furkan/releases",
  };
}

async function updateSystemConfig(updates: Partial<SystemConfig>) {
  const updatesArray = Object.entries(updates).map(([key, value]) => ({
    key,
    value,
    updated_by: 0,
    updated_at: new Date().toISOString(),
  }));
  
  const { error } = await supabase.from("system_config").upsert(updatesArray);
  if (error) throw error;
}

// ============================================
// Settings Menu
// ============================================

export async function settingsMenu(ctx: MyContext) {
  const config = await getSystemConfig();
  
  const keyboard = new InlineKeyboard()
    .text(`${config.maintenanceMode ? "🔴" : "🟢"} وضع الصيانة`, "set:maint")
    .text(`${config.announcementsEnabled ? "🟢" : "🔴"} الإعلانات`, "set:ann")
    .row()
    .text(`${config.notificationsEnabled ? "🟢" : "🔴"} الإشعارات`, "set:notif")
    .text(`${config.alertingEnabled ? "🟢" : "🔴"} التنبيهات`, "set:alerts")
    .row()
    .text("📋 عرض الإعدادات الكاملة", "set:view")
    .text("🔙 القائمة الرئيسية", "menu:main");
  
  await ctx.editMessageText(
    `⚙️ *إعدادات النظام*\n\n` +
    `الإصدار الحالي: \`${config.latestVersion}\` (${config.latestBuildNumber})\n` +
    `أدنى إصدار مدعوم: \`${config.minSupportedVersion}\`\n` +
    `وضع الصيانة: ${config.maintenanceMode ? "🔴 مفعل" : "🟢 معطل"}\n`,
    { parse_mode: "Markdown", reply_markup: keyboard }
  );
}

export async function viewAllSettings(ctx: MyContext) {
  const config = await getSystemConfig();
  
  let msg = `📋 *جميع إعدادات النظام*\n\n`;
  
  msg += `🏗️ *النظام:*\n`;
  msg += `   • الإصدار: \`${config.latestVersion}\` (${config.latestBuildNumber})\n`;
  msg += `   • أدنى مدعوم: \`${config.minSupportedVersion}\`\n`;
  msg += `   • الصيانة: ${config.maintenanceMode ? "🔴" : "🟢"}\n`;
  msg += `   • رسالة الصيانة: ${config.maintenanceMessage}\n\n`;
  
  msg += `📢 *الإعلانات:*\n`;
  msg += `   • مفعلة: ${config.announcementsEnabled ? "🟢" : "🔴"}\n`;
  msg += `   • أولوية قصوى: ${config.maxAnnouncementPriority}\n`;
  msg += `   • أرشفة تلقائية: ${config.autoArchiveDays} يوم\n\n`;
  
  msg += `🔔 *الإشعارات:*\n`;
  msg += `   • مفعلة: ${config.notificationsEnabled ? "🟢" : "🔴"}\n`;
  msg += `   • حد يومي/مستخدم: ${config.maxDailyNotificationsPerUser}\n`;
  msg += `   • ساعات الهدوء: ${config.quietHoursEnabled ? "🟢" : "🔴"}\n`;
  msg += `   • من: ${config.quietHoursStart} إلى ${config.quietHoursEnd}\n\n`;
  
  msg += `📊 *المراقبة:*\n`;
  msg += `   • التنبيهات: ${config.alertingEnabled ? "🟢" : "🔴"}\n`;
  msg += `   • عتبة الانهيارات: ${config.crashAlertThreshold}/ساعة\n`;
  msg += `   • عتبة الأداء: ${config.performanceAlertThresholdMs}ms\n`;
  msg += `   • عتبة معدل الأخطاء: ${config.errorRateAlertThreshold}%\n\n`;
  
  msg += `☁️ *الخدمات:*\n`;
  msg += `   • FCM: ${config.fcmEnabled ? "🟢" : "🔴"}\n`;
  msg += `   • Sentry: ${config.sentryEnabled ? "🟢" : "🔴"}\n`;
  msg += `   • Supabase: ${config.supabaseEnabled ? "🟢" : "🔴"}\n`;
  
  const keyboard = new InlineKeyboard()
    .text("🔙 العودة", "menu:settings");
  
  await ctx.editMessageText(msg, { parse_mode: "Markdown", reply_markup: keyboard });
}

// ============================================
// Toggle Setting with Confirmation
// ============================================

export async function toggleSetting(ctx: MyContext, key: keyof SystemConfig) {
  const config = await getSystemConfig();
  const currentValue = config[key];
  const newValue = typeof currentValue === "boolean" ? !currentValue : currentValue;
  
  const confirmKeyboard = new InlineKeyboard()
    .text("✅ نعم، أعد التغيير", `confirm_toggle:${key}:${newValue}`)
    .text("❌ لا، تراجع", `confirm_toggle:${key}:${currentValue}`);
  
  await ctx.reply(
    `⚠️ *تأكيد تغيير الإعداد*\n\n` +
    `الإعداد: \`${key}\`\n` +
    `القيمة الحالية: \`${currentValue}\`\n` +
    `القيمة الجديدة: \`${newValue}\`\n\n` +
    `هل أنت متأكد؟`,
    { parse_mode: "Markdown", reply_markup: confirmKeyboard }
  );
}

export async function confirmToggleSetting(ctx: MyContext, key: string, value: string) {
  const parsedValue = value === "true" ? true : value === "false" ? false : value;
  await updateSystemConfig({ [key]: parsedValue } as Partial<SystemConfig>);
  
  await supabase.from("audit_logs").insert({
    action: "config_changed",
    entity_type: "system_config",
    entity_id: key,
    user_id: ctx.from!.id,
    metadata: { key, new_value: value },
  });
  
  await ctx.answerCallbackQuery("✅ تم تحديث الإعداد");
  await settingsMenu(ctx);
}

// ============================================
// Specific Setting Handlers
// ============================================

export async function handleMaintenanceToggle(ctx: MyContext) {
  await toggleSetting(ctx, "maintenanceMode");
}

export async function handleAnnouncementsToggle(ctx: MyContext) {
  await toggleSetting(ctx, "announcementsEnabled");
}

export async function handleNotificationsToggle(ctx: MyContext) {
  await toggleSetting(ctx, "notificationsEnabled");
}

export async function handleAlertsToggle(ctx: MyContext) {
  await toggleSetting(ctx, "alertingEnabled");
}

// ============================================
// Register Callbacks
// ============================================

export function registerSettingsCallbacks(bot: any) {
  bot.callbackQuery("set:maint", handleMaintenanceToggle);
  bot.callbackQuery("set:ann", handleAnnouncementsToggle);
  bot.callbackQuery("set:notif", handleNotificationsToggle);
  bot.callbackQuery("set:alerts", handleAlertsToggle);
  bot.callbackQuery("set:view", viewAllSettings);
  
  bot.callbackQuery(/confirm_toggle:(.+):(.+)/, (ctx: any) => 
    confirmToggleSetting(ctx, ctx.match[1], ctx.match[2])
  );
}