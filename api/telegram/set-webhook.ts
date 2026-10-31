import { bot } from "./bot.js";

// Vercel Serverless Function Handler (Supports both Node HTTP and Web Fetch standards)
export default async function handler(req: any, res?: any) {
  const isWeb = typeof req.headers?.get === "function";

  const sendResponse = (statusCode: number, data: any) => {
    if (res && typeof res.status === "function") {
      return res.status(statusCode).json(data);
    }
    return new Response(JSON.stringify(data, null, 2), {
      status: statusCode,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    // 1. Determine host/domain
    let host = "";
    if (isWeb) {
      const url = new URL(req.url);
      host = req.headers.get("x-forwarded-host") || req.headers.get("host") || url.host;
    } else {
      host = req.headers["x-forwarded-host"] || req.headers["host"] || "";
    }

    const protocol = host.includes("localhost") ? "http" : "https";
    const inferredBaseUrl = host ? `${protocol}://${host}` : "";

    const BASE_URL = process.env.API_BASE_URL || inferredBaseUrl;
    if (!BASE_URL) {
      return sendResponse(400, {
        ok: false,
        error: "Could not determine BASE_URL. Please set API_BASE_URL in Vercel environment variables."
      });
    }

    const WEBHOOK_URL = `${BASE_URL.replace(/\/$/, "")}/api/telegram/webhook`;
    const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();

    const webhookOptions: any = {
      allowed_updates: [
        "message",
        "callback_query",
        "inline_query",
        "chosen_inline_result",
      ],
      drop_pending_updates: true,
    };

    if (SECRET) {
      webhookOptions.secret_token = SECRET;
    }

    const setResult = await bot.api.setWebhook(WEBHOOK_URL, webhookOptions);
    const info = await bot.api.getWebhookInfo();

    return sendResponse(200, {
      ok: setResult,
      message: "Webhook set successfully! البوت جاهز الآن للاستقبال.",
      webhook_url: WEBHOOK_URL,
      has_secret: !!SECRET,
      info,
    });
  } catch (error) {
    console.error("Set webhook error:", error);
    return sendResponse(500, {
      ok: false,
      error: String(error),
      hint: "Make sure TELEGRAM_BOT_TOKEN is valid in your Vercel Environment Variables.",
    });
  }
}
