import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../../lib/supabase/client';

/**
 * Cloud Sync API for bookmarks, ayah notes, and khatma progress
 * GET  /api/sync?google_id=<id>  -> get synced data (auth required)
 * POST /api/sync                -> save/update synced data (auth required)
 *
 * Authentication:
 *   Every request must include `Authorization: Bearer <supabase_jwt>`.
 *   The JWT is verified against Supabase Auth and the authenticated user's
 *   google_id (stored in user metadata) must match the google_id in the
 *   request. Unauthenticated requests -> 401. Mismatched identity -> 403.
 */

interface SyncUser {
  google_id: string;
}

/**
 * Verify the Bearer token and resolve the authenticated user's google_id.
 * Returns the user on success, null when no valid token is present.
 */
async function authenticate(req: VercelRequest): Promise<SyncUser | null> {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;

  const googleId =
    (data.user.user_metadata?.google_id as string) ||
    (data.user.app_metadata?.google_id as string) ||
    null;

  if (!googleId) return null;

  return { google_id: googleId };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Authenticate every request - sync data is private per-user.
  const user = await authenticate(req);
  if (!user) {
    return res.status(401).json({ error: 'unauthorized - auth token required' });
  }

  try {
    // GET sync data
    if (req.method === 'GET') {
      const gId = (req.query.google_id as string) || user.google_id;

      // Users may only read their own data.
      if (gId !== user.google_id) {
        return res.status(403).json({ error: 'forbidden - identity mismatch' });
      }

      const { data, error } = await supabase
        .from('user_sync_data')
        .select('*')
        .eq('google_id', gId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      return res.status(200).json({
        data: data || {
          google_id: gId,
          bookmarks: [],
          notes: [],
          khatma: {},
        },
      });
    }

    // POST sync data (upsert)
    if (req.method === 'POST') {
      const { google_id: bodyGoogleId, bookmarks, notes, khatma } = req.body || {};
      const gId = (bodyGoogleId || (req.query.google_id as string) || user.google_id) as string;

      if (!gId) return res.status(400).json({ error: 'google_id required' });

      // Users may only write their own data.
      if (gId !== user.google_id) {
        return res.status(403).json({ error: 'forbidden - identity mismatch' });
      }

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
    const message = err instanceof Error ? err.message : 'server error';
    return res.status(500).json({ error: message });
  }
}