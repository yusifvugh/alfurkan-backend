import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Chat Upload API — DISABLED
 *
 * This endpoint has been deprecated and removed.
 * Chat attachment uploads are no longer supported.
 *
 * All requests return 410 Gone.
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Secret');

  if (req.method === 'OPTIONS') return res.status(200).end();

  return res.status(410).json({
    error: 'حميل الملفات غير متاح',
    error_en: 'Chat file upload feature has been removed',
    deprecated: true,
  });
}
