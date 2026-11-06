import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Studio Crash Reports
 * GET /api/studio/crashes  (admin only)
 *
 * Returns crash reports from Sentry / Crashlytics.
 * Aggregated by level, version, platform, and status.
 */

const ADMIN_SECRET = process.env.ADMIN_API_SECRET || '';

function isAdmin(req: VercelRequest): boolean {
  const auth = req.headers['x-admin-secret'] || req.headers['authorization']?.replace('Bearer ', '');
  return !!ADMIN_SECRET && auth === ADMIN_SECRET;
}

interface SentryIssue {
  id: string;
  title: string;
  level: string;
  version?: string;
  userCount?: number;
  count: number;
  firstSeen: string;
  lastSeen: string;
  status: string;
  platform: string;
  stacktrace?: string;
  permalink: string;
}

async function fetchSentryIssues(limit: number = 50): Promise<SentryIssue[]> {
  const token = process.env.SENTRY_AUTH_TOKEN;
  const org = process.env.SENTRY_ORG;
  const project = process.env.SENTRY_PROJECT;
  if (!token || !org || !project) return [];

  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('sort', 'lastSeen');
  params.set('project', project);

  const url = `https://sentry.io/api/0/projects/${org}/${project}/issues/?${params}`;

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return [];
    const data = await response.json() as any[];
    return data.map((issue: any) => ({
      id: issue.id,
      title: issue.title,
      level: issue.level,
      version: issue.metadata?.value?.version,
      userCount: issue.userCount,
      count: issue.count ?? 0,
      firstSeen: issue.firstSeen,
      lastSeen: issue.lastSeen,
      status: issue.status,
      platform: issue.platform,
      stacktrace: issue.stacktrace?.frames?.map((f: any) =>
        `${f.filename ?? ''}:${f.lineno ?? 0} in ${f.function ?? ''}`
      ).join('\n'),
      permalink: issue.permalink,
    }));
  } catch (_) {
    return [];
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Secret');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAdmin(req)) return res.status(401).json({ error: 'غير مصرح' });

  try {
    const { level, status, limit } = req.query;
    const issues = await fetchSentryIssues(parseInt(limit as string, 10) || 50);

    // Filter by level/status if requested
    let filtered = issues;
    if (level) filtered = filtered.filter(i => i.level === level);
    if (status) filtered = filtered.filter(i => i.status === status);

    // Aggregate stats
    const byLevel: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byVersion: Record<string, number> = {};
    const byPlatform: Record<string, number> = {};
    let totalAffectedUsers = 0;

    for (const issue of filtered) {
      byLevel[issue.level] = (byLevel[issue.level] || 0) + 1;
      byStatus[issue.status] = (byStatus[issue.status] || 0) + 1;
      if (issue.version) byVersion[issue.version] = (byVersion[issue.version] || 0) + 1;
      byPlatform[issue.platform] = (byPlatform[issue.platform] || 0) + 1;
      totalAffectedUsers += issue.userCount || 0;
    }

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      summary: {
        totalIssues: filtered.length,
        totalAffectedUsers,
        byLevel,
        byStatus,
        byVersion,
        byPlatform,
      },
      issues: filtered,
    });

  } catch (err: unknown) {
    console.error('[studio/crashes] error:', err);
    const message = err instanceof Error ? err.message : ' خطأ في الخادم';
    return res.status(500).json({ error: message });
  }
}
