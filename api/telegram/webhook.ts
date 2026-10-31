import { bot } from "../../lib/telegram/bot.js";
import type { Update } from "grammy/types";

async function parseBody(req: any): Promise<any> {
  // If already parsed
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

  // If Web standard Request
  if (typeof req.json === "function") {
    try {
      return await req.json();
    } catch (_) {
      return null;
    }
  }

  // If unconsumed Node IncomingMessage stream
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

// Vercel Serverless Function Handler (Supports both Node HTTP and Web Fetch standards)
export default async function handler(req: any, res?: any) {
  const isWeb = typeof req.headers?.get === "function";
  const method = req.method;

  const send = (code: number, body: any) => {
    if (res && typeof res.status === "function") {
      return res.status(code).json(body);
    }
    return new Response(JSON.stringify(body), {
      status: code,
      headers: { "Content-Type": "application/json" },
    });
  };

  // 1. Only accept POST requests from Telegram
  if (method !== "POST") {
    return send(405, { error: "Method Not Allowed" });
  }

  // 2. Validate Telegram Webhook Secret Token from HTTP header if configured
  const rawSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const expectedSecret = rawSecret ? rawSecret.trim().replace(/^["']|["']$/g, "") : undefined;
  const secretHeader = (
    isWeb
      ? req.headers.get("x-telegram-bot-api-secret-token")
      : (req.headers?.["x-telegram-bot-api-secret-token"] || req.headers?.["X-Telegram-Bot-Api-Secret-Token"])
  )?.trim().replace(/^["']|["']$/g, "");

  if (expectedSecret) {
    if (!secretHeader || secretHeader !== expectedSecret) {
      console.warn("Unauthorized webhook secret. Ignoring unauthorized request.");
      return send(401, { error: "Unauthorized" });
    }
  }

  // 3. Parse JSON update body
  let update: Update | null = null;
  try {
    update = await parseBody(req);
  } catch (error) {
    console.error("Invalid JSON body:", error);
    return send(400, { error: "Invalid JSON" });
  }

  // 4. Process update through grammY bot
  try {
    if (!update || typeof update !== "object") {
      console.warn("Received empty or invalid update payload");
      return send(200, { ok: true, note: "empty update" });
    }

    await bot.handleUpdate(update);
    return send(200, { ok: true });
  } catch (error) {
    console.error("Webhook processing error:", error);
    // Respond with 200 to Telegram so it does not retry failed updates repeatedly
    return send(200, { ok: true, handled_error: String(error) });
  }
}
