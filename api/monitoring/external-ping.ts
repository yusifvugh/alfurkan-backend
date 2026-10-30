import { createClient } from "@supabase/supabase-js";
import { getEnv } from "../../lib/utils/env.js";

const supabase = createClient(
  getEnv("SUPABASE_URL"),
  getEnv("SUPABASE_SERVICE_ROLE_KEY")
);

interface MonitoringResult {
  timestamp: string;
  checks: ServiceCheck[];
}

interface ServiceCheck {
  name: string;
  status: "healthy" | "degraded" | "down";
  latencyMs: number | null;
  details: string;
}

export default async function handler(req: Request): Promise<Response> {
  const authHeader = req.headers.get("authorization");
  const cronSecret = getEnv("CRON_SECRET");
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const results: MonitoringResult = {
    timestamp: new Date().toISOString(),
    checks: [],
  };

  // 1. API Health
  try {
    const start = Date.now();
    const response = await fetch(`${getEnv("API_BASE_URL")}/api/monitoring/health`, {
      signal: AbortSignal.timeout(5000),
    });
    results.checks.push({
      name: "API Health",
      status: response.ok ? "healthy" : "degraded",
      latencyMs: Date.now() - start,
      details: response.ok ? "OK" : `HTTP ${response.status}`,
    });
  } catch (e) {
    results.checks.push({
      name: "API Health",
      status: "down",
      latencyMs: null,
      details: String(e),
    });
  }

  // 2. Database
  try {
    const start = Date.now();
    const { error } = await supabase.from("health_check").select("1").limit(1);
    results.checks.push({
      name: "Database",
      status: error ? "degraded" : "healthy",
      latencyMs: Date.now() - start,
      details: error?.message ?? "OK",
    });
  } catch (e) {
    results.checks.push({
      name: "Database",
      status: "down",
      latencyMs: null,
      details: String(e),
    });
  }

  // 3. FCM
  try {
    const start = Date.now();
    const projectId = getEnv("FCM_PROJECT_ID");
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await getFCMAccessToken()}`,
        },
        body: JSON.stringify({ validate_only: true, message: { token: "test" } }),
        signal: AbortSignal.timeout(5000),
      },
    );
    results.checks.push({
      name: "FCM",
      status: response.ok || response.status === 400 ? "healthy" : "degraded",
      latencyMs: Date.now() - start,
      details: response.ok ? "OK" : `HTTP ${response.status}`,
    });
  } catch (e) {
    results.checks.push({
      name: "FCM",
      status: "down",
      latencyMs: null,
      details: String(e),
    });
  }

  // 4. Sentry
  try {
    const start = Date.now();
    const org = getEnv("SENTRY_ORG");
    const token = getEnv("SENTRY_AUTH_TOKEN");
    const response = await fetch(
      `https://sentry.io/api/0/organizations/${org}/`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      },
    );
    results.checks.push({
      name: "Sentry",
      status: response.ok ? "healthy" : "degraded",
      latencyMs: Date.now() - start,
      details: response.ok ? "OK" : `HTTP ${response.status}`,
    });
  } catch (e) {
    results.checks.push({
      name: "Sentry",
      status: "down",
      latencyMs: null,
      details: String(e),
    });
  }

  // التحقق من التنبيهات الحرجة
  const downServices = results.checks.filter(c => c.status === "down");
  if (downServices.length > 0) {
    await sendCriticalAlert(downServices);
  }

  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function getFCMAccessToken(): Promise<string> {
  return process.env.FCM_ACCESS_TOKEN ?? "";
}

async function sendCriticalAlert(downServices: ServiceCheck[]) {
  const message = `🔴 *تنبيه حرج: خدمات معطلة*\n\n` +
    downServices.map(s => `❌ ${s.name}: ${s.details}`).join("\n") +
    `\n\n⏰ ${new Date().toLocaleString("ar-SA")}`;
  
  const botToken = getEnv("TELEGRAM_BOT_TOKEN");
  const chatId = getEnv("ADMIN_CHAT_ID");
  
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
      }),
    });
  } catch (e) {
    console.error("Failed to send critical alert:", e);
  }
}