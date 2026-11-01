import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../../lib/supabase/client';

/**
 * Feedback & Bug Reports API
 * POST /api/feedback                        → Submit feedback from app
 * GET  /api/feedback?action=list            → List feedback (Admin only)
 * PUT  /api/feedback?action=status&id=<id>  → Update report status (Admin only)
 */

const ADMIN_SECRET = process.env.ADMIN_API_SECRET || '';

function isAdmin(req: VercelRequest): boolean {
  const auth = req.headers['x-admin-secret'] || req.headers['authorization']?.replace('Bearer ', '');
  return !!ADMIN_SECRET && auth === ADMIN_SECRET;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Secret');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, id, status } = req.query;

  try {
    // ─── POST submit feedback ──────────────────────────────────────────────
    if (req.method === 'POST') {
      const {
        device_id,
        google_id,
        user_name,
        user_contact,
        type,
        message,
        device_info,
        images,
      } = req.body;

      if (!message || message.trim().isEmpty) {
        return res.status(400).json({ error: 'الرسالة مطلوبة' });
      }

      const { data, error } = await supabase
        .from('feedback_reports')
        .insert({
          device_id: device_id || null,
          google_id: google_id || null,
          user_name: user_name || null,
          user_contact: user_contact || null,
          type: type || 'other',
          message: message.trim(),
          device_info: device_info || {},
          images: images || [],
          status: 'new',
        })
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ success: true, report: data });
    }

    // ─── GET list feedback (Admin only) ────────────────────────────────────
    if (req.method === 'GET' && action === 'list') {
      if (!isAdmin(req)) return res.status(401).json({ error: 'غير مصرح' });

      const { data, error } = await supabase
        .from('feedback_reports')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      return res.status(200).json({ reports: data || [] });
    }

    // ─── PUT update status (Admin only) ────────────────────────────────────
    if (req.method === 'PUT' && action === 'status') {
      if (!isAdmin(req)) return res.status(401).json({ error: 'غير مصرح' });
      if (!id || !status) return res.status(400).json({ error: 'id و status مطلوبان' });

      const { data, error } = await supabase
        .from('feedback_reports')
        .update({ status: status as string })
        .eq('id', id as string)
        .select()
        .single();

      if (error) throw error;
      return res.status(200).json({ success: true, report: data });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: unknown) {
    console.error('[feedback] error:', err);
    const msg = err instanceof Error ? err.message : 'خطأ في الخادم';
    return res.status(500).json({ error: msg });
  }
}
