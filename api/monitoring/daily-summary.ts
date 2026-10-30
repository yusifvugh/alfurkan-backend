import { getEnv } from "../../lib/utils/env.js";

export default async function handler(req: Request): Promise<Response> {
  const authHeader = req.headers.get("authorization");
  const cronSecret = getEnv("CRON_SECRET");
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const sentryStats = await fetchSentryStats();
    const notificationStats = await fetchNotificationStats();
    
    const message = formatDailySummary(sentryStats, notificationStats, null);
    
    await sendTelegramMessage(getEnv("ADMIN_CHAT_ID"), message);
    
    return new Response(JSON.stringify({ ok: true, sent: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Daily summary error:", error);
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

interface SentryStats {
  totalErrors: number;
  fatalErrors: number;
  affectedUsers: number;
  newIssues: number;
  resolvedIssues: number;
  avgResponseTime: number;
  errorRate: number;
  uptime: number;
}

interface NotificationStats {
  campaignsSent: number;
  notificationsDelivered: number;
  notificationsFailed: number;
}

async function fetchSentryStats(): Promise<SentryStats> {
  try {
    const org = getEnv("SENTRY_ORG");
    const token = getEnv("SENTRY_AUTH_TOKEN");
    const project = getEnv("SENTRY_PROJECT");
    
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const url = `https://sentry.io/api/0/projects/${org}/${project}/stats/?since=${since}&resolution=1h&stat=received&stat=rejected&stat=blacklisted&stat=generated`;
    
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    interface SentryStatsResponse {
      received?: number;
    }
    
    const data = await response.json() as SentryStatsResponse[];
    
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
  } catch (e) {
    console.warn("Failed to fetch Sentry stats:", e);
    return {
      totalErrors: 0,
      fatalErrors: 0,
      affectedUsers: 0,
      newIssues: 0,
      resolvedIssues: 0,
      avgResponseTime: 0,
      errorRate: 0,
      uptime: 100,
    };
  }
}

async function fetchNotificationStats(): Promise<NotificationStats> {
  return {
    campaignsSent: 0,
    notificationsDelivered: 0,
    notificationsFailed: 0,
  };
}

function formatDailySummary(
  sentry: SentryStats,
  notifications: NotificationStats,
  monitoring: null
): string {
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

async function sendTelegramMessage(chatId: string, text: string) {
  const botToken = getEnv("TELEGRAM_BOT_TOKEN");
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });
}