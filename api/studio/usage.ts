import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../../lib/supabase/client';

/**
 * Studio Usage Metrics
 * GET /api/studio/usage  (admin only)
 *
 * Returns user engagement metrics:
 *  - Daily active users (DAU) trend
 *  - Retention
 *  - Feature usage (registration, announcements, feedback)
 *  - Geographic / language distribution
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

    // Daily active users for last 7 days
    const dailyTrend: { date: string; activeUsers: number; newRegistrations: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date(now);
      dayStart.setDate(now.getDate() - i);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);

      const [{ count: active }, { count: newReg }] = await Promise.all([
        supabase.from('app_users')
          .select('*', { count: 'exact', head: true })
          .gte('last_active_at', dayStart.toISOString())
          .lte('last_active_at', dayEnd.toISOString()),
        supabase.from('app_users')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', dayStart.toISOString())
          .lte('created_at', dayEnd.toISOString()),
      ]);

      dailyTrend.push({
        date: dayStart.toISOString().split('T')[0],
        activeUsers: active ?? 0,
        newRegistrations: newReg ?? 0,
      });
    }

    // Platform / language / country distribution
    const { data: distData } = await supabase
      .from('app_users')
      .select('platform, country, language, app_version')
      .gte('last_active_at', todayStart.toISOString());

    const platformDist: Record<string, number> = {};
    const countryDist: Record<string, number> = {};
    const languageDist: Record<string, number> = {};
    const versionDist: Record<string, number> = {};

    for (const row of distData ?? []) {
      if (row.platform) platformDist[row.platform] = (platformDist[row.platform] || 0) + 1;
      if (row.country) countryDist[row.country] = (countryDist[row.country] || 0) + 1;
      if (row.language) languageDist[row.language] = (languageDist[row.language] || 0) + 1;
      if (row.app_version) versionDist[row.app_version] = (versionDist[row.app_version] || 0) + 1;
    }

    // Feedback submissions today
    const { count: feedbackToday } = await supabase
      .from('feedback_reports')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', todayStart.toISOString());

    // Retention (day 1 / day 7)
    const { count: retainedDay1 } = await supabase
      .from('app_users')
      .select('*', { count: 'exact', head: true })
      .gte('last_active_at', todayStart.toISOString());

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      dailyTrend,
      distribution: {
        platform: platformDist,
        country: countryDist,
        language: languageDist,
        version: versionDist,
      },
      today: {
        activeUsers: dailyTrend[dailyTrend.length - 1]?.activeUsers ?? 0,
        newRegistrations: dailyTrend[dailyTrend.length - 1]?.newRegistrations ?? 0,
        feedbackSubmissions: feedbackToday ?? 0,
      },
    });

  } catch (err: unknown) {
    console.error('[studio/usage] error:', err);
    const message = err instanceof Error ? err.message : ' خطأ في الخادم';
    return res.status(500).json({ error: message });
  }
}
