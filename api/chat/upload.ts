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

  const { chat_id, sender, device_id, filename, mime_type, data_base64 } = req.body || {};
  if (!chat_id || !sender || !filename || !data_base64) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  if (sender === 'user') {
    if (!device_id) return res.status(400).json({ error: 'device_id required' });
    const { data: chat } = await supabase.from('chats').select('device_id').eq('id', chat_id).single();
    if (!chat || chat.device_id !== device_id) return res.status(403).json({ error: 'Forbidden' });
  } else if (!isAdmin(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const bytes = Buffer.from(data_base64, 'base64');
  const path = `${chat_id}/${Date.now()}-${filename}`;
  const { error: uploadError } = await supabase.storage
    .from('chat-attachments')
    .upload(path, bytes, { contentType: mime_type || 'application/octet-stream', upsert: false });

  if (uploadError) return res.status(500).json({ error: uploadError.message });

  const { data: urlData } = supabase.storage.from('chat-attachments').getPublicUrl(path);

  // Insert message with attachment
  const attachmentType = (mime_type || '').startsWith('image/') ? 'image' : (mime_type || '').startsWith('audio/') ? 'audio' : 'file';
  const { data: message, error: msgError } = await supabase
    .from('chat_messages')
    .insert({ chat_id, sender, content: '', attachment_url: urlData.publicUrl, attachment_type: attachmentType })
    .select()
    .single();

  if (msgError) return res.status(500).json({ error: msgError.message });

  await supabase.from('chats').update({
    last_message_at: new Date().toISOString(),
    last_message_preview: attachmentType === 'image' ? '?? ????' : attachmentType === 'audio' ? '?? ????? ?????' : '?? ???',
  }).eq('id', chat_id);

  // unread increment
  await supabase.rpc(sender === 'user' ? 'increment_unread_admin' : 'increment_unread_user', { chat_id_param: chat_id });

  // push
  if (sender === 'admin') {
    const { data: chatData } = await supabase.from('chats').select('device_id').eq('id', chat_id).single();
    if (chatData) {
      const { data: userRow } = await supabase.from('app_users').select('fcm_token').eq('device_id', chatData.device_id).single();
      if (userRow?.fcm_token) {
        const { sendPushNotification } = await import('../../lib/fcm/index.js');
        await sendPushNotification({
          token: userRow.fcm_token,
          title: '????? ????? ?? ??????',
          body: attachmentType === 'image' ? '?? ????' : attachmentType === 'audio' ? '?? ????? ?????' : '?? ???',
          data: { type: 'chat_message', chat_id },
        }).catch(console.error);
      }
    }
  } else {
    const { data: adminTokens } = await supabase.from('admin_fcm_tokens').select('fcm_token');
    const tokens = (adminTokens || []).map((r: any) => r.fcm_token).filter(Boolean);
    const { sendPushNotification } = await import('../../lib/fcm/index.js');
    for (const t of tokens) {
      await sendPushNotification({
        token: t,
        title: '????? ????? ?? ??????',
        body: attachmentType === 'image' ? '?? ????' : attachmentType === 'audio' ? '?? ????? ?????' : '?? ???',
        data: { type: 'chat_message', chat_id },
      }).catch(console.error);
    }
  }

  return res.status(201).json({ message });
}
