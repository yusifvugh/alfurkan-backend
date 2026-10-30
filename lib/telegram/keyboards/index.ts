import { InlineKeyboard } from "grammy";

export function createMainMenu() {
  return new InlineKeyboard()
    .text("📢 الإعلانات والتحديثات", "menu:announcements")
    .text("🔔 الإشعارات", "menu:notifications")
    .row()
    .text("⚙️ إعدادات النظام", "menu:settings")
    .text("📊 مركز المراقبة", "menu:monitoring")
    .row()
    .text("📝 إدارة المحتوى", "menu:content");
}

export function createConfirmationKeyboard(confirmId: string, cancelId: string = "cancel") {
  return new InlineKeyboard()
    .text("✅ تأكيد", confirmId)
    .text("❌ إلغاء", cancelId);
}

export function createPaginationKeyboard(
  currentPage: number,
  totalPages: number,
  baseCallback: string
) {
  const keyboard = new InlineKeyboard();
  
  if (currentPage > 1) {
    keyboard.text("⬅️ السابق", `${baseCallback}:page:${currentPage - 1}`);
  }
  
  keyboard.text(`${currentPage}/${totalPages}`, "noop");
  
  if (currentPage < totalPages) {
    keyboard.text("التالي ➡️", `${baseCallback}:page:${currentPage + 1}`);
  }
  
  return keyboard;
}

export function createEntityActionKeyboard(
  entityType: string,
  entityId: string,
  actions: Array<{ label: string; callback: string }>
) {
  const keyboard = new InlineKeyboard();
  
  for (const action of actions) {
    keyboard.text(action.label, `${entityType}:${action.callback}:${entityId}`).row();
  }
  
  keyboard.text("🔙 العودة", `${entityType}:list`);
  
  return keyboard;
}