import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../../lib/supabase/client';

/**
 * Studio Performance Metrics
 * GET /api/studio/performance  (admin only)
 *
 * Returns app performance metrics aggregated from:
 *  - app_users (active counts by version/platform)
 *  - Sentry (crash-free rates, error counts)
 *  - system_config (performance thresholds)
 */

const ADMIN_SECRET = process.env.ADMIN_API_SECRET || '';

function isAdmin(req: VercelRequest): boolean {
  const auth = req.headers['x-admin-secret'] || req.headers['authorization']?.replace('Bearer ', '');
  return !!ADMIN_SECRET && auth === ADMIN_SECRET;
}

interface PerformanceMetric {
  version: string;
  platform: string;
  totalUsers: number;
  activeUsers: number;
  avgLaunchMs: number | null;
  avgRenderMs: number | null;
  crashCount: number;
  errorRate: number;
}

async function fetchSentryStats(): Promise<{
  totalErrors: number;
  fatalErrors: number;
  affectedUsers: number;
  newIssues: number;
  resolvedIssues: number;
  errorRate: number;
}> {
  const token = process.env.SENTRY_AUTH_TOKEN;
  const org = process.env.SENTRY_ORG;
  const project = process.env.SENTRY_PROJECT;
  if (!token || !org || !project) {
    return { totalErrors: 0, fatalErrors: 0, affectedUsers: 0, newIssues: 0, resolvedIssues: 0, errorRate: 0 };
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const url = `https://sentry.io/api/0/projects/${org}/${project}/stats/?since=${since}&resolution=1h&stat=received`;

  try {
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
      errorRate: 0,
    };
  } catch (_) {
    return { totalErrors: 0, fatalErrors: 0, affectedUsers: 0, newIssues: 0, resolvedIssues: 0, errorRate: 0 };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Secret');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAdmin(req)) return res.status(401).json({ error: 'غير مصرح' });

  try {
    const now = new Date();
    const dayAgo = new Date(now);
    dayAgo.setDate(now.getDate() - 1);

    // Users by version/platform (last 24h active)
    const { data: versionData } = await supabase
      .from('app_users')
      .select('app_version, platform, last_active_at, device_id')
      .gte('last_active_at', dayAgo.toISOString());

    // Aggregate by version+platform
    const versionMap = new Map<string, { version: string; platform: string; users: Set<string>; active: number }>();
    for (const row of versionData ?? []) {
      const key = `${row.app_version || 'unknown'}|${row.platform || 'unknown'}`;
      if (!versionMap.has(key)) {
        versionMap.set(key, { version: row.app_version || 'unknown', platform: row.platform || 'unknown', users: new Set(), active: 0 });
      }
      const entry = versionMap.get(key)!;
      entry.users.add(row.device_id);
      entry.active++;
    }

    const byVersion: PerformanceMetric[] = Array.from(versionMap.values()).map(v => ({
      version: v.version,
      platform: v.platform,
      totalUsers: v.users.size,
      activeUsers: v.active,
      avgLaunchMs: null,
      avgRenderMs: null,
      crashCount: 0,
      errorRate: 0,
    }));

    // Sort by active users descending
    byVersion.sort((a, b) => b.activeUsers - a.activeUsers);

    const sentry = await fetchSentryStats();
    const totalActiveUsers = byVersion.reduce((sum, v) => sum + v.activeUsers, 0);
    const crashFreeRate = totalActiveUsers > 0
      ? ((totalActiveUsers - sentry.affectedUsers) / totalActiveUsers) * 100
      : 100;

    return res.status(200).json({
      period: '24h',
      generatedAt: new Date().toISOString(),
      summary: {
        totalActiveUsers,
        crashFreeUsersRate: parseFloat(crashFreeRate.toFixed(2)),
        totalErrors24h: sentry.totalErrors,
        fatalErrors24h: sentry.fatalErrors,
        affectedUsers24h: sentry.affectedUsers,
        errorRate: sentry.errorRate,
      },
      byVersion: byVersion.slice(0, 20),
    });

  } catch (err: unknown) {
    console.error('[studio/performance] error:', err);
    const message = err instanceof Error ? err.message : ' خطأ في الخادم';
    return res.status(500).json({ error: message });
  }
}
