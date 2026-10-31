import { performHealthChecks } from "../../lib/monitoring/health-check.js";

export default async function handler(req: any, res?: any) {
  const isWeb = typeof req.headers?.get === "function";

  const send = (code: number, body: any) => {
    if (res && typeof res.status === "function") {
      return res.status(code).json(body);
    }
    return new Response(JSON.stringify(body), {
      status: code,
      headers: { "Content-Type": "application/json" },
    });
  };

  if (req.method !== "GET") {
    return send(405, { error: "Method Not Allowed" });
  }

  try {
    const result = await performHealthChecks();
    return send(result.healthy ? 200 : 200, {
      ...result,
      ok: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Health check error:", error);
    return send(200, { 
      healthy: false, 
      ok: false,
      error: String(error),
      timestamp: new Date().toISOString()
    });
  }
}
