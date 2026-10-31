export default async function handler(req: Request): Promise<Response> {
  return new Response(JSON.stringify({ 
    ok: true, 
    message: "Test endpoint working - rebuild " + new Date().toISOString(),
    timestamp: new Date().toISOString()
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}