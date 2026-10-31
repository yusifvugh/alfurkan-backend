# Alfurkan Backend - Telegram Control Center & Monitoring

باك إند لتطبيق الفُرقان يوفر مركز تحكم عبر Telegram Bot مع مراقبة شاملة.

## 🏗️ البنية

```
alfurkan-backend/
├── api/
│   ├── telegram/
│   │   ├── bot.ts              # نقطة دخول البوت الرئيسي
│   │   ├── webhook.ts          # معالج Webhook لـ Vercel
│   │   ├── set-webhook.ts      # إعداد الويب هوك
│   │   └── commands/           # معالجات الأوامر
│   │       ├── announcements.ts
│   │       ├── notifications.ts
│   │       ├── settings.ts
│   │       └── monitoring.ts
│   ├── monitoring/
│   │   ├── health.ts           # Health check endpoint
│   │   ├── external-ping.ts    # مراقب خارجي (GitHub Actions كل 5 دقائق)
│   │   ├── daily-summary.ts    # ملخص يومي (Cron 9 صباحاً)
│   │   ├── weekly-summary.ts   # ملخص أسبوعي (Cron الاثنين 9 صباحاً)
│   │   └── sentry-webhook.ts   # استقبال تنبيهات Sentry
├── lib/
│   ├── telegram/
│   │   ├── bot.ts              # تهيئة البوت مع Middleware
│   │   ├── middleware/         # Auth, Rate Limit, Idempotency
│   │   ├── keyboards/          # Inline Keyboards
│   │   └── formatters/         # تنسيق الرسائل
│   ├── supabase/               # عميل Supabase و Types
│   ├── sentry/                 # Alert Manager لتكامل Sentry
│   ├── monitoring/             # Health Checks
│   └── utils/                  # دوال مساعدة
├── vercel.json                 # إعدادات Vercel
├── package.json
├── tsconfig.json
└── .env.example
```

## 🚀 النشر على Vercel

### 1. إنشاء المشروع
```bash
# في GitHub، أنشئ مستودع جديد: alfurkan-backend
# ارفع الكود
```

### 2. ربط Vercel
- اذهب إلى [Vercel Dashboard](https://vercel.com/dashboard)
- Add New Project → Import Git Repository
- اختر `alfurkan-backend`
- Framework Preset: **Other**

### 3. متغيرات البيئة
في Vercel Project Settings → Environment Variables، أضف:

```env
# Telegram Bot
TELEGRAM_BOT_TOKEN=your-bot-token-from-botfather
TELEGRAM_WEBHOOK_SECRET=generate-random-secret-32-chars-min
AUTHORIZED_ADMIN_IDS=your-telegram-user-id
ADMIN_CHAT_ID=your-telegram-user-id

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-from-supabase
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-from-supabase

# Sentry
SENTRY_DSN=https://your-dsn@sentry.io/your-project-id
SENTRY_ORG=your-org-slug
SENTRY_PROJECT=alfurkan
SENTRY_AUTH_TOKEN=your-auth-token-from-sentry
SENTRY_WEBHOOK_SECRET=your-webhook-secret-from-sentry

# FCM
FCM_SERVER_KEY=your-fcm-server-key-from-firebase
FCM_PROJECT_ID=your-firebase-project-id

# App
APP_VERSION=1.0.0
APP_BUILD_NUMBER=1
NODE_ENV=production
API_BASE_URL=https://your-project.vercel.app

# Encryption
ENCRYPTION_KEY=generate-with-openssl-rand-base64-32
WEBHOOK_SECRET_TOKEN=another-random-secret-for-verification

# Cron Secret (للحماية)
CRON_SECRET=generate-random-secret
```

### 4. تعيين الويب هوك
بعد النشر، شغل:
```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-project.vercel.app/api/telegram/webhook", "secret_token": "<YOUR_WEBHOOK_SECRET>", "allowed_updates": ["message", "callback_query"], "drop_pending_updates": true}'
```

أو استخدم endpoint الإعداد:
```bash
curl -X POST "https://your-project.vercel.app/api/telegram/set-webhook"
```

### 5. التحقق
```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"
```

## 🗄️ قاعدة البيانات (Supabase)

شغل SQL التالي في Supabase Dashboard → SQL Editor:

```sql
-- جداول الإعلانات، الإشعارات، الإعدادات، سجل التدقيق، المستخدمين
-- (الموجود في ملف migrations.sql المرفق)
```

## 📱 أوامر البوت

| الأمر | الوصف |
|--------|-------|
| `/start` | القائمة الرئيسية |
| `/help` | المساعدة |
| `/status` | حالة النظام السريعة |
| `/health` | فحص صحة الخدمات |
| `/alerts` | أحدث التنبيهات |

## 📊 المراقبة

### Health Checks (GitHub Actions كل 5 دقائق، Vercel Cron يومي/أسبوعي)
- API Health
- Database (Supabase)
- FCM
- Sentry

### تنبيهات Sentry
- Crash مميت جديد → فوري
- ارتفاع في الانهيارات → فوري
- تراجع بعد إصدار → فوري
- تأثير على مستخدمين كثر → فوري

### ملخصات دورية
- يومي: 9:00 صباحاً
- أسبوعي: الاثنين 9:00 صباحاً

## 🔒 الأمان

- ✅ تحقق من هوية المدير (User ID فقط)
- ✅ تحقق من Webhook Secret Token
- ✅ Rate Limiting (30 طلب/دقيقة)
- ✅ Idempotency للعمليات الخطيرة
- ✅ Audit Logging لجميع العمليات
- ✅ متغيرات البيئة للأسرار
- ✅ عدم كشف الأسرار في الرسائل

## 🛠️ التطوير المحلي

```bash
# تثبيت التبعيات
npm install

# تشغيل محلياً (يحتاج ngrok للـ webhook)
npm run dev

# فحص الأنواع
npm run typecheck

# فحص الكود
npm run lint
```

## 📝 هيكل قاعدة البيانات

راجع `migrations.sql` للجداول الكاملة:
- `announcements` - إعلانات التطبيق
- `notification_campaigns` - حملات الإشعارات
- `system_config` - إعدادات النظام
- `audit_logs` - سجل التدقيق
- `app_users` - مستخدمو التطبيق (للإشعارات المستهدفة)
- `alert_logs` - سجل التنبيهات

## 💰 التكاليف المتوقعة

| الخدمة | الخطة المجانية | عند التوسع |
|---------|---------------|-----------|
| Vercel | Hobby (مجاني) | Pro $20/شهر |
| Supabase | Free (500MB) | Pro $25/شهر |
| Sentry | Developer (5k errors) | Team $26/شهر |
| FCM | مجاني | مجاني |
| Upstash Redis | 10k req/يوم | $0.50/مليون |
| **الإجمالي** | **$0** | **~$70/شهر** |

## 📋 قائمة التحقق قبل الإنتاج

- [ ] جميع متغيرات البيئة مضبوطة في Vercel
- [ ] SQL Migrations مشغلة في Supabase
- [ ] Sentry Project مُنشأ و DSK مُضاف
- [ ] Webhook مُعين ويعمل
- [ ] Admin User IDs صحيحة
- [ ] FCM Server Key مُضاف
- [ ] Encryption Keys مولدة وآمنة
- [ ] Cron Secret مُضبوط
- [ ] اختبارات البوت تمر بنجاح
- [ ] Health Check endpoint يستجيب

## 🆘 استكشاف الأخطاء

### البوت لا يستجيب
1. تحقق من Vercel Function Logs
2. تحقق من `getWebhookInfo` في Telegram
3. تأكد من `TELEGRAM_BOT_TOKEN` صحيح

### التنبيهات لا تصل
1. تحقق من `ADMIN_CHAT_ID` صحيح
2. تحقق من Sentry Webhook URL في إعدادات Sentry
3. راجع Vercel Function Logs للأخطاء

### قاعدة البيانات لا تتصل
1. تحقق من `SUPABASE_URL` و `SERVICE_ROLE_KEY`
2. تأكد من RLS Policies تسمح بـ Service Role
3. راجع Supabase Logs

## 📞 الدعم

للاستفسارات، راجع:
- [Vercel Serverless Functions Docs](https://vercel.com/docs/functions)
- [grammY Documentation](https://grammy.dev/)
- [Supabase JavaScript Client](https://supabase.com/docs/reference/javascript)
- [Sentry API Documentation](https://docs.sentry.io/api/)