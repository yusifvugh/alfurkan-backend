import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../../lib/supabase/client';

/**
 * Studio Dashboard Stats — Monitoring Metrics
 * GET /api/studio/stats  (admin only)
 *
 * Returns monitoring-focused metrics:
 *  - total users, new users today/week
 *  - active announcements
 *  - notification campaigns (sent/pending)
 *  - crash reports (from Sentry)
 *  - performance metrics
 *  - feedback reports summary
 *  - recent alerts
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
  count: number;
  userCount?: number;
  status: string;
}

async function fetchSentryIssues(limit: number = 10): Promise<SentryIssue[]> {
  const token = process.env.SENTRY_AUTH_TOKEN;
  const org = process.env.SENTRY_ORG;
  const project = process.env.SENTRY_PROJECT;
  if (!token || !org || !project) return [];

  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('status', 'unresolved');
  params.set('sort', 'lastSeen');
  params.set('project', project);

  const url = `https://sentry.io/api/0/projects/${org}/${project}/issues/?${params}`;

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return [];
    const data = await response.json() as any[];
    return data.map((issue: any) => ({
      id: issue.id,
      title: issue.title,
      level: issue.level,
      count: issue.count ?? 0,
      userCount: issue.userCount,
      status: issue.status,
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
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 7);

    const [usersTotal, usersToday, usersWeek, announcementsActive, campaignsTotal, alertsRecent, sentryIssues] =
      await Promise.allSettled([
        supabase.from('app_users').select('*', { count: 'exact', head: true }),
        supabase.from('app_users').select('*', { count: 'exact', head: true }).gte('registered_at', todayStart.toISOString()),
        supabase.from('app_users').select('*', { count: 'exact', head: true }).gte('registered_at', weekStart.toISOString()),
        supabase.from('announcements').select('*', { count: 'exact', head: true }).eq('is_published', true),
        supabase.from('notification_campaigns').select('*', { count: 'exact', head: true }),
        supabase.from('alert_logs').select('id, type, message, created_at').order('created_at', { ascending: false }).limit(10),
        fetchSentryIssues(10),
      ]);

    const getCount = (result: PromiseSettledResult<{ count: number | null }>) =>
      result.status === 'fulfilled' ? (result.value.count ?? 0) : 0;

    const crashCount = sentryIssues.status === 'fulfilled' ? sentryIssues.value.length : 0;
    const fatalCount = sentryIssues.status === 'fulfilled'
      ? sentryIssues.value.filter(i => i.level === 'fatal').length
      : 0;
    const errorCount = sentryIssues.status === 'fulfilled'
      ? sentryIssues.value.filter(i => i.level === 'error').length
      : 0;

    const totalAffectedUsers = sentryIssues.status === 'fulfilled'
      ? sentryIssues.value.reduce((sum, i) => sum + (i.userCount || 0), 0)
      : 0;

    // Feedback summary
    const { data: feedbackRows } = await supabase
      .from('feedback_reports')
      .select('status')
      .order('created_at', { ascending: false })
      .limit(1000);

    const feedbackSummary = {
      total: feedbackRows?.length ?? 0,
      new: feedbackRows?.filter(r => r.status === 'new').length ?? 0,
      in_progress: feedbackRows?.filter(r => r.status === 'in_progress').length ?? 0,
      resolved: feedbackRows?.filter(r => r.status === 'resolved').length ?? 0,
    };

    return res.status(200).json({
      users: {
        total: getCount(usersTotal as PromiseSettledResult<{ count: number | null }>),
        today: getCount(usersToday as PromiseSettledResult<{ count: number | null }>),
        week: getCount(usersWeek as PromiseSettledResult<{ count: number | null }>),
      },
      announcements: {
        active: getCount(announcementsActive as PromiseSettledResult<{ count: number | null }>),
      },
      campaigns: {
        total: getCount(campaignsTotal as PromiseSettledResult<{ count: number | null }>),
      },
      crashes: {
        unresolved: crashCount,
        fatal: fatalCount,
        error: errorCount,
        affectedUsers: totalAffectedUsers,
        recent: sentryIssues.status === 'fulfilled' ? sentryIssues.value : [],
      },
      performance: {
        // Placeholder — populated by /api/studio/performance endpoint
        avgAppLaunchMs: null,
        avgScreenRenderMs: null,
        crashFreeUsersRate: null,
        note: 'Use GET /api/studio/performance for detailed metrics',
      },
      feedback: feedbackSummary,
      alerts: alertsRecent.status === 'fulfilled' ? (alertsRecent.value.data || []) : [],
      generatedAt: new Date().toISOString(),
    });

  } catch (err: unknown) {
    console.error('[studio/stats] error:', err);
    const message = err instanceof Error ? err.message : ' خطأ في الخادم';
    return res.status(500).json({ error: message });
  }
}
