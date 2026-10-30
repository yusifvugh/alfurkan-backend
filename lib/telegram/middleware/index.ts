import { Context, NextFunction } from "grammy";
import { MyContext } from "../bot";
import { getEnv } from "../../utils/env";

// ============================================
// Admin Authorization Middleware
// ============================================

export function adminAuth() {
  const authorizedAdmins = getEnv("AUTHORIZED_ADMIN_IDS").split(",").map(s => s.trim());
  
  return async (ctx: MyContext, next: NextFunction) => {
    const userId = ctx.from?.id.toString();
    
    if (!userId || !authorizedAdmins.includes(userId)) {
      await ctx.reply("🚫 غير مصرح. هذا البوت مخصص للإدارة فقط.");
      return;
    }
    
    return next();
  };
}

// ============================================
// Rate Limiting Middleware
// ============================================

export function rateLimit(maxRequests = 30, windowMs = 60000) {
  return async (ctx: MyContext, next: NextFunction) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return next();
    
    const key = `ratelimit:${userId}`;
    try {
      const kv = (globalThis as any).kv;
      if (kv) {
        const current = (await kv.get<number>(key)) ?? 0;
        if (current >= maxRequests) {
          return ctx.reply(`⏳ تجاوزت حد الطلبات (${maxRequests}/${windowMs/1000}ث). انتظر قليلاً.`);
        }
        await kv.set(key, current + 1, { ex: Math.ceil(windowMs / 1000) });
      }
    } catch (e) {
      console.warn("Rate limit check failed:", e);
    }
    
    return next();
  };
}

// ============================================
// Idempotency Middleware
// ============================================

export function idempotency(prefix = "idempotency") {
  return async (ctx: MyContext, next: NextFunction) => {
    // تطبيق على callback queries الخطيرة فقط
    if (ctx.callbackQuery?.data?.startsWith("danger:")) {
      const key = `${prefix}:${ctx.callbackQuery.data}`;
      try {
        const kv = (globalThis as any).kv;
        if (kv) {
          const exists = await kv.get(key);
          if (exists) {
            return ctx.answerCallbackQuery("⚠️ تم تنفيذ هذا الأمر بالفعل");
          }
          await kv.set(key, "done", { ex: 3600 });
        }
      } catch (e) {
        console.warn("Idempotency check failed:", e);
      }
    }
    
    return next();
  };
}

// ============================================
// Webhook Secret Validation
// ============================================

export function webhookSecret() {
  const secret = getEnv("TELEGRAM_WEBHOOK_SECRET");
  
  return async (ctx: MyContext, next: NextFunction) => {
    const receivedSecret = ctx.webhookReplyEnvelope?.secret_token;
    if (receivedSecret !== secret) {
      console.warn("Invalid webhook secret token");
      return ctx.reply("❌ Unauthorized webhook");
    }
    
    return next();
  };
}

// ============================================
// Logging Middleware
// ============================================

export function requestLogger() {
  return async (ctx: MyContext, next: NextFunction) => {
    const start = Date.now();
    const userId = ctx.from?.id;
    const updateType = Object.keys(ctx.update).find(k => k !== "update_id");
    
    try {
      await next();
    } finally {
      const duration = Date.now() - start;
      console.log(
        `[${new Date().toISOString()}] ${updateType} | User: ${userId} | Duration: ${duration}ms`
      );
    }
  };
}

// ============================================
// Error Handler
// ============================================

export function errorHandler() {
  return async (ctx: MyContext, next: NextFunction) => {
    try {
      await next();
    } catch (error) {
      console.error("Bot error:", error);
      
      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery("❌ حدث خطأ").catch(() => {});
      } else {
        await ctx.reply("❌ حدث خطأ غير متوقع. تم تسجيله للمراجعة.").catch(() => {});
      }
    }
  };
}