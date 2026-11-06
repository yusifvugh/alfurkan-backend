import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Blog API — DISABLED
 *
 * This endpoint has been deprecated and removed.
 * The blog feature is no longer part of the AL-FURQAN backend.
 *
 * All requests return 410 Gone.
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Secret');

  if (req.method === 'OPTIONS') return res.status(200).end();

  return res.status(410).json({
    error: 'المدونة غير متاحة',
    error_en: 'Blog feature has been removed',
    deprecated: true,
  });
}
