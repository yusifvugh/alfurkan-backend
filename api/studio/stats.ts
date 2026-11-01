import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../../lib/supabase/client';

/**
 * Studio Dashboard Stats
 * GET /api/studio/stats  (admin only)
 *
 * Returns:
 *  - total users, new users today/week
 *  - active announcements
 *  - notification campaigns (sent/pending)
 *  - blog posts (published/draft)
 *  - unread chat messages
 *  - top blog posts by views
 */

const ADMIN_SECRET = process.env.ADMIN_API_SECRET || '';

function isAdmin(req: VercelRequest): boolean {
  const auth = req.headers['x-admin-secret'] || req.headers['authorization']?.replace('Bearer ', '');
  return !!ADMIN_SECRET && auth === ADMIN_SECRET;
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

    // Run all queries in parallel
    const [
      usersTotal,
      usersToday,
      usersWeek,
      announcementsActive,
      campaignsTotal,
      blogPublished,
      blogDraft,
      chatUnread,
      topPosts,
      alertsRecent,
    ] = await Promise.allSettled([
      supabase.from('app_users').select('*', { count: 'exact', head: true }),
      supabase.from('app_users').select('*', { count: 'exact', head: true }).gte('registered_at', todayStart.toISOString()),
      supabase.from('app_users').select('*', { count: 'exact', head: true }).gte('registered_at', weekStart.toISOString()),
      supabase.from('announcements').select('*', { count: 'exact', head: true }).eq('is_published', true),
      supabase.from('notification_campaigns').select('*', { count: 'exact', head: true }),
      supabase.from('blog_posts').select('*', { count: 'exact', head: true }).eq('is_published', true),
      supabase.from('blog_posts').select('*', { count: 'exact', head: true }).eq('is_published', false),
      supabase.from('chats').select('unread_by_admin').gt('unread_by_admin', 0),
      supabase.from('blog_posts').select('id, title, view_count, published_at').eq('is_published', true).order('view_count', { ascending: false }).limit(5),
      supabase.from('alert_logs').select('id, type, message, created_at').order('created_at', { ascending: false }).limit(10),
    ]);

    const getCount = (result: PromiseSettledResult<{ count: number | null }>) =>
      result.status === 'fulfilled' ? (result.value.count ?? 0) : 0;

    const totalUnread = chatUnread.status === 'fulfilled'
      ? (chatUnread.value.data || []).reduce((sum: number, c: { unread_by_admin: number }) => sum + (c.unread_by_admin || 0), 0)
      : 0;

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
      blog: {
        published: getCount(blogPublished as PromiseSettledResult<{ count: number | null }>),
        draft: getCount(blogDraft as PromiseSettledResult<{ count: number | null }>),
        topPosts: topPosts.status === 'fulfilled' ? (topPosts.value.data || []) : [],
      },
      chat: {
        totalUnread,
      },
      alerts: alertsRecent.status === 'fulfilled' ? (alertsRecent.value.data || []) : [],
      generatedAt: new Date().toISOString(),
    });

  } catch (err: unknown) {
    console.error('[studio/stats] error:', err);
    const message = err instanceof Error ? err.message : 'خطأ في الخادم';
    return res.status(500).json({ error: message });
  }
}
