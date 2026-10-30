import { createClient } from "@supabase/supabase-js";
import { getEnv } from "../utils/env.js";

export const supabase = createClient(
  getEnv("SUPABASE_URL"),
  getEnv("SUPABASE_SERVICE_ROLE_KEY")
);

// ============================================
// Type Helpers
// ============================================

export type Announcement = {
  id: string;
  title: string;
  body: string;
  type: "general" | "update" | "maintenance" | "feature";
  target_version: string | null;
  mandatory: boolean;
  priority: "high" | "medium" | "low";
  download_links: Record<string, string>;
  is_published: boolean;
  published_at: string | null;
  scheduled_at: string | null;
  expires_at: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
};

export type NotificationCampaign = {
  id: string;
  title: string;
  body: string;
  target_audience: "all" | "version" | "region" | "custom";
  target_filter: Record<string, any>;
  related_announcement_id: string | null;
  scheduled_at: string | null;
  status: "draft" | "scheduled" | "sending" | "sent" | "failed" | "cancelled";
  stats: { sent: number; failed: number; opened: number };
  sent_at: string | null;
  created_by: number;
  created_at: string;
};

export type SystemConfig = {
  key: string;
  value: any;
  description: string | null;
  is_secret: boolean;
  updated_by: number | null;
  updated_at: string;
};

export type AuditLog = {
  id: number;
  action: string;
  entity_type: string;
  entity_id: string | null;
  user_id: number;
  metadata: Record<string, any>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

export type AppUser = {
  device_id: string;
  fcm_token: string | null;
  app_version: string | null;
  build_number: number | null;
  platform: string | null;
  country: string | null;
  language: string | null;
  last_active_at: string;
  created_at: string;
};

export type AlertLog = {
  id: number;
  type: string;
  title: string;
  severity: "critical" | "warning" | "info";
  timestamp: string;
  metadata: Record<string, any>;
};

// ============================================
// Helper Functions
// ============================================

export async function logAudit(data: {
  action: string;
  entity_type: string;
  entity_id: string | null;
  user_id: number;
  metadata?: Record<string, any>;
}) {
  try {
    await supabase.from("audit_logs").insert({
      action: data.action,
      entity_type: data.entity_type,
      entity_id: data.entity_id,
      user_id: data.user_id,
      metadata: data.metadata ?? {},
    });
  } catch (error) {
    console.warn("Audit log failed:", error);
  }
}

export async function getConfig(key: string): Promise<any> {
  const { data, error } = await supabase
    .from("system_config")
    .select("value")
    .eq("key", key)
    .single();
  
  if (error) return null;
  return data?.value ?? null;
}

export async function setConfig(key: string, value: any, userId: number): Promise<void> {
  await supabase.from("system_config").upsert({
    key,
    value,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  });
}