export default async function handler(req: Request): Promise<Response> {
  return new Response(JSON.stringify({ 
    ok: true, 
    message: "Test endpoint working",
    timestamp: new Date().toISOString()
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}