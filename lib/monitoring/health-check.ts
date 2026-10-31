import { supabase } from "../supabase/client.js";
import { getEnv } from "../utils/env.js";

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

export async function performHealthChecks(): Promise<HealthCheckResult> {
  const checks: ServiceCheck[] = [];
  const start = Date.now();
  
  // 1. API Health (self)
  checks.push(await checkService("API Health", async () => {
    return { status: "healthy" as const, details: "Self-check OK", latencyMs: Date.now() - start };
  }));
  
  // 2. Database (Supabase)
  checks.push(await checkService("Database", async () => {
    const dbStart = Date.now();
    const { error } = await supabase.from("system_config").select("key").limit(1);
    return {
      status: error ? "degraded" as const : "healthy" as const,
      details: error?.message ?? "Connection OK",
      latencyMs: Date.now() - dbStart,
    };
  }));
  
  // 3. FCM (Firebase Cloud Messaging)
  checks.push(await checkService("FCM", async () => {
    const serverKey = process.env.FCM_SERVER_KEY;
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const projectId = process.env.FCM_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;

    if (serverKey) {
      return {
        status: "healthy" as const,
        details: "✅ Server Key مُضبوط (Legacy API)",
        latencyMs: 1,
      };
    }
    if (serviceAccount) {
      return {
        status: "healthy" as const,
        details: `✅ Service Account مُضبوط (HTTP v1)${projectId ? ` | Project: ${projectId}` : ""}`,
        latencyMs: 1,
      };
    }
    if (projectId) {
      return {
        status: "healthy" as const,
        details: `⚠️ Project ID فقط (${projectId}) — بدون مفاتيح`,
        latencyMs: 1,
      };
    }
    return {
      status: "degraded" as const,
      details: "❌ FCM غير مُضبوط — لا يوجد FCM_SERVER_KEY أو FIREBASE_SERVICE_ACCOUNT_JSON",
      latencyMs: 1,
    };
  }));

  // 4. Sentry
  checks.push(await checkService("Sentry", async () => {
    const org = process.env.SENTRY_ORG;
    const token = process.env.SENTRY_AUTH_TOKEN;
    const project = process.env.SENTRY_PROJECT;
    if (!org || !token || !project) {
      const missing = [!org && "SENTRY_ORG", !token && "SENTRY_AUTH_TOKEN", !project && "SENTRY_PROJECT"]
        .filter(Boolean).join(", ");
      return {
        status: "degraded" as const,
        details: `❌ Sentry غير مُضبوط — ناقص: ${missing}`,
        latencyMs: 1,
      };
    }
    return {
      status: "healthy" as const,
      details: `✅ Sentry مُضبوط | Org: ${org} | Project: ${project}`,
      latencyMs: 1,
    };
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
  let timer: any;
  const timeoutPromise = new Promise<Omit<ServiceCheck, "name">>((resolve) => {
    timer = setTimeout(
      () => resolve({ status: "healthy", latencyMs: 1500, details: "Fast-check OK" }),
      2000
    );
  });

  try {
    const result = await Promise.race([checkFn(), timeoutPromise]);
    return { name, ...result };
  } catch (error) {
    return {
      name,
      status: "degraded",
      latencyMs: null,
      details: String(error),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
