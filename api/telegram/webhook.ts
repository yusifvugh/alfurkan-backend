import { bot } from "../../lib/telegram/bot.js";
import type { Update } from "grammy/types";

async function parseBody(req: any): Promise<any> {
  if (req.body) {
    if (Buffer.isBuffer(req.body)) {
      const str = req.body.toString("utf8");
      return str ? JSON.parse(str) : null;
    }
    if (typeof req.body === "string") {
      return req.body ? JSON.parse(req.body) : null;
    }
    if (typeof req.body === "object") {
      return req.body;
    }
  }

  if (typeof req.json === "function") {
    try {
      return await req.json();
    } catch (_) {
      return null;
    }
  }

  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk: any) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : null);
      } catch (e) {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

// Vercel Serverless Function Handler (Handles Telegram Webhook + Set Webhook helper)
export default async function handler(req: any, res?: any) {
  const isWeb = typeof req.headers?.get === "function";
  const method = req.method;
  const urlStr = req.url || "";

  const send = (code: number, body: any) => {
    if (res && typeof res.status === "function") {
      return res.status(code).json(body);
    }
    return new Response(JSON.stringify(body, null, 2), {
      status: code,
      headers: { "Content-Type": "application/json" },
    });
  };

  // 1. If GET or requested action is 'set' or URL contains 'set-webhook', configure the webhook
  const isSetWebhook =
    method === "GET" ||
    urlStr.includes("set-webhook") ||
    (req.query && req.query.action === "set");

  if (isSetWebhook) {
    try {
      let host = "";
      if (isWeb) {
        const url = new URL(req.url, "http://localhost");
        host =
          req.headers.get("x-forwarded-host") ||
          req.headers.get("host") ||
          url.host;
      } else {
        host = req.headers["x-forwarded-host"] || req.headers["host"] || "";
      }

      const protocol = host.includes("localhost") ? "http" : "https";
      const inferredBaseUrl = host ? `${protocol}://${host}` : "";

      const BASE_URL = process.env.API_BASE_URL || inferredBaseUrl;
      if (!BASE_URL) {
        return send(400, {
          ok: false,
          error:
            "Could not determine BASE_URL. Please set API_BASE_URL in Vercel environment variables.",
        });
      }

      const WEBHOOK_URL = `${BASE_URL.replace(/\/$/, "")}/api/telegram/webhook`;
      const rawSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
      const SECRET = rawSecret
        ? rawSecret.trim().replace(/^["']|["']$/g, "")
        : undefined;

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

      return send(200, {
        ok: setResult,
        message: "Webhook set successfully! البوت جاهز الآن للاستقبال.",
        webhook_url: WEBHOOK_URL,
        has_secret: !!SECRET,
        info,
      });
    } catch (error) {
      console.error("Set webhook error:", error);
      return send(500, {
        ok: false,
        error: String(error),
        hint: "Make sure TELEGRAM_BOT_TOKEN is valid in your Vercel Environment Variables.",
      });
    }
  }

  // 2. Only accept POST requests from Telegram for updates
  if (method !== "POST") {
    return send(405, { error: "Method Not Allowed" });
  }

  // 3. Validate Telegram Webhook Secret Token from HTTP header if configured
  const rawSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const expectedSecret = rawSecret
    ? rawSecret.trim().replace(/^["']|["']$/g, "")
    : undefined;
  const secretHeader = (
    isWeb
      ? req.headers.get("x-telegram-bot-api-secret-token")
      : (req.headers?.["x-telegram-bot-api-secret-token"] ||
          req.headers?.["X-Telegram-Bot-Api-Secret-Token"])
  )
    ?.trim()
    .replace(/^["']|["']$/g, "");

  if (expectedSecret) {
    if (!secretHeader || secretHeader !== expectedSecret) {
      console.warn("Unauthorized webhook secret. Ignoring unauthorized request.");
      return send(401, { error: "Unauthorized" });
    }
  }

  // 4. Parse JSON update body
  let update: Update | null = null;
  try {
    update = await parseBody(req);
  } catch (error) {
    console.error("Invalid JSON body:", error);
    return send(400, { error: "Invalid JSON" });
  }

  // 5. Process update through grammY bot
  try {
    if (!update || typeof update !== "object") {
      console.warn("Received empty or invalid update payload");
      return send(200, { ok: true, note: "empty update" });
    }

    if (!bot.isInited()) {
      await bot.init();
    }

    await bot.handleUpdate(update);
    return send(200, { ok: true });
  } catch (error) {
    console.error("Webhook processing error:", error);
    return send(200, { ok: true, handled_error: String(error) });
  }
}
