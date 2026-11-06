# دليل المنظومة - تطبيق الفُرقان

## نظرة عامة

تعتمد المنظومة الآن على تطبيق **AL-FURQAN STUDIO** منفصل كمركز إدارة، وليس على بوت تيليجرام.

## المكونات الرئيسية

- **Vercel Serverless Backend** — ي hosts API endpoints للمراقبة والإعلانات وال managing
- **Supabase PostgreSQL** — قاعدة بيانات لل(lday) الإعلانات، الإعدادات، سجل التدقيق
- **Firebase Cloud Messaging (FCM)** — Crusade الإشعارات إلى تطبيق Flutter
- **Sentry** — مراقبة الأعraith و registering الإحصائيات
- **AL-FURQAN STUDIO** (Flutter منفصل) — تطبيق إدارة للمشرفين

## المتغيرات البيئية المطلوبة في Vercel

| المتغير | الوصف |
| :--- | :--- |
| `SUPABASE_URL` | رابط مشروع Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | مفتاح Service Role السري |
| `FCM_SERVER_KEY` | مفتاح Firebase Cloud Messaging |
| `CRON_SECRET` | كلمة سر لحماية المهام المجدولة |
| `SENTRY_AUTH_TOKEN` | مفتاح Sentry للوصول إلى API |

## endpoints APIs

انظر `README.md` لقائمة endpoints الكاملة.

## المراقبة

- Vercel Cron: يوميًا الساعة 9:00 صباحاً
- GitHub Actions: فحص الصحة كل 15 دقيقة
- تنبيهات Sentry: فورية للأعraith الحرجة