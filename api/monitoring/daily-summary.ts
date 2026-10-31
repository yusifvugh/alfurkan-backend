import { getEnv } from "../../lib/utils/env.js";

export default async function handler(req: any, res?: any) {
  const isWeb = typeof req.headers?.get === "function";

  const send = (code: number, body: any) => {
    if (res && typeof res.status === "function") {
      return res.status(code).json(body);
    }
    return new Response(JSON.stringify(body), {
      status: code,
      headers: { "Content-Type": "application/json" },
    });
  };

  const authHeader = isWeb
    ? req.headers.get("authorization")
    : (req.headers?.authorization || req.headers?.Authorization);

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return send(401, { error: "Unauthorized" });
  }

  try {
    const sentryStats = await fetchSentryStats();
    const notificationStats = await fetchNotificationStats();
    
    const message = formatDailySummary(sentryStats, notificationStats, null);
    
    const adminChat = process.env.ADMIN_CHAT_ID;
    if (adminChat) {
      await sendTelegramMessage(adminChat, message);
    }
    
    return send(200, { ok: true, sent: true });
  } catch (error) {
    console.error("Daily summary error:", error);
    return send(500, { ok: false, error: String(error) });
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
    const org = process.env.SENTRY_ORG;
    const token = process.env.SENTRY_AUTH_TOKEN;
    const project = process.env.SENTRY_PROJECT;
    if (!org || !token || !project) {
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
    
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const url = `https://sentry.io/api/0/projects/${org}/${project}/stats/?since=${since}&resolution=1h&stat=received&stat=rejected&stat=blacklisted&stat=generated`;
    
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json() as { received?: number }[];
    
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
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
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
