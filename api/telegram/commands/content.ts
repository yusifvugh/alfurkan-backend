import { Context, InlineKeyboard } from "grammy";
import { MyContext } from "../bot";

// ============================================
// Content Management Menu (Placeholder)
// ============================================

export async function contentMenu(ctx: MyContext) {
  const keyboard = new InlineKeyboard()
    .text("📝 إنشاء منشور", "content:create")
    .text("📋 قائمة المنشورات", "content:list")
    .row()
    .text("📂 المسودات", "content:drafts")
    .text("📌 المثبتة", "content:pinned")
    .row()
    .text("🏷️ التصنيفات", "content:categories")
    .text("🔙 القائمة الرئيسية", "menu:main");

  await ctx.editMessageText(
    "📝 *إدارة المحتوى - نبض الفُرقان*\n\n" +
    "قيد التطوير... ستتوفر قريباً:\n" +
    "• إنشاء وتعديل وحذف المنشورات\n" +
    "• رفع الصور\n" +
    "• إضافة روابط خارجية\n" +
    "• إدارة التصنيفات والوسوم\n" +
    "• إدارة المسودات والنشر والجدولة\n" +
    "• تثبيت المنشورات\n" +
    "• ربط المنشورات بالإشعارات",
    { parse_mode: "Markdown", reply_markup: keyboard }
  );
}

export function registerContentCallbacks(bot: any) {
  bot.callbackQuery("menu:content", contentMenu);
}