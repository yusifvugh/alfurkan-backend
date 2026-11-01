import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../../lib/supabase/client';

/**
 * Cloud Sync API for bookmarks, ayah notes, and khatma progress
 * GET  /api/sync?google_id=<id>  → get synced data
 * POST /api/sync                → save/update synced data
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { google_id } = req.query;

  try {
    // ─── GET sync data ─────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const gId = google_id as string;
      if (!gId) return res.status(400).json({ error: 'google_id مطلوب' });

      const { data, error } = await supabase
        .from('user_sync_data')
        .select('*')
        .eq('google_id', gId)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116: no rows returned

      return res.status(200).json({
        data: data || {
          google_id: gId,
          bookmarks: [],
          notes: [],
          khatma: {},
        },
      });
    }

    // ─── POST sync data (upsert) ───────────────────────────────────────────
    if (req.method === 'POST') {
      const { google_id: bodyGoogleId, bookmarks, notes, khatma } = req.body;
      const gId = (bodyGoogleId || google_id) as string;

      if (!gId) return res.status(400).json({ error: 'google_id مطلوب' });

      const upsertPayload: Record<string, any> = {
        google_id: gId,
        updated_at: new Date().toISOString(),
      };

      if (bookmarks !== undefined) upsertPayload.bookmarks = bookmarks;
      if (notes !== undefined) upsertPayload.notes = notes;
      if (khatma !== undefined) upsertPayload.khatma = khatma;

      const { data, error } = await supabase
        .from('user_sync_data')
        .upsert(upsertPayload, { onConflict: 'google_id' })
        .select()
        .single();

      if (error) throw error;
      return res.status(200).json({ success: true, data });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: unknown) {
    console.error('[sync] error:', err);
    const message = err instanceof Error ? err.message : 'خطأ في الخادم';
    return res.status(500).json({ error: message });
  }
}
