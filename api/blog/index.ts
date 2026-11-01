import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../../lib/supabase/client';

/**
 * Blog API — single endpoint handling all blog operations
 * GET    /api/blog?page=1&limit=10&pinned=true   → list published posts (public)
 * GET    /api/blog?id=<uuid>                      → single post details (public)
 * POST   /api/blog                                → create post (admin only)
 * PUT    /api/blog?id=<uuid>                      → update post (admin only)
 * DELETE /api/blog?id=<uuid>                      → delete post (admin only)
 */

const ADMIN_SECRET = process.env.ADMIN_API_SECRET || '';

function isAdmin(req: VercelRequest): boolean {
  const auth = req.headers['x-admin-secret'] || req.headers['authorization']?.replace('Bearer ', '');
  return !!ADMIN_SECRET && auth === ADMIN_SECRET;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Secret');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id, page = '1', limit = '20', pinned, tag } = req.query;

  try {
    // ─── GET single post ───────────────────────────────────────────────────
    if (req.method === 'GET' && id) {
      const { data, error } = await supabase
        .from('blog_posts')
        .select('*')
        .eq('id', id as string)
        .eq('is_published', true)
        .single();

      if (error || !data) return res.status(404).json({ error: 'المنشور غير موجود' });

      // increment view count (fire and forget)
      supabase
        .from('blog_posts')
        .update({ view_count: (data.view_count || 0) + 1 })
        .eq('id', id as string)
        .then(() => {});

      return res.status(200).json({ post: data });
    }

    // ─── GET list of posts ──────────────────────────────────────────────────
    if (req.method === 'GET') {
      const pageNum = parseInt(page as string, 10);
      const limitNum = Math.min(parseInt(limit as string, 10), 50);
      const offset = (pageNum - 1) * limitNum;

      let query = supabase
        .from('blog_posts')
        .select('id, title, excerpt, cover_image_url, tags, is_pinned, view_count, published_at, created_at', { count: 'exact' })
        .eq('is_published', true)
        .order('is_pinned', { ascending: false })
        .order('published_at', { ascending: false })
        .range(offset, offset + limitNum - 1);

      if (pinned === 'true') query = query.eq('is_pinned', true);
      if (tag) query = query.contains('tags', [tag]);

      const { data, error, count } = await query;

      if (error) throw error;

      return res.status(200).json({
        posts: data || [],
        total: count || 0,
        page: pageNum,
        limit: limitNum,
        hasMore: (offset + limitNum) < (count || 0),
      });
    }

    // ─── POST create ────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      if (!isAdmin(req)) return res.status(401).json({ error: 'غير مصرح' });

      const { title, content, excerpt, cover_image_url, tags, is_pinned, is_published } = req.body;

      if (!title || !content) {
        return res.status(400).json({ error: 'العنوان والمحتوى مطلوبان' });
      }

      const { data, error } = await supabase
        .from('blog_posts')
        .insert({
          title,
          content,
          excerpt: excerpt || content.substring(0, 200),
          cover_image_url: cover_image_url || null,
          tags: tags || [],
          is_pinned: is_pinned || false,
          is_published: is_published || false,
          published_at: is_published ? new Date().toISOString() : null,
        })
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ post: data });
    }

    // ─── PUT update ─────────────────────────────────────────────────────────
    if (req.method === 'PUT') {
      if (!isAdmin(req)) return res.status(401).json({ error: 'غير مصرح' });
      if (!id) return res.status(400).json({ error: 'id مطلوب' });

      const { title, content, excerpt, cover_image_url, tags, is_pinned, is_published } = req.body;

      const existing = await supabase.from('blog_posts').select('is_published').eq('id', id as string).single();

      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (title !== undefined) updates.title = title;
      if (content !== undefined) updates.content = content;
      if (excerpt !== undefined) updates.excerpt = excerpt;
      if (cover_image_url !== undefined) updates.cover_image_url = cover_image_url;
      if (tags !== undefined) updates.tags = tags;
      if (is_pinned !== undefined) updates.is_pinned = is_pinned;
      if (is_published !== undefined) {
        updates.is_published = is_published;
        // Set published_at only when first publishing
        if (is_published && !existing.data?.is_published) {
          updates.published_at = new Date().toISOString();
        }
      }

      const { data, error } = await supabase
        .from('blog_posts')
        .update(updates)
        .eq('id', id as string)
        .select()
        .single();

      if (error) throw error;
      return res.status(200).json({ post: data });
    }

    // ─── DELETE ─────────────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      if (!isAdmin(req)) return res.status(401).json({ error: 'غير مصرح' });
      if (!id) return res.status(400).json({ error: 'id مطلوب' });

      const { error } = await supabase.from('blog_posts').delete().eq('id', id as string);
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err: unknown) {
    console.error('[blog] error:', err);
    const message = err instanceof Error ? err.message : 'خطأ في الخادم';
    return res.status(500).json({ error: message });
  }
}
