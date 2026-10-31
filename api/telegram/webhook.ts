import { bot } from "../../lib/telegram/bot.js";
import type { Update } from "grammy/types";

// Vercel Serverless Function Handler (Supports both Node HTTP and Web Fetch standards)
export default async function handler(req: any, res?: any) {
  const isWeb = typeof req.headers?.get === "function";
  const method = req.method;

  // 1. Only accept POST requests from Telegram
  if (method !== "POST") {
    if (res && typeof res.status === "function") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }
    return new Response("Method Not Allowed", { status: 405 });
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
      console.warn("Invalid or missing webhook secret token. Expected:", expectedSecret?.slice(0, 4) + "...", "Received:", secretHeader?.slice(0, 4) + "...");
      if (res && typeof res.status === "function") {
        return res.status(401).json({ error: "Unauthorized" });
      }
      return new Response("Unauthorized", { status: 401 });
    }
  }

  // 3. Parse and validate JSON body
  let update: Update;
  try {
    if (isWeb) {
      update = (await req.json()) as Update;
    } else if (Buffer.isBuffer(req.body)) {
      update = JSON.parse(req.body.toString("utf8")) as Update;
    } else if (typeof req.body === "string") {
      update = JSON.parse(req.body) as Update;
    } else {
      update = req.body as Update;
    }
  } catch (error) {
    console.error("Invalid JSON body:", error);
    if (res && typeof res.status === "function") {
      return res.status(400).json({ error: "Invalid JSON" });
    }
    return new Response("Bad Request: Invalid JSON", { status: 400 });
  }

  // 4. Process update through grammY bot
  try {
    if (!update || typeof update !== "object") {
      console.warn("No valid update payload received in webhook");
      if (res && typeof res.status === "function") {
        return res.status(200).json({ ok: true, note: "empty update" });
      }
      return new Response(JSON.stringify({ ok: true, note: "empty update" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    await bot.handleUpdate(update);

    if (res && typeof res.status === "function") {
      return res.status(200).json({ ok: true });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook processing error:", error);
    // Respond with 200 to Telegram so it does not retry failed updates repeatedly
    if (res && typeof res.status === "function") {
      return res.status(200).json({ ok: true, handled_error: String(error) });
    }
    return new Response(JSON.stringify({ ok: true, handled_error: String(error) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
}
