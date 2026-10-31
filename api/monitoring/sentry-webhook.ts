import { createClient } from "@supabase/supabase-js";
import { getEnv } from "../../lib/utils/env.js";
import { createHmac, timingSafeEqual } from "crypto";

const supabase = createClient(
  getEnv("SUPABASE_URL"),
  getEnv("SUPABASE_SERVICE_ROLE_KEY")
);

// التحقق من توقيع Sentry
function verifySentrySignature(signature: string | null, payload: string): boolean {
  if (!signature) return false;
  const secret = getEnv("SENTRY_WEBHOOK_SECRET");
  if (!secret) return false;
  
  if (!signature.startsWith("sha256=")) return false;
  
  const providedSignature = signature.slice(7); // Remove "sha256=" prefix
  const expectedSignature = createHmac("sha256", secret).update(payload).digest("hex");
  
  // Use timing-safe comparison
  const providedBuffer = Buffer.from(providedSignature, "hex");
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

interface SentryAlertPayload {
  action: "created" | "triggered" | "resolved" | "ignored";
  data: {
    issue?: {
      id: string;
      title: string;
      level: "fatal" | "error" | "warning" | "info";
      project: { id: string; name: string; slug: string };
      permalink: string;
      metadata: {
        value: string;
        type: string;
      }[];
      userCount?: number;
      count?: number;
      firstSeen: string;
      lastSeen: string;
      status: "unresolved" | "resolved" | "ignored";
    };
    alert_rule?: {
      id: string;
      name: string;
    };
    trigger?: {
      name: string;
      value: number;
    };
  };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const signature = req.headers.get("sentry-hook-signature");
    const payloadText = await req.text();
    
    if (!verifySentrySignature(signature, payloadText)) {
      console.warn("Invalid Sentry webhook signature");
      return new Response("Invalid signature", { status: 401 });
    }

    const payload: SentryAlertPayload = JSON.parse(payloadText);
    
    if (payload.action === "created" && payload.data.issue) {
      await processNewIssueAlert(payload.data.issue);
    } else if (payload.action === "triggered" && payload.data.alert_rule) {
      await processMetricAlert(payload.data.alert_rule, payload.data.trigger);
    } else if (payload.action === "resolved" && payload.data.issue) {
      await processIssueResolved(payload.data.issue);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Sentry webhook error:", error);
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function processNewIssueAlert(issue: SentryAlertPayload["data"]["issue"]) {
  if (!issue) return;
  
  const shouldAlert = issue.level === "fatal" || 
                      (issue.userCount && issue.userCount > 100) ||
                      (issue.count && issue.count > 50);
  
  if (!shouldAlert) return;
  
  const message = formatIssueAlert(issue);
  await sendTelegramAlert(message, issue.id);
  
  await logAlert({
    type: "new_issue",
    issue_id: issue.id,
    title: issue.title,
    level: issue.level,
    user_count: issue.userCount ?? 0,
    event_count: issue.count ?? 0,
    sent_at: new Date().toISOString(),
  });
}

async function processMetricAlert(alertRule: SentryAlertPayload["data"]["alert_rule"], trigger: SentryAlertPayload["data"]["trigger"]) {
  if (!alertRule || !trigger) return;
  
  const message = `📊 *تنبيه مقياس*\n\n` +
    `*القاعدة:* ${alertRule.name}\n` +
    `*المحفز:* ${trigger.name}\n` +
    `*القيمة:* ${trigger.value}\n` +
    `*الوقت:* ${new Date().toLocaleString("ar-SA")}`;
  
  await sendTelegramAlert(message, alertRule.id);
}

async function processIssueResolved(issue: SentryAlertPayload["data"]["issue"]) {
  if (!issue) return;
  
  const message = `✅ *تم حل المشكلة*\n\n` +
    `*العنوان:* ${issue.title}\n` +
    `*المستوى:* ${issue.level}\n` +
    `*الحالة:* ${issue.status}\n` +
    `*الوقت:* ${new Date().toLocaleString("ar-SA")}\n` +
    `[🔗 عرض في Sentry](${issue.permalink})`;
  
  await sendTelegramAlert(message, issue.id);
}

function formatIssueAlert(issue: SentryAlertPayload["data"]["issue"]): string {
  if (!issue) return "";
  
  const levelEmoji = issue.level === "fatal" ? "🔴" : 
                     issue.level === "error" ? "🟠" : "🟡";
  
  return `${levelEmoji} *${issue.level.toUpperCase()}: ${issue.title}*\n\n` +
    `📱 *الإصدار:* غير محدد\n` +
    `👥 *المستخدمون:* ${issue.userCount ?? "غير متاح"}\n` +
    `📊 *الأحداث:* ${issue.count ?? "غير متاح"}\n` +
    `🕐 *أول ظهور:* ${formatRelativeTime(issue.firstSeen)}\n` +
    `🕐 *آخر ظهور:* ${formatRelativeTime(issue.lastSeen)}\n` +
    `🔗 [عرض في Sentry](${issue.permalink})`;
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return "الآن";
  if (diffMins < 60) return `منذ ${diffMins} دقيقة`;
  if (diffHours < 24) return `منذ ${diffHours} ساعة`;
  return `منذ ${diffDays} يوم`;
}

async function sendTelegramAlert(message: string, issueId: string) {
  const botToken = getEnv("TELEGRAM_BOT_TOKEN");
  const chatId = getEnv("ADMIN_CHAT_ID");
  
  const keyboard = {
    inline_keyboard: [
      [
        { text: "🔍 عرض التفاصيل", callback_data: `mon:issue:${issueId}` },
        { text: "✅ تم الاعتراف", callback_data: `issue:status:${issueId}:acknowledged` }
      ],
      [
        { text: "🔇 كتم ساعة", callback_data: `alert:mute:${issueId}:3600` },
        { text: "📊 مركز المراقبة", callback_data: "menu:monitoring" }
      ]
    ]
  };
  
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: "Markdown",
      reply_markup: keyboard,
    }),
  });
}

async function logAlert(data: {
  type: string;
  issue_id: string;
  title: string;
  level: string;
  user_count: number;
  event_count: number;
  sent_at: string;
}) {
  try {
    await supabase.from("alert_logs").insert(data);
  } catch (e) {
    console.warn("Failed to log alert:", e);
  }
}