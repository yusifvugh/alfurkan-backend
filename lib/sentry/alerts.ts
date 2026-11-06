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
  const token = SENTRY_AUTH_TOKEN || process.env.SENTRY_AUTH_TOKEN;
  const org = SENTRY_ORG || process.env.SENTRY_ORG;
  const project = SENTRY_PROJECT || process.env.SENTRY_PROJECT;
  if (!token || !org || !project) {
    return [];
  }

  const params = new URLSearchParams();
  params.set("limit", String(options.limit ?? 10));
  if (options.status) params.set("status", options.status);
  if (options.sort) params.set("sort", options.sort);
  if (options.level) params.set("level", options.level);
  params.set("project", project);

  const url = `${SENTRY_API_BASE}/projects/${org}/${project}/issues/?${params}`;

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