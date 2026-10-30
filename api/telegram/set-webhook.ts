import { bot } from "./bot.js";
import { getEnv } from "../../lib/utils/env.js";

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const BASE_URL = getEnv("API_BASE_URL");
    const WEBHOOK_URL = `${BASE_URL}/api/telegram/webhook`;
    const SECRET = getEnv("TELEGRAM_WEBHOOK_SECRET");

    const result = await bot.api.setWebhook(WEBHOOK_URL, {
      secret_token: SECRET,
      allowed_updates: [
        "message",
        "callback_query",
        "inline_query",
        "chosen_inline_result",
      ],
      drop_pending_updates: true,
    });

    const info = await bot.api.getWebhookInfo();

    return new Response(JSON.stringify({ ok: result, info }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Set webhook error:", error);
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}