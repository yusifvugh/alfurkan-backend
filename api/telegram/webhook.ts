import { bot } from "./bot.js";
import type { Update } from "grammy/types";
import { createHmac, timingSafeEqual } from "crypto";

// Vercel Serverless Function Handler
export default async function handler(req: Request): Promise<Response> {
  // 1. Only accept POST requests from Telegram
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // 2. Validate Telegram Webhook Secret Token from HTTP header
  const secretHeader = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  
  if (!expectedSecret) {
    console.error("TELEGRAM_WEBHOOK_SECRET not configured");
    return new Response("Internal Server Error", { status: 500 });
  }

  if (!secretHeader) {
    console.warn("Missing X-Telegram-Bot-Api-Secret-Token header");
    return new Response("Unauthorized", { status: 401 });
  }

  // Use timing-safe comparison to prevent timing attacks
  const secretBuffer = Buffer.from(secretHeader, "utf8");
  const expectedBuffer = Buffer.from(expectedSecret, "utf8");
  
  if (secretBuffer.length !== expectedBuffer.length || 
      !timingSafeEqual(secretBuffer, expectedBuffer)) {
    console.warn("Invalid webhook secret token");
    return new Response("Unauthorized", { status: 401 });
  }

  // 3. Parse and validate JSON body
  let update: Update;
  try {
    update = await req.json() as Update;
  } catch (error) {
    console.error("Invalid JSON body:", error);
    return new Response("Bad Request: Invalid JSON", { status: 400 });
  }

  // 4. Process update through grammY bot
  try {
    await bot.handleUpdate(update);
    
    return new Response(JSON.stringify({ ok: true }), {
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