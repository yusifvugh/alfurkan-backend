import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../../lib/supabase/client';
import { sendPushNotification } from '../../lib/fcm';

/**
 * Chat API — single endpoint for all chat operations
 * POST /api/chat?action=start           → start or get existing chat (user)
 * GET  /api/chat?chat_id=<id>&device_id=<id>  → get messages (user/admin)
 * POST /api/chat?action=send            → send message (user or admin)
 * GET  /api/chat?action=inbox           → all chats inbox (admin only)
 * PUT  /api/chat?action=read&chat_id=<id>&role=admin|user → mark as read
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

  const { action, chat_id, device_id } = req.query;

  try {
    // ─── POST start chat ───────────────────────────────────────────────────
    if (req.method === 'POST' && action === 'start') {
      const { 
        device_id: bodyDeviceId, 
        blog_post_id,
        google_id,
        user_name,
        user_email,
        user_avatar,
      } = req.body;
      const dId = (bodyDeviceId || device_id) as string;

      if (!dId) return res.status(400).json({ error: 'device_id مطلوب' });

      // Check or upsert user
      const { data: user } = await supabase
        .from('app_users')
        .select('device_id, fcm_token')
        .eq('device_id', dId)
        .single();

      if (user && (google_id || user_name || user_email || user_avatar)) {
        await supabase.from('app_users').update({
          ...(google_id && { google_id }),
          ...(user_name && { user_name }),
          ...(user_email && { user_email }),
          ...(user_avatar && { user_avatar }),
        }).eq('device_id', dId);
      }

      // Find existing chat for this user/device (and optionally this blog post)
      let chatQuery = supabase
        .from('chats')
        .select('*');

      if (google_id) {
        chatQuery = chatQuery.eq('google_id', google_id);
      } else {
        chatQuery = chatQuery.eq('device_id', dId);
      }

      if (blog_post_id) {
        chatQuery = chatQuery.eq('blog_post_id', blog_post_id);
      } else {
        chatQuery = chatQuery.is('blog_post_id', null);
      }

      const { data: existing } = await chatQuery.single();

      if (existing) {
        if (google_id || user_name || user_email || user_avatar) {
          await supabase.from('chats').update({
            ...(google_id && { google_id }),
            ...(user_name && { user_name }),
            ...(user_email && { user_email }),
            ...(user_avatar && { user_avatar }),
            device_id: dId,
          }).eq('id', existing.id);
        }
        return res.status(200).json({ chat: existing, created: false });
      }

      // Create new chat
      const { data: newChat, error } = await supabase
        .from('chats')
        .insert({
          device_id: dId,
          blog_post_id: blog_post_id || null,
          google_id: google_id || null,
          user_name: user_name || null,
          user_email: user_email || null,
          user_avatar: user_avatar || null,
        })
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ chat: newChat, created: true });
    }

    // ─── GET messages ──────────────────────────────────────────────────────
    if (req.method === 'GET' && chat_id && !action) {
      const dId = device_id as string;

      // Admin can see any chat; user can only see their own
      if (!isAdmin(req)) {
        if (!dId) return res.status(400).json({ error: 'device_id مطلوب' });
        const { data: chat } = await supabase
          .from('chats')
          .select('device_id')
          .eq('id', chat_id as string)
          .single();
        if (!chat || chat.device_id !== dId) {
          return res.status(403).json({ error: 'غير مصرح' });
        }
      }

      const { data: messages, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('chat_id', chat_id as string)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return res.status(200).json({ messages: messages || [] });
    }

    // ─── GET inbox (admin only) ────────────────────────────────────────────
    if (req.method === 'GET' && action === 'inbox') {
      if (!isAdmin(req)) return res.status(401).json({ error: 'غير مصرح' });

      const { data: chats, error } = await supabase
        .from('chats')
        .select(`
          id,
          device_id,
          user_name,
          user_email,
          user_avatar,
          google_id,
          blog_post_id,
          last_message_at,
          last_message_preview,
          unread_by_admin,
          created_at,
          blog_posts(title)
        `)
        .order('last_message_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      return res.status(200).json({ chats: chats || [] });
    }

    // ─── POST send message ─────────────────────────────────────────────────
    if (req.method === 'POST' && action === 'send') {
      const { chat_id: bodyChatId, content, sender, device_id: bodyDeviceId } = req.body;
      const cId = (bodyChatId || chat_id) as string;

      if (!cId || !content || !sender) {
        return res.status(400).json({ error: 'chat_id, content, sender مطلوبة' });
      }

      if (sender === 'admin' && !isAdmin(req)) {
        return res.status(401).json({ error: 'غير مصرح' });
      }

      if (sender === 'user') {
        const dId = (bodyDeviceId || device_id) as string;
        if (!dId) return res.status(400).json({ error: 'device_id مطلوب' });
        const { data: chat } = await supabase.from('chats').select('device_id').eq('id', cId).single();
        if (!chat || chat.device_id !== dId) return res.status(403).json({ error: 'غير مصرح' });
      }

      // Insert message
      const { data: message, error: msgError } = await supabase
        .from('chat_messages')
        .insert({ chat_id: cId, sender, content })
        .select()
        .single();

      if (msgError) throw msgError;

      // Update chat metadata
      await supabase.from('chats').update({
        last_message_at: new Date().toISOString(),
        last_message_preview: content.substring(0, 100),
      }).eq('id', cId);

      // Atomic increment unread counter
      await supabase.rpc(
        sender === 'user' ? 'increment_unread_admin' : 'increment_unread_user',
        { chat_id_param: cId }
      );

      // Send push notification to the other party
      if (sender === 'user') {
        // Notify admin via Telegram (fire & forget)
        const { data: chatData } = await supabase.from('chats').select('device_id').eq('id', cId).single();
        console.log(`[chat] User ${chatData?.device_id} sent message to admin`);
      } else if (sender === 'admin') {
        // Notify user via FCM
        const { data: chatData } = await supabase
          .from('chats')
          .select('device_id')
          .eq('id', cId)
          .single();
        if (chatData) {
          const { data: userRow } = await supabase
            .from('app_users')
            .select('fcm_token')
            .eq('device_id', chatData.device_id)
            .single();
          if (userRow?.fcm_token) {
            await sendPushNotification({
              token: userRow.fcm_token,
              title: '📬 رسالة جديدة',
              body: content.substring(0, 100),
              data: { type: 'chat_message', chat_id: cId },
            }).catch(console.error);
          }
        }
      }

      return res.status(201).json({ message });
    }

    // ─── PUT mark as read ──────────────────────────────────────────────────
    if (req.method === 'PUT' && action === 'read') {
      const { role } = req.query;
      if (!chat_id) return res.status(400).json({ error: 'chat_id مطلوب' });

      if (role === 'admin' && !isAdmin(req)) return res.status(401).json({ error: 'غير مصرح' });

      const updateField = role === 'admin' ? { unread_by_admin: 0 } : { unread_by_user: 0 };

      // Mark messages as read
      await supabase.from('chat_messages')
        .update({ is_read: true })
        .eq('chat_id', chat_id as string)
        .neq('sender', role === 'admin' ? 'admin' : 'user');

      await supabase.from('chats').update(updateField).eq('id', chat_id as string);

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err: unknown) {
    console.error('[chat] error:', err);
    const message = err instanceof Error ? err.message : 'خطأ في الخادم';
    return res.status(500).json({ error: message });
  }
}
