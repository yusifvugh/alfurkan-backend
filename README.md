# Alfurkan Backend - Studio Management & Monitoring API

 bac end لتطبيق الفُرقان يوفّر API endpoints للمراقبة والإ management عبر تطبيق Studio منفصل.

## 🏗️ البنية

```
alfurkan-backend/
├── api/
│   ├── monitoring/
│   │   └── index.ts           # Consolidated monitoring handler
│   │                          # (health, daily-summary, publish-scheduled, sentry-webhook)
│   ├── users/
│   │   └── register.ts        # Device registration
│   ├── sync/
│   │   └── index.ts           # Cloud sync (bookmarks, notes, khatma)
│   ├── feedback/
│   │   └── index.ts           # Feedback & bug reports
│   ├── announcements/
│   │   └── active.ts          # Active announcements + versioning
│   └── studio/
│       ├── register.ts        # Studio device registration (FCM)
│       ├── stats.ts           # Studio dashboard stats
│       ├── usage.ts           # Studio usage metrics
│       ├── performance.ts     # Studio performance metrics
│       ├── crashes.ts         # Studio crash reports
│       └── feedback-summary.ts # Studio feedback summary
├── lib/
│   ├── supabase/              # Supabase client + types
│   ├── sentry/                # Sentry API integration
│   ├── fcm/                   # FCM push notifications
│   ├── monitoring/            # Health checks
│   └── utils/                 # Helper functions
├── vercel.json                # Vercel configuration
├── package.json
├── tsconfig.json
└── .env.example
```

## 🚀 النشر على Vercel

### 1. ربط Vercel
- اذهب إلى [Vercel Dashboard](https://vercel.com/dashboard)
- Add New Project → Import Git Repository
- اختر `alfurkan-backend`
- Framework Preset: **Other**

### 2. متغيرات البيئة
في Vercel Project Settings → Environment Variables، أضف:

```env
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
FIREBASE_SERVICE_ACCOUNT_JSON=your-service-account-json

# App
APP_VERSION=1.0.0
APP_BUILD_NUMBER=1
NODE_ENV=production
API_BASE_URL=https://your-project.vercel.app

# Cron Secret (لحماية المهام المجدولة)
CRON_SECRET=generate-random-secret
```

### 3. التحقق
```bash
curl "https://your-project.vercel.app/api/monitoring/health"
```

## 📡 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/monitoring/health` | GET | Health check |
| `/api/monitoring/daily-summary` | POST | Daily summary (cron) |
| `/api/monitoring/publish-scheduled` | POST | Publish scheduled announcements (cron) |
| `/api/monitoring/sentry-webhook` | POST | Sentry webhook |
| `/api/announcements/active` | GET | Active announcements + versioning |
| `/api/users/register` | POST | Device registration |
| `/api/sync` | GET/POST | Cloud sync |
| `/api/feedback` | POST/GET/PUT | Feedback & bug reports |
| `/api/studio/register` | POST | Studio device registration |
| `/api/studio/stats` | GET | Dashboard stats |
| `/api/studio/usage` | GET | Usage metrics |
| `/api/studio/performance` | GET | Performance metrics |
| `/api/studio/crashes` | GET | Crash reports |
| `/api/studio/feedback-summary` | GET | Feedback summary |

## 📊 المراقبة

### Vercel Cron
- يومي: 9:00 صباحاً (الملخص اليومي وشور الإعلانات المجدولة)
- GitHub Actions: فحص الصحة كل 15 دقيقة

### تنبيهات Sentry
- Crash مميت جديد → فوري
- ارتفاع في الانهيارات → فوري
- تراجع بعد إصدار → فوري
- تأثير على مستخدمين كثر → فوري

## 🔒 الأمان
- ✅ تحقق من هوية المدير (Admin Secret)
- ✅ Rate Limiting
- ✅ Idempotency للعمليات الخطيرة
- ✅ Audit Logging لجميع العمليات
- ✅ متغيرات البيئة للأسرار
- ✅ عدم كشف الأسرار في الرسائل

## 🛠️ التطوير-local
```bash
# تثبيت التبعيات
npm install

# فحص الأنواع
npm run typecheck

# فحص الكود
npm run lint
```

## 📝 هيكل قاعدة البيانات
راجع `migrations.sql` للج_tables الكاملة:
- `announcements` - إعلانات التطبي
- `notification_campaigns` - حملات الإشعارات
- `system_config` - إعدادات النظام
- `audit_logs` - سجل التدقيق
- `app_users` - مستخدمو التطبي
- `alert_logs` - سجل التنبيهات

## 💰 التكاليف المتوقعة
| الخدمة | الخطة المجانية | عند التوسع |
|---------|---------------|-----------|
| Vercel | Hobby (مجاني) | Pro $20/شهر |
| Supabase | Free (500MB) | Pro $25/شهر |
| Sentry | Developer (5k errors) | Team $26/شهر |
| FCM | مجاني | مجاني |
| **الإجمالي** | **$0** | **~$70/شهر** |

## 🆘 استكشاف الأخطاء
1. تحقق من Vercel Function Logs
2. تأكد من متغيرات البيئة م_multiples في Vercel
3. راجع Supabase Logs ل-max queries

## 📞 الدعم
للاستفسارات، راجع:
- [Vercel Serverless Functions Docs](https://vercel.com/docs/functions)
- [Supabase JavaScript Client](https://supabase.com/docs/reference/javascript)
- [Sentry API Documentation](https://docs.sentry.io/api/)