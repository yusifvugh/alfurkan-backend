import { bot } from "./bot";

// Vercel Serverless Function Handler
export default async function handler(req: Request): Promise<Response> {
  // Handle only POST requests from Telegram
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    // Process the update through grammY
    const response = await bot.handleUpdate(
      await req.json(),
      req as unknown as import("grammy").BotContext<import("grammy").Context>
    );
    
    return new Response(JSON.stringify({ ok: true, result: response }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}