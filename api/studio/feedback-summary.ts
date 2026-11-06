import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../../lib/supabase/client';

/**
 * Studio Feedback Summary
 * GET /api/studio/feedback-summary  (admin only)
 *
 * Returns aggregated feedback reports:
 *  - By status (new / in_progress / resolved)
 *  - By type (bug / feature / other)
 *  - Trend over last 7 days
 *  - Recent reports
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

    // Fetch all feedback from last 7 days
    const { data: feedbackRows } = await supabase
      .from('feedback_reports')
      .select('id, type, status, device_info, created_at')
      .gte('created_at', weekStart.toISOString())
      .order('created_at', { ascending: false })
      .limit(500);

    // Aggregate by status
    const byStatus: Record<string, number> = {};
    // Aggregate by type
    const byType: Record<string, number> = {};
    // Daily trend
    const trend: { date: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      trend.push({ date: '', count: 0 });
    }

    for (const row of feedbackRows ?? []) {
      byStatus[row.status] = (byStatus[row.status] || 0) + 1;
      byType[row.type] = (byType[row.type] || 0) + 1;

      const rowDate = new Date(row.created_at).toISOString().split('T')[0];
      const trendIdx = trend.findIndex(t => t.date === rowDate);
      if (trendIdx !== -1) trend[trendIdx].count++;
    }

    // Fill trend dates
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      trend[6 - i].date = d.toISOString().split('T')[0];
    }

    // Recent reports (last 10)
    const { data: recent } = await supabase
      .from('feedback_reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      period: '7 days',
      summary: {
        total: feedbackRows?.length ?? 0,
        byStatus,
        byType,
        trend,
      },
      recent: recent ?? [],
    });

  } catch (err: unknown) {
    console.error('[studio/feedback-summary] error:', err);
    const message = err instanceof Error ? err.message : ' خطأ في الخادم';
    return res.status(500).json({ error: message });
  }
}
