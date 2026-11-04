import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../../lib/supabase/client';

const ADMIN_SECRET = process.env.ADMIN_API_SECRET || '';

function isAdmin(req: VercelRequest): boolean {
  const auth = req.headers['x-admin-secret'] || req.headers['authorization']?.replace('Bearer ', '');
  return !!ADMIN_SECRET && auth === ADMIN_SECRET;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Secret');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAdmin(req)) return res.status(401).json({ error: '??? ?????' });

  const { device_id, fcm_token } = req.body || {};
  if (!device_id || !fcm_token) return res.status(400).json({ error: 'device_id and fcm_token required' });

  const { error } = await supabase.from('admin_fcm_tokens').upsert({
    device_id,
    fcm_token,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'device_id' });

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ success: true });
}
