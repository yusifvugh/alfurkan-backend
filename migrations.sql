-- ============================================
-- Alfurkan Backend Database Migrations
-- شغل هذا في Supabase Dashboard → SQL Editor
-- ============================================

-- 1. إعلانات التطبيق
CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('general', 'update', 'maintenance', 'feature')),
  target_version TEXT,
  mandatory BOOLEAN DEFAULT FALSE,
  priority TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
  download_links JSONB DEFAULT '{}',
  image_url TEXT,
  action_url TEXT,
  action_title TEXT,
  internal_route TEXT,
  is_published BOOLEAN DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  scheduled_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- الترقية التلقائية للجداول المنشأة مسبقاً (إضافة الأعمدة الجديدة إن لم تكن موجودة)
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS action_url TEXT;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS action_title TEXT;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS internal_route TEXT;

-- 2. حملات الإشعارات
CREATE TABLE IF NOT EXISTS notification_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  target_audience TEXT NOT NULL CHECK (target_audience IN ('all', 'version', 'region', 'custom')),
  target_filter JSONB DEFAULT '{}',
  related_announcement_id UUID REFERENCES announcements(id),
  scheduled_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  stats JSONB DEFAULT '{"sent":0,"failed":0,"opened":0}',
  sent_at TIMESTAMPTZ,
  created_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. إعدادات النظام
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  is_secret BOOLEAN DEFAULT FALSE,
  updated_by BIGINT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. سجل التدقيق (Audit Log)
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  user_id BIGINT NOT NULL,
  metadata JSONB DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. مستخدمو التطبيق (للإشعارات المستهدفة وحفظ توكنات الأجهزة)
CREATE TABLE IF NOT EXISTS app_users (
  device_id TEXT PRIMARY KEY,
  fcm_token TEXT,
  app_version TEXT,
  build_number INT,
  platform TEXT,
  country TEXT,
  language TEXT,
  last_active_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ترقية نوع device_id ليكون TEXT لدعم التوافق مع معرّفات الأجهزة المختلفة
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'app_users' AND column_name = 'device_id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE app_users ALTER COLUMN device_id TYPE TEXT;
  END IF;
END $$;

-- 6. سجل التنبيهات
CREATE TABLE IF NOT EXISTS alert_logs (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  timestamp TIMESTAMPTZ NOT NULL,
  metadata JSONB DEFAULT '{}'
);

-- فهارس للأداء
CREATE INDEX IF NOT EXISTS idx_announcements_published ON announcements(is_published, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcements_scheduled ON announcements(scheduled_at) WHERE scheduled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON notification_campaigns(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_users_version ON app_users(app_version);
CREATE INDEX IF NOT EXISTS idx_app_users_country ON app_users(country);
CREATE INDEX IF NOT EXISTS idx_alert_logs_timestamp ON alert_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_alert_logs_type ON alert_logs(type, severity);

-- تفعيل RLS (Row Level Security)
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_logs ENABLE ROW LEVEL SECURITY;

-- سياسات الأمان: قراءة عامة للإعلانات المنشورة
DROP POLICY IF EXISTS "Public read published announcements" ON announcements;
CREATE POLICY "Public read published announcements" ON announcements
  FOR SELECT USING (
    is_published = true 
    AND (expires_at IS NULL OR expires_at > NOW())
    AND (scheduled_at IS NULL OR scheduled_at <= NOW())
  );

-- سياسات الأمان: Service Role كامل الصلاحيات (للباك إند وبوت تيليجرام)
DROP POLICY IF EXISTS "Service role full access" ON announcements;
CREATE POLICY "Service role full access" ON announcements
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access" ON notification_campaigns;
CREATE POLICY "Service role full access" ON notification_campaigns
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access" ON system_config;
CREATE POLICY "Service role full access" ON system_config
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access" ON audit_logs;
CREATE POLICY "Service role full access" ON audit_logs
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access" ON app_users;
CREATE POLICY "Service role full access" ON app_users
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access" ON alert_logs;
CREATE POLICY "Service role full access" ON alert_logs
  FOR ALL USING (auth.role() = 'service_role');

-- إعدادات افتراضية للنظام
INSERT INTO system_config (key, value, description, is_secret) VALUES
('maintenance_mode', 'false', 'وضع الصيانة', false),
('maintenance_message', '"التطبيق تحت الصيانة، سيعمل قريباً"', 'رسالة الصيانة', false),
('force_update_version', 'null', 'إصدار التحديث الإلزامي', false),
('min_supported_version', '"1.0.0"', 'أدنى إصدار مدعوم', false),
('announcements_enabled', 'true', 'تفعيل الإعلانات', false),
('max_announcement_priority', '"high"', 'أقصى أولوية إعلان', false),
('auto_archive_days', '30', 'أيام الأرشفة التلقائية', false),
('notifications_enabled', 'true', 'تفعيل الإشعارات', false),
('max_daily_notifications_per_user', '5', 'حد الإشعارات اليومية لكل مستخدم', false),
('quiet_hours_enabled', 'true', 'ساعات الهدوء', false),
('quiet_hours_start', '"22:00"', 'بداية الهدوء', false),
('quiet_hours_end', '"08:00"', 'نهاية الهدوء', false),
('alerting_enabled', 'true', 'تفعيل التنبيهات', false),
('crash_alert_threshold', '10', 'عتبة تنبيه الانهيارات/ساعة', false),
('performance_alert_threshold_ms', '3000', 'عتبة تنبيه الأداء (ملي ثانية)', false),
('error_rate_alert_threshold', '5', 'عتبة معدل الأخطاء %', false),
('fcm_enabled', 'true', 'تفعيل FCM', false),
('sentry_enabled', 'true', 'تفعيل Sentry', false),
('supabase_enabled', 'true', 'تفعيل Supabase', false),
('latest_version', '"1.0.0"', 'أحدث إصدار', false),
('latest_build_number', '1', 'أحدث رقم بناء', false),
('release_notes_url', '"https://github.com/yusifvugh/al-furkan/releases"', 'رابط ملاحظات الإصدار', false)
ON CONFLICT (key) DO NOTHING;

-- دالة لتحديث updated_at تلقائياً
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- تريجر لتحديث updated_at
DROP TRIGGER IF EXISTS update_announcements_updated_at ON announcements;
CREATE TRIGGER update_announcements_updated_at
  BEFORE UPDATE ON announcements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_system_config_updated_at ON system_config;
CREATE TRIGGER update_system_config_updated_at
  BEFORE UPDATE ON system_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- عرض للإعلانات النشطة (للاستخدام في التطبيق)
CREATE OR REPLACE VIEW active_announcements AS
SELECT 
  id, 
  title, 
  body, 
  type, 
  target_version, 
  mandatory, 
  priority, 
  download_links, 
  image_url, 
  action_url, 
  action_title, 
  internal_route, 
  published_at
FROM announcements
WHERE is_published = true
  AND (expires_at IS NULL OR expires_at > NOW())
  AND (scheduled_at IS NULL OR scheduled_at <= NOW())
ORDER BY priority DESC, published_at DESC;

-- دالة لتنظيف الإعلانات منتهية الصلاحية
CREATE OR REPLACE FUNCTION cleanup_expired_announcements()
RETURNS void AS $$
BEGIN
  UPDATE announcements
  SET is_published = false
  WHERE is_published = true
    AND expires_at IS NOT NULL
    AND expires_at <= NOW();
END;
$$ language 'plpgsql';


-- ============================================
-- Studio Features Migration
-- Alfurkan Studio v1.0
-- Run in Supabase Dashboard → SQL Editor
-- ============================================

-- Blog Posts
CREATE TABLE IF NOT EXISTS blog_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  excerpt TEXT,
  cover_image_url TEXT,
  tags TEXT[] DEFAULT '{}',
  is_pinned BOOLEAN DEFAULT FALSE,
  is_published BOOLEAN DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  view_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat Conversations (one per user per context)
CREATE TABLE IF NOT EXISTS chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT NOT NULL REFERENCES app_users(device_id) ON DELETE CASCADE,
  blog_post_id UUID REFERENCES blog_posts(id) ON DELETE SET NULL,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_preview TEXT,
  unread_by_admin INT DEFAULT 0,
  unread_by_user INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat Messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('admin', 'user')),
  content TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_blog_posts_published ON blog_posts(is_published, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_posts_pinned ON blog_posts(is_pinned) WHERE is_pinned = TRUE;
CREATE INDEX IF NOT EXISTS idx_chats_device ON chats(device_id);
CREATE INDEX IF NOT EXISTS idx_chats_last_msg ON chats(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages(chat_id, created_at ASC);

-- RLS
ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Public can read published posts
DROP POLICY IF EXISTS "Public read published blog posts" ON blog_posts;
CREATE POLICY "Public read published blog posts" ON blog_posts
  FOR SELECT USING (is_published = true);

-- Service role full access
DROP POLICY IF EXISTS "Service role full blog" ON blog_posts;
CREATE POLICY "Service role full blog" ON blog_posts
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full chats" ON chats;
CREATE POLICY "Service role full chats" ON chats
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full messages" ON chat_messages;
CREATE POLICY "Service role full messages" ON chat_messages
  FOR ALL USING (auth.role() = 'service_role');

-- Auto-update updated_at for blog_posts
DROP TRIGGER IF EXISTS update_blog_posts_updated_at ON blog_posts;
CREATE TRIGGER update_blog_posts_updated_at
  BEFORE UPDATE ON blog_posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Atomic increment functions for unread counters
CREATE OR REPLACE FUNCTION increment_unread_admin(chat_id_param UUID)
RETURNS void AS $$
BEGIN
  UPDATE chats SET unread_by_admin = unread_by_admin + 1 WHERE id = chat_id_param;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION increment_unread_user(chat_id_param UUID)
RETURNS void AS $$
BEGIN
  UPDATE chats SET unread_by_user = unread_by_user + 1 WHERE id = chat_id_param;
END;
$$ LANGUAGE plpgsql;

-- Enable Realtime for live chat (safe check)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'chats'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chats;
  END IF;
END $$;

-- User Profile & Google Account on Chats & App Users
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS google_id TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS user_name TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS user_email TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS user_avatar TEXT;

ALTER TABLE chats ADD COLUMN IF NOT EXISTS google_id TEXT;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS user_name TEXT;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS user_email TEXT;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS user_avatar TEXT;
CREATE INDEX IF NOT EXISTS idx_chats_google_id ON chats(google_id);

-- User Sync Data (Bookmarks, Ayah Notes, Khatma progress)
CREATE TABLE IF NOT EXISTS user_sync_data (
  google_id TEXT PRIMARY KEY,
  bookmarks JSONB DEFAULT '[]',
  notes JSONB DEFAULT '[]',
  khatma JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User Feedback & Bug Reports
CREATE TABLE IF NOT EXISTS feedback_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT,
  google_id TEXT,
  user_name TEXT,
  user_contact TEXT,
  type TEXT NOT NULL DEFAULT 'other',
  message TEXT NOT NULL,
  device_info JSONB DEFAULT '{}',
  images TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'resolved')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback_reports(status, created_at DESC);

-- Typing indicators
ALTER TABLE chats ADD COLUMN IF NOT EXISTS user_typing boolean DEFAULT false;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS admin_typing boolean DEFAULT false;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS user_typing_at timestamptz;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS admin_typing_at timestamptz;

-- Admin FCM tokens
CREATE TABLE IF NOT EXISTS admin_fcm_tokens (device_id text PRIMARY KEY, fcm_token text NOT NULL, updated_at timestamptz DEFAULT now());

-- Chat attachments
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_url text;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_type text;
