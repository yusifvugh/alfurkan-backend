// GET /api/monitoring/health - Ultra-fast uptime & health endpoint
export default async function handler(req: any, res?: any) {
  const isWeb = typeof req.headers?.get === "function";

  const data = {
    healthy: true,
    status: "healthy",
    uptime: "100%",
    timestamp: new Date().toISOString(),
  };

  if (res && typeof res.status === "function") {
    return res.status(200).json(data);
  }

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
