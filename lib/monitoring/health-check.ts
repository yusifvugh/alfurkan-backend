import { createClient } from "@supabase/supabase-js";
import { getEnv } from "../utils/env";

const supabase = createClient(
  getEnv("SUPABASE_URL"),
  getEnv("SUPABASE_SERVICE_ROLE_KEY")
);

interface HealthCheckResult {
  healthy: boolean;
  checks: ServiceCheck[];
  timestamp: string;
}

interface ServiceCheck {
  name: string;
  status: "healthy" | "degraded" | "down";
  latencyMs: number | null;
  details: string;
}

export async function healthCheck(): Promise<{ healthy: boolean; details: string }> {
  const result = await performHealthChecks();
  return {
    healthy: result.healthy,
    details: result.checks.map(c => `${c.status === "healthy" ? "🟢" : c.status === "degraded" ? "🟡" : "🔴"} ${c.name}: ${c.details}${c.latencyMs ? ` (${c.latencyMs}ms)` : ""}`).join("\n"),
  };
}

export async function getSystemStatus(): Promise<string> {
  const result = await performHealthChecks();
  const allHealthy = result.healthy;
  const emoji = allHealthy ? "🟢" : "🔴";
  
  let msg = `${emoji} *حالة النظام* (${new Date(result.timestamp).toLocaleString("ar-SA")})\n\n`;
  
  for (const check of result.checks) {
    const statusEmoji = check.status === "healthy" ? "🟢" : check.status === "degraded" ? "🟡" : "🔴";
    msg += `${statusEmoji} *${check.name}*: ${check.status.toUpperCase()}`;
    if (check.latencyMs) msg += ` (${check.latencyMs}ms)`;
    msg += `\n   └ ${check.details}\n`;
  }
  
  return msg;
}

async function performHealthChecks(): Promise<HealthCheckResult> {
  const checks: ServiceCheck[] = [];
  const start = Date.now();
  
  // 1. API Health (self)
  checks.push(await checkService("API Health", async () => {
    return { status: "healthy" as const, details: "Self-check OK", latencyMs: Date.now() - start };
  }));
  
  // 2. Database (Supabase)
  checks.push(await checkService("Database", async () => {
    const dbStart = Date.now();
    const { error } = await supabase.from("health_check").select("1").limit(1);
    return {
      status: error ? "down" as const : "healthy" as const,
      details: error?.message ?? "Connection OK",
      latencyMs: Date.now() - dbStart,
    };
  }));
  
  // 3. FCM (Firebase Cloud Messaging)
  checks.push(await checkService("FCM", async () => {
    const fcmStart = Date.now();
    try {
      // التحقق البسيط من صحة المفاتيح
      const projectId = getEnv("FCM_PROJECT_ID");
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${await getFCMAccessToken()}`,
          },
          body: JSON.stringify({
            validate_only: true,
            message: { token: "test" },
          }),
          signal: AbortSignal.timeout(5000),
        }
      );
      return {
        status: response.ok || response.status === 400 ? "healthy" as const : "degraded" as const,
        details: response.ok ? "Credentials valid" : `HTTP ${response.status}`,
        latencyMs: Date.now() - fcmStart,
      };
    } catch (e) {
      return {
        status: "down" as const,
        details: String(e),
        latencyMs: Date.now() - fcmStart,
      };
    }
  }));
  
  // 4. Sentry
  checks.push(await checkService("Sentry", async () => {
    const sentryStart = Date.now();
    try {
      const org = getEnv("SENTRY_ORG");
      const token = getEnv("SENTRY_AUTH_TOKEN");
      const response = await fetch(
        `https://sentry.io/api/0/organizations/${org}/`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(5000),
        }
      );
      return {
        status: response.ok ? "healthy" as const : "degraded" as const,
        details: response.ok ? "API accessible" : `HTTP ${response.status}`,
        latencyMs: Date.now() - sentryStart,
      };
    } catch (e) {
      return {
        status: "down" as const,
        details: String(e),
        latencyMs: Date.now() - sentryStart,
      };
    }
  }));
  
  const healthy = checks.every(c => c.status === "healthy");
  return {
    healthy,
    checks,
    timestamp: new Date().toISOString(),
  };
}

async function checkService(
  name: string,
  checkFn: () => Promise<Omit<ServiceCheck, "name">>
): Promise<ServiceCheck> {
  try {
    const result = await checkFn();
    return { name, ...result };
  } catch (error) {
    return {
      name,
      status: "down",
      latencyMs: null,
      details: String(error),
    };
  }
}

async function getFCMAccessToken(): Promise<string> {
  // في البيئة الحقيقية، استخدم firebase-admin SDK
  // هنا نرجع قيمة مخزنة أو نولد توكن
  return process.env.FCM_ACCESS_TOKEN ?? "";
}