import { performHealthChecks } from "../lib/monitoring/health-check";

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const result = await performHealthChecks();
    const status = result.healthy ? 200 : 503;
    
    return new Response(JSON.stringify(result), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Health check error:", error);
    return new Response(JSON.stringify({ 
      healthy: false, 
      error: String(error),
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}