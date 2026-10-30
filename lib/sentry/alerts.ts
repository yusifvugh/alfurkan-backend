import { getEnv } from "../utils/env.js";

const SENTRY_ORG = getEnv("SENTRY_ORG");
const SENTRY_PROJECT = getEnv("SENTRY_PROJECT");
const SENTRY_AUTH_TOKEN = getEnv("SENTRY_AUTH_TOKEN");

const SENTRY_API_BASE = "https://sentry.io/api/0";

interface FetchIssuesOptions {
  limit?: number;
  status?: "unresolved" | "resolved" | "ignored";
  sort?: "lastSeen" | "count" | "firstSeen" | "userCount";
  level?: "fatal" | "error" | "warning" | "info";
}

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

// Internal type for Sentry API response
interface SentryApiIssue {
  id: string;
  title: string;
  level: "fatal" | "error" | "warning" | "info";
  metadata?: {
    value?: {
      version?: string;
    };
  };
  userCount?: number;
  count: number;
  firstSeen: string;
  lastSeen: string;
  status: "unresolved" | "resolved" | "ignored";
  platform: string;
  stacktrace?: {
    frames?: Array<{
      filename?: string;
      lineno?: number;
      function?: string;
    }>;
  };
  permalink: string;
}

export async function fetchSentryIssues(options: FetchIssuesOptions = {}): Promise<SentryIssue[]> {
  const params = new URLSearchParams();
  params.set("limit", String(options.limit ?? 10));
  if (options.status) params.set("status", options.status);
  if (options.sort) params.set("sort", options.sort);
  if (options.level) params.set("level", options.level);
  params.set("project", SENTRY_PROJECT);
  
  const url = `${SENTRY_API_BASE}/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/issues/?${params}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${SENTRY_AUTH_TOKEN}`,
      },
      signal: AbortSignal.timeout(10000),
    });
    
    if (!response.ok) {
      throw new Error(`Sentry API error: ${response.status}`);
    }
    
    const data = await response.json() as SentryApiIssue[];
    
    return data.map((issue) => ({
      id: issue.id,
      title: issue.title,
      level: issue.level,
      version: issue.metadata?.value?.version,
      userCount: issue.userCount,
      count: issue.count,
      firstSeen: issue.firstSeen,
      lastSeen: issue.lastSeen,
      status: issue.status,
      platform: issue.platform,
      permalink: issue.permalink,
      url: `https://sentry.io/organizations/${SENTRY_ORG}/issues/${issue.id}/`,
    }));
  } catch (error) {
    console.error("Fetch Sentry issues error:", error);
    return [];
  }
}

export async function fetchSentryIssue(issueId: string): Promise<SentryIssue | null> {
  const url = `${SENTRY_API_BASE}/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/issues/${issueId}/`;
  
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${SENTRY_AUTH_TOKEN}`,
      },
      signal: AbortSignal.timeout(10000),
    });
    
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Sentry API error: ${response.status}`);
    }
    
    const issue = await response.json() as SentryApiIssue;
    
    return {
      id: issue.id,
      title: issue.title,
      level: issue.level,
      version: issue.metadata?.value?.version,
      userCount: issue.userCount,
      count: issue.count,
      firstSeen: issue.firstSeen,
      lastSeen: issue.lastSeen,
      status: issue.status,
      platform: issue.platform,
      stacktrace: issue.stacktrace?.frames?.map((f) => 
        `${f.filename ?? ""}:${f.lineno ?? 0} in ${f.function ?? ""}`
      ).join("\n"),
      permalink: issue.permalink,
      url: `https://sentry.io/organizations/${SENTRY_ORG}/issues/${issue.id}/`,
    };
  } catch (error) {
    console.error("Fetch Sentry issue error:", error);
    return null;
  }
}

export async function updateSentryIssueStatus(issueId: string, status: string): Promise<boolean> {
  const url = `${SENTRY_API_BASE}/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/issues/${issueId}/`;
  
  const statusMap: Record<string, string> = {
    acknowledged: "unresolved",
    investigating: "unresolved",
    resolved: "resolved",
    ignored: "ignored",
  };
  
  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${SENTRY_AUTH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: statusMap[status] || status,
      }),
      signal: AbortSignal.timeout(10000),
    });
    
    return response.ok;
  } catch (error) {
    console.error("Update Sentry issue status error:", error);
    return false;
  }
}

export async function getRecentAlerts(limit: number = 5) {
  // Reuse fetchSentryIssues with appropriate options
  const issues = await fetchSentryIssues({ 
    limit, 
    status: "unresolved",
    sort: "lastSeen",
  });
  
  return issues.map(issue => ({
    emoji: issue.level === "fatal" ? "🔴" : issue.level === "error" ? "🟠" : "🟡",
    title: issue.title,
    time: `🕐 ${formatRelativeTime(issue.lastSeen)}`,
    url: issue.url,
  }));
}

// ============================================
// Alert Manager
// ============================================

interface AlertRule {
  id: string;
  name: string;
  condition: "new_crash" | "crash_spike" | "regression" | "high_impact" | "service_down";
  threshold: number;
  windowMinutes: number;
  severity: "critical" | "warning" | "info";
  cooldownMinutes: number;
  enabled: boolean;
}

const DEFAULT_ALERT_RULES: AlertRule[] = [
  {
    id: "new_fatal_crash",
    name: "Crash مميت جديد",
    condition: "new_crash",
    threshold: 1,
    windowMinutes: 5,
    severity: "critical",
    cooldownMinutes: 10,
    enabled: true,
  },
  {
    id: "crash_spike",
    name: "ارتفاع مفاجئ في الانهيارات",
    condition: "crash_spike",
    threshold: 50,
    windowMinutes: 15,
    severity: "critical",
    cooldownMinutes: 30,
    enabled: true,
  },
  {
    id: "regression_after_release",
    name: "تراجع بعد إصدار جديد",
    condition: "regression",
    threshold: 1,
    windowMinutes: 60,
    severity: "critical",
    cooldownMinutes: 60,
    enabled: true,
  },
  {
    id: "high_user_impact",
    name: "تأثير على عدد كبير من المستخدمين",
    condition: "high_impact",
    threshold: 100,
    windowMinutes: 30,
    severity: "critical",
    cooldownMinutes: 30,
    enabled: true,
  },
  {
    id: "service_degradation",
    name: "تراجع أداء الخدمة",
    condition: "service_down",
    threshold: 1,
    windowMinutes: 5,
    severity: "warning",
    cooldownMinutes: 15,
    enabled: true,
  },
];

export async function processNewIssueAlert(issue: SentryIssue) {
  for (const rule of DEFAULT_ALERT_RULES.filter(r => r.enabled && r.condition === "new_crash")) {
    if (issue.level === "fatal" && await shouldAlert(rule, issue)) {
      await sendCriticalTelegramAlert({
        type: "new_fatal_crash",
        title: `🔴 Crash مميت جديد: ${issue.title}`,
        message: formatIssueAlert(issue),
        issueUrl: issue.url,
        severity: "critical",
      });
      await setCooldown(rule.id);
    }
  }
  
  await groupSimilarIssues(issue);
}

export async function processMetricAlert(alertRule: any, trigger: any) {
  console.log("Metric alert:", alertRule.name, trigger);
}

export async function shouldAlert(rule: AlertRule, issue: SentryIssue): Promise<boolean> {
  const cooldownKey = `cooldown:${rule.id}`;
  // Note: In production, use a proper cache like Redis/Upstash
  // For now, we skip cooldown in this simplified version
  // const lastAlert = await (globalThis as any).kv?.get<number>(cooldownKey);
  // if (lastAlert && Date.now() - lastAlert < rule.cooldownMinutes * 60 * 1000) {
  //   return false;
  // }
  
  switch (rule.condition) {
    case "new_crash":
      return issue.level === "fatal";
    case "high_impact":
      return (issue.userCount ?? 0) >= rule.threshold;
    case "crash_spike":
      return false;
    default:
      return false;
  }
}

async function setCooldown(ruleId: string) {
  // await (globalThis as any).kv?.set(`cooldown:${ruleId}`, Date.now(), { ex: 3600 });
}

async function groupSimilarIssues(issue: SentryIssue) {
  // const groupKey = `issue_group:${issue.title.slice(0, 50)}`;
  // const count = ((globalThis as any).kv?.get<number>(groupKey) ?? 0) + 1;
  // await (globalThis as any).kv?.set(groupKey, count, { ex: 86400 });
}

function formatIssueAlert(issue: SentryIssue): string {
  const levelEmoji = issue.level === "fatal" ? "🔴" : 
                     issue.level === "error" ? "🟠" : "🟡";
  
  return `${levelEmoji} *${issue.level.toUpperCase()}: ${issue.title}*\n\n` +
    `📱 *الإصدار:* ${issue.version || "غير معروف"}\n` +
    `👥 *المستخدمون:* ${issue.userCount || "غير متاح"}\n` +
    `📊 *الأحداث:* ${issue.count}\n` +
    `🕐 *أول ظهور:* ${formatRelativeTime(issue.firstSeen)}\n` +
    `🕐 *آخر ظهور:* ${formatRelativeTime(issue.lastSeen)}\n` +
    `🔗 [عرض في Sentry](${issue.url})`;
}

interface TelegramAlert {
  type: string;
  title: string;
  message: string;
  issueUrl: string;
  severity: "critical" | "warning" | "info";
}

export async function sendCriticalTelegramAlert(alert: TelegramAlert) {
  const botToken = getEnv("TELEGRAM_BOT_TOKEN");
  const chatId = getEnv("ADMIN_CHAT_ID");
  
  const keyboard = {
    inline_keyboard: [
      [
        { text: "🔍 عرض التفاصيل", url: alert.issueUrl },
        { text: "✅ تم الاعتراف", callback_data: `alert:ack:${alert.type}` }
      ],
      [
        { text: "🔇 كتم لمدة ساعة", callback_data: `alert:mute:${alert.type}:3600` },
        { text: "📊 مركز المراقبة", callback_data: "menu:monitoring" }
      ]
    ]
  } as const;
  
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: alert.message,
        parse_mode: "Markdown",
        reply_markup: keyboard,
      }),
    });
  } catch (error) {
    console.error("Failed to send Telegram alert:", error);
  }
}

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