import { Context, InlineKeyboard } from "grammy";
import { MyContext } from "../bot.js";
import { getEnv } from "../../utils/env.js";
import { healthCheck, getSystemStatus, performHealthChecks } from "../../monitoring/health-check.js";
import { fetchSentryIssues, fetchSentryIssue, updateSentryIssueStatus } from "../../sentry/alerts.js";

interface SentryIssue {
  id: string;
  title: string;
  level: "fatal" | "error" | "warning" | "info";
  version?: string;
  userCount?: number;
  count: number;
  firstSeen: string;
  lastSeen: string;
  status: "unresolved" | "resolved" | "ignored";
  platform: string;
  stacktrace?: string;
  permalink: string;
  url: string;
}

// ============================================
// Monitoring Menu
// ============================================

export async function monitoringMenu(ctx: MyContext) {
  const keyboard = new InlineKeyboard()
    .text("🏥 حالة الخدمات", "mon:health")
    .text("💥 أحدث الأخطاء", "mon:errors")
    .row()
    .text("🔴 الأخطاء الحرجة", "mon:critical")
    .text("🔄 الأخطاء المتكررة", "mon:recurring")
    .row()
    .text("📱 أكثر الإصدارات مشاكل", "mon:versions")
    .text("📊 تقارير الأداء", "mon:performance")
    .row()
    .text("📜 سجل التنبيهات", "mon:alerts")
    .text("📅 ملخص يومي/أسبوعي", "mon:summary")
    .row()
    .text("🔙 القائمة الرئيسية", "menu:main");
  
  await ctx.editMessageText("📊 *مركز المراقبة*", {
    reply_markup: keyboard,
  });
}

// ============================================
// Health Check
// ============================================

export async function healthCommand(ctx: MyContext) {
  const result = await performHealthChecks();
  const allHealthy = result.healthy;
  const statusEmoji = allHealthy ? "🟢" : "🔴";
  
  let msg = `${statusEmoji} *حالة الخدمات* (${new Date(result.timestamp).toLocaleString("ar-SA")})\n\n`;
  
  for (const check of result.checks) {
    const emoji = check.status === "healthy" ? "🟢" : 
                  check.status === "degraded" ? "🟡" : "🔴";
    msg += `${emoji} *${check.name}*: ${check.status.toUpperCase()}`;
    if (check.latencyMs) msg += ` (${check.latencyMs}ms)`;
    msg += `\n   └ ${check.details}\n`;
  }
  
  const keyboard = new InlineKeyboard()
    .text("🔄 تحديث", "mon:health")
    .text("🔙 العودة", "menu:monitoring");
  
  await ctx.reply(msg, { parse_mode: "Markdown", reply_markup: keyboard });
}

// ============================================
// Errors List
// ============================================

export async function errorsCommand(ctx: MyContext) {
  try {
    const issues = await fetchSentryIssues({ 
      limit: 10, 
      status: "unresolved",
      sort: "lastSeen",
    });
    
    if (!issues.length) {
      return ctx.reply("✅ لا توجد أخطاء غير محلولة حالياً.");
    }
    
    let msg = "💥 *أحدث الأخطاء غير المحلولة*\n\n";
    
    for (const issue of issues) {
      const levelEmoji = issue.level === "fatal" ? "🔴" : 
                         issue.level === "error" ? "🟠" : "🟡";
      msg += `${levelEmoji} *${issue.title}*\n`;
      msg += `   📱 الإصدار: \`${issue.version || "غير معروف"}\`\n`;
      msg += `   👥 المستخدمون: ${issue.userCount || "غير متاح"}\n`;
      msg += `   📊 الأحداث: ${issue.count}\n`;
      msg += `   🕐 آخر ظهور: ${formatRelativeTime(issue.lastSeen)}\n`;
      msg += `   🔗 [عرض في Sentry](${issue.url})\n\n`;
    }
    
    const keyboard = new InlineKeyboard()
      .text("🔴 عرض الحرجة فقط", "mon:critical")
      .text("🔄 تحديث", "mon:errors")
      .row()
      .text("🔙 العودة", "menu:monitoring");
    
    await ctx.reply(msg, { parse_mode: "Markdown", reply_markup: keyboard });
  } catch (error) {
    console.error("Errors command error:", error);
    await ctx.reply("❌ تعذر جلب الأخطاء من Sentry");
  }
}

// ============================================
// Critical Errors
// ============================================

export async function criticalErrorsCommand(ctx: MyContext) {
  try {
    const issues = await fetchSentryIssues({ 
      limit: 10, 
      status: "unresolved",
      sort: "lastSeen",
      level: "fatal",
    });
    
    if (!issues.length) {
      return ctx.reply("✅ لا توجد أخطاء حرجة (Fatal) غير محلولة.");
    }
    
    let msg = "🔴 *الأخطاء الحرجة (Fatal)*\n\n";
    
    for (const issue of issues) {
      msg += `🔴 *${issue.title}*\n`;
      msg += `   📱 الإصدار: \`${issue.version || "غير معروف"}\`\n`;
      msg += `   👥 المستخدمون: ${issue.userCount || "غير متاح"}\n`;
      msg += `   📊 الأحداث: ${issue.count}\n`;
      msg += `   🕐 آخر ظهور: ${formatRelativeTime(issue.lastSeen)}\n`;
      msg += `   🔗 [عرض في Sentry](${issue.url})\n\n`;
    }
    
    const keyboard = new InlineKeyboard()
      .text("🔄 تحديث", "mon:critical")
      .text("🔙 العودة", "menu:monitoring");
    
    await ctx.reply(msg, { parse_mode: "Markdown", reply_markup: keyboard });
  } catch (error) {
    console.error("Critical errors command error:", error);
    await ctx.reply("❌ تعذر جلب الأخطاء الحرجة من Sentry");
  }
}

// ============================================
// Recurring Errors
// ============================================

export async function recurringErrorsCommand(ctx: MyContext) {
  try {
    const issues = await fetchSentryIssues({ 
      limit: 10, 
      status: "unresolved",
      sort: "count",
    });
    
    if (!issues.length) {
      return ctx.reply("✅ لا توجد أخطاء متكررة.");
    }
    
    let msg = "🔄 *الأخطاء المتكررة (الأكثر تكراراً)*\n\n";
    
    for (const issue of issues) {
      const levelEmoji = issue.level === "fatal" ? "🔴" : 
                         issue.level === "error" ? "🟠" : "🟡";
      msg += `${levelEmoji} *${issue.title}*\n`;
      msg += `   📱 الإصدار: \`${issue.version || "غير معروف"}\`\n`;
      msg += `   👥 المستخدمون: ${issue.userCount || "غير متاح"}\n`;
      msg += `   📊 الأحداث: ${issue.count}\n`;
      msg += `   🕐 آخر ظهور: ${formatRelativeTime(issue.lastSeen)}\n`;
      msg += `   🔗 [عرض في Sentry](${issue.url})\n\n`;
    }
    
    const keyboard = new InlineKeyboard()
      .text("🔄 تحديث", "mon:recurring")
      .text("🔙 العودة", "menu:monitoring");
    
    await ctx.reply(msg, { parse_mode: "Markdown", reply_markup: keyboard });
  } catch (error) {
    console.error("Recurring errors command error:", error);
    await ctx.reply("❌ تعذر جلب الأخطاء المتكررة من Sentry");
  }
}

// ============================================
// Issue Detail
// ============================================

export async function issueDetailCommand(ctx: MyContext, issueId: string) {
  try {
    const issue = await fetchSentryIssue(issueId);
    
    if (!issue) {
      return ctx.answerCallbackQuery("❌ لم يتم العثور على المشكلة");
    }
    
    const statusKeyboard = new InlineKeyboard()
      .text("✅ تم الاعتراف", `issue:status:${issueId}:acknowledged`)
      .text("🔍 قيد التحقيق", `issue:status:${issueId}:investigating`)
      .row()
      .text("✅ تم الحل", `issue:status:${issueId}:resolved`)
      .text("📝 إضافة ملاحظة", `issue:note:${issueId}`)
      .row()
      .text("🔙 العودة", "mon:errors");
    
    await ctx.editMessageText(
      `🔍 *تفاصيل المشكلة*\n\n` +
      `*العنوان:* ${issue.title}\n` +
      `*المستوى:* ${issue.level}\n` +
      `*الحالة:* ${translateStatus(issue.status)}\n` +
      `*الإصدار:* ${issue.version || "غير معروف"}\n` +
      `*الأحداث:* ${issue.count}\n` +
      `*المستخدمون:* ${issue.userCount || "غير متاح"}\n` +
      `*أول ظهور:* ${formatDate(issue.firstSeen)}\n` +
      `*آخر ظهور:* ${formatDate(issue.lastSeen)}\n` +
      `*المنصة:* ${issue.platform}\n\n` +
      `*Stack Trace:*\n\`\`\`\n${issue.stacktrace?.slice(0, 500) || "غير متاح"}\n\`\`\`\n\n` +
      `[🔗 التقرير الكامل في Sentry](${issue.url})`,
      { parse_mode: "Markdown", reply_markup: statusKeyboard }
    );
  } catch (error) {
    console.error("Issue detail error:", error);
    await ctx.answerCallbackQuery("❌ تعذر جلب تفاصيل المشكلة");
  }
}

// ============================================
// Issue Status Update
// ============================================

export async function updateIssueStatus(ctx: MyContext, issueId: string, status: string) {
  try {
    await updateSentryIssueStatus(issueId, status);
    await ctx.answerCallbackQuery(`✅ تم تحديث الحالة إلى: ${translateStatus(status)}`);
    await issueDetailCommand(ctx, issueId);
  } catch (error) {
    console.error("Update issue status error:", error);
    await ctx.answerCallbackQuery("❌ تعذر تحديث الحالة");
  }
}

// ============================================
// Versions Report
// ============================================

export async function versionsReportCommand(ctx: MyContext) {
  try {
    const issues = await fetchSentryIssues({ 
      limit: 50, 
      status: "unresolved",
    });
    
    // تجميع حسب الإصدار
    const versionStats: Record<string, { count: number; users: number; issues: string[] }> = {};
    
    for (const issue of issues) {
      const version = issue.version || "غير معروف";
      if (!versionStats[version]) {
        versionStats[version] = { count: 0, users: 0, issues: [] };
      }
      versionStats[version].count += issue.count;
      versionStats[version].users += issue.userCount || 0;
      versionStats[version].issues.push(issue.title);
    }
    
    // ترتيب حسب عدد الأحداث
    const sorted = Object.entries(versionStats)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10);
    
    if (sorted.length === 0) {
      return ctx.reply("✅ لا توجد بيانات أخطاء متاحة.");
    }
    
    let msg = "📱 *أكثر الإصدارات تعرضاً للمشاكل*\n\n";
    
    for (const [version, stats] of sorted) {
      msg += `📱 *الإصدار \`${version}\`*\n`;
      msg += `   📊 أحداث: ${stats.count} | 👥 مستخدمون: ${stats.users}\n`;
      msg += `   🐛 قضايا: ${stats.issues.length}\n\n`;
    }
    
    const keyboard = new InlineKeyboard()
      .text("🔄 تحديث", "mon:versions")
      .text("🔙 العودة", "menu:monitoring");
    
    await ctx.reply(msg, { parse_mode: "Markdown", reply_markup: keyboard });
  } catch (error) {
    console.error("Versions report error:", error);
    await ctx.reply("❌ تعذر جلب تقرير الإصدارات");
  }
}

// ============================================
// Performance Report
// ============================================

export async function performanceReportCommand(ctx: MyContext) {
  try {
    const result = await performHealthChecks();
    
    let msg = "📊 *تقارير الأداء*\n\n";
    
    msg += `⏱️ *آخر فحص:* ${new Date(result.timestamp).toLocaleString("ar-SA")}\n\n`;
    
    for (const check of result.checks) {
      const emoji = check.status === "healthy" ? "🟢" : 
                    check.status === "degraded" ? "🟡" : "🔴";
      msg += `${emoji} *${check.name}*: `;
      if (check.latencyMs) {
        msg += `${check.latencyMs}ms`;
      } else {
        msg += "غير متاح";
      }
      msg += `\n`;
    }
    
    msg += `\n📈 *إحصائيات Sentry (24 ساعة):*\n`;
    msg += `   • متوسط زمن الاستجابة: غير متاح\n`;
    msg += `   • معدل الأخطاء: غير متاح\n`;
    msg += `   • Uptime: غير متاح\n`;
    
    const keyboard = new InlineKeyboard()
      .text("🔄 تحديث", "mon:performance")
      .text("🔙 العودة", "menu:monitoring");
    
    await ctx.reply(msg, { parse_mode: "Markdown", reply_markup: keyboard });
  } catch (error) {
    console.error("Performance report error:", error);
    await ctx.reply("❌ تعذر جلب تقرير الأداء");
  }
}

// ============================================
// Alerts History
// ============================================

export async function alertsHistoryCommand(ctx: MyContext) {
  // Note: In production, fetch from database
  await ctx.reply("📜 *سجل التنبيهات*\n\nقيد التطوير - سيتم جلب السجل من قاعدة البيانات", { parse_mode: "Markdown" });
}

// ============================================
// Summary (Daily/Weekly)
// ============================================

export async function summaryCommand(ctx: MyContext) {
  const keyboard = new InlineKeyboard()
    .text("📅 الملخص اليومي", "mon:daily")
    .text("📅 الملخص الأسبوعي", "mon:weekly")
    .row()
    .text("🔙 العودة", "menu:monitoring");
  
  await ctx.editMessageText("📅 *الملخصات الدورية*\n\nاختر نوع الملخص:", {
    reply_markup: keyboard,
  });
}

export async function dailySummaryCommand(ctx: MyContext) {
  await ctx.reply("📅 *الملخص اليومي*\n\nجاري التحضير...", { parse_mode: "Markdown" });
}

export async function weeklySummaryCommand(ctx: MyContext) {
  await ctx.reply("📅 *الملخص الأسبوعي*\n\nجاري التحضير...", { parse_mode: "Markdown" });
}

// ============================================
// Helpers
// ============================================

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return "الآن";
  if (diffMins < 60) return `منذ ${diffMins} دقيقة`;
  if (diffHours < 24) return `منذ ${diffHours} ساعة`;
  return `منذ ${diffDays} يوم`;
}

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleString("ar-SA");
}

function translateStatus(status: string): string {
  switch (status) {
    case "unresolved": return "غير محلولة";
    case "resolved": return "محلولة";
    case "ignored": return "متجاهلة";
    default: return status;
  }
}

// ============================================
// Register Callbacks
// ============================================

export function registerMonitoringCallbacks(bot: any) {
  bot.callbackQuery("mon:health", healthCommand);
  bot.callbackQuery("mon:errors", errorsCommand);
  bot.callbackQuery("mon:critical", criticalErrorsCommand);
  bot.callbackQuery("mon:recurring", recurringErrorsCommand);
  bot.callbackQuery("mon:versions", versionsReportCommand);
  bot.callbackQuery("mon:performance", performanceReportCommand);
  bot.callbackQuery("mon:alerts", alertsHistoryCommand);
  bot.callbackQuery("mon:summary", summaryCommand);
  bot.callbackQuery("mon:daily", dailySummaryCommand);
  bot.callbackQuery("mon:weekly", weeklySummaryCommand);
  
  bot.callbackQuery(/mon:issue:(.+)/, (ctx: any) => issueDetailCommand(ctx, ctx.match[1]));
  bot.callbackQuery(/issue:status:(.+):(.+)/, (ctx: any) => 
    updateIssueStatus(ctx, ctx.match[1], ctx.match[2])
  );
}