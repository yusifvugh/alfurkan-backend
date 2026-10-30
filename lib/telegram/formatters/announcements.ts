export interface AnnouncementPreviewData {
  title: string;
  body: string;
  type: string;
  targetVersion?: string | null;
  mandatory?: boolean;
  priority: string;
  downloadLinks?: Record<string, string>;
  scheduledAt?: Date | null;
}

export function formatAnnouncementPreview(data: AnnouncementPreviewData): string {
  const typeEmoji = data.type === "update" ? "🔄" : 
                    data.type === "maintenance" ? "⚠️" : 
                    data.type === "feature" ? "🎉" : "📢";
  
  const priorityEmoji = data.priority === "high" ? "🔴" : 
                        data.priority === "medium" ? "🟡" : "🟢";
  
  let msg = `👁️ *معاينة الإعلان*\n\n`;
  msg += `${typeEmoji} *النوع:* ${getTypeLabel(data.type)}\n`;
  msg += `📝 *العنوان:* ${data.title}\n`;
  msg += `📄 *المحتوى:* ${data.body.slice(0, 200)}${data.body.length > 200 ? "..." : ""}\n`;
  msg += `${priorityEmoji} *الأولوية:* ${getPriorityLabel(data.priority)}\n`;
  
  if (data.type === "update") {
    if (data.targetVersion) msg += `🔢 *الإصدار:* ${data.targetVersion}\n`;
    msg += `🔒 *إلزامي:* ${data.mandatory ? "نعم" : "لا"}\n`;
    if (data.downloadLinks && Object.keys(data.downloadLinks).length > 0) {
      msg += `🔗 *روابط التحميل:* ${Object.keys(data.downloadLinks).join(", ")}\n`;
    }
  }
  
  if (data.scheduledAt) {
    msg += `⏰ *النشر المجدول:* ${data.scheduledAt.toLocaleString("ar-SA")}\n`;
  } else {
    msg += `🚀 *النشر:* فوري\n`;
  }
  
  return msg;
}

function getTypeLabel(type: string): string {
  switch (type) {
    case "update": return "تحديث تطبيق";
    case "maintenance": return "صيانة";
    case "feature": return "ميزة جديدة";
    default: return "إعلان عام";
  }
}

function getPriorityLabel(priority: string): string {
  switch (priority) {
    case "high": return "عالية (بانر علوي)";
    case "medium": return "متوسطة (بطاقة)";
    default: return "منخفضة (في القائمة)";
  }
}

export function formatNotificationPreview(data: {
  title: string;
  body: string;
  audience: string;
  targetFilter?: Record<string, any>;
  scheduledAt?: Date | null;
  relatedAnnouncementId?: string | null;
}): string {
  let msg = `🔔 *معاينة الإشعار*\n\n`;
  msg += `📝 *العنوان:* ${data.title}\n`;
  msg += `📄 *المحتوى:* ${data.body}\n`;
  msg += `👥 *الجمهور:* ${formatAudience(data.audience, data.targetFilter)}\n`;
  
  if (data.relatedAnnouncementId) {
    msg += `🔗 *مرتبط بإعلان:* ${data.relatedAnnouncementId}\n`;
  }
  
  if (data.scheduledAt) {
    msg += `⏰ *الوقت:* ${data.scheduledAt.toLocaleString("ar-SA")}\n`;
  } else {
    msg += `🚀 *الإرسال:* فوري\n`;
  }
  
  return msg;
}

function formatAudience(audience: string, filter?: Record<string, any>): string {
  switch (audience) {
    case "all": return "جميع المستخدمين";
    case "version": return `إصدار: ${filter?.version ?? "غير محدد"}`;
    case "region": return `منطقة: ${filter?.country ?? "غير محدد"}`;
    case "custom": return "مخصص";
    default: return audience;
  }
}