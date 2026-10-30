import { getEnv } from "../../lib/utils/env.js";

export default async function handler(req: Request): Promise<Response> {
  const authHeader = req.headers.get("authorization");
  const cronSecret = getEnv("CRON_SECRET");
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const weeklyStats = await fetchWeeklyStats();
    const message = formatWeeklySummary(weeklyStats);
    
    await sendTelegramMessage(getEnv("ADMIN_CHAT_ID"), message);
    
    return new Response(JSON.stringify({ ok: true, sent: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Weekly summary error:", error);
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

interface WeeklyStats {
  totalErrors: number;
  fatalErrors: number;
  affectedUsers: number;
  newIssues: number;
  resolvedIssues: number;
  topErrors: Array<{ title: string; count: number; users: number }>;
  performance: {
    avgResponseTime: number;
    errorRate: number;
    uptime: number;
  };
  notifications: {
    campaigns: number;
    delivered: number;
    failed: number;
  };
  services: Record<string, { up: number; down: number }>;
}

async function fetchWeeklyStats(): Promise<WeeklyStats> {
  return {
    totalErrors: 0,
    fatalErrors: 0,
    affectedUsers: 0,
    newIssues: 0,
    resolvedIssues: 0,
    topErrors: [],
    performance: {
      avgResponseTime: 0,
      errorRate: 0,
      uptime: 100,
    },
    notifications: {
      campaigns: 0,
      delivered: 0,
      failed: 0,
    },
    services: {},
  };
}

function formatWeeklySummary(stats: WeeklyStats): string {
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString("ar-SA");
  const weekEnd = new Date().toLocaleDateString("ar-SA");
  
  let msg = `📅 *الملخص الأسبوعي (${weekStart} - ${weekEnd})*\n\n`;
  
  msg += `📊 *الأخطاء:*\n`;
  msg += `   • إجمالي: ${stats.totalErrors}\n`;
  msg += `   • حرجة: ${stats.fatalErrors}\n`;
  msg += `   • مستخدمون متأثرون: ${stats.affectedUsers}\n`;
  msg += `   • قضايا جديدة: ${stats.newIssues}\n`;
  msg += `   • قضايا محلولة: ${stats.resolvedIssues}\n\n`;
  
  if (stats.topErrors.length > 0) {
    msg += `🔴 *أكثر الأخطاء تكراراً:*\n`;
    for (const err of stats.topErrors.slice(0, 5)) {
      msg += `   • ${err.title}: ${err.count} مرة (${err.users} مستخدم)\n`;
    }
    msg += "\n";
  }
  
  msg += `📈 *الأداء:*\n`;
  msg += `   • متوسط الاستجابة: ${stats.performance.avgResponseTime}ms\n`;
  msg += `   • معدل الأخطاء: ${stats.performance.errorRate}%\n`;
  msg += `   • Uptime: ${stats.performance.uptime}%\n\n`;
  
  msg += `🔔 *الإشعارات:*\n`;
  msg += `   • حملات: ${stats.notifications.campaigns}\n`;
  msg += `   • مسلمة: ${stats.notifications.delivered}\n`;
  msg += `   • فاشلة: ${stats.notifications.failed}\n\n`;
  
  msg += `🏥 *توافر الخدمات:*\n`;
  for (const [service, data] of Object.entries(stats.services)) {
    const total = data.up + data.down;
    const pct = total > 0 ? Math.round((data.up / total) * 100) : 100;
    msg += `   ${pct >= 99 ? "🟢" : pct >= 95 ? "🟡" : "🔴"} ${service}: ${pct}%\n`;
  }
  
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