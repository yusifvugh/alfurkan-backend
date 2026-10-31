import { supabase } from "../supabase/client.js";

export interface FCMPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
}

export interface FCMResult {
  sent: number;
  failed: number;
  opened: number;
}

/**
 * Send FCM push notification to a batch of device tokens (in chunks of 500)
 */
export async function sendFCMBatch(
  tokens: string[],
  payload: FCMPayload
): Promise<FCMResult> {
  const validTokens = Array.from(new Set(tokens.filter(Boolean)));
  if (validTokens.length === 0) {
    return { sent: 0, failed: 0, opened: 0 };
  }

  const serverKey = process.env.FCM_SERVER_KEY;
  if (!serverKey) {
    console.warn("FCM_SERVER_KEY is not configured in environment variables.");
    return { sent: 0, failed: validTokens.length, opened: 0 };
  }

  let sent = 0;
  let failed = 0;

  // Process in chunks of 500 (FCM registration_ids limit)
  for (let i = 0; i < validTokens.length; i += 500) {
    const chunk = validTokens.slice(i, i + 500);
    try {
      const response = await fetch("https://fcm.googleapis.com/fcm/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `key=${serverKey}`,
        },
        body: JSON.stringify({
          registration_ids: chunk,
          notification: {
            title: payload.title,
            body: payload.body,
            image: payload.imageUrl,
            sound: "default",
          },
          data: payload.data ?? {},
          priority: "high",
        }),
      });

      if (!response.ok) {
        console.error("FCM API error response:", response.status, await response.text());
        failed += chunk.length;
        continue;
      }

      const result = (await response.json()) as {
        success?: number;
        failure?: number;
      };
      sent += result.success ?? 0;
      failed += result.failure ?? 0;
    } catch (err) {
      console.error("FCM chunk send error:", err);
      failed += chunk.length;
    }
  }

  return { sent, failed, opened: 0 };
}

/**
 * Send push notification for an announcement to all eligible devices
 */
export async function sendAnnouncementPush(announcement: {
  id: string;
  title: string;
  body: string;
  type?: string;
  target_version?: string | null;
  mandatory?: boolean;
  image_url?: string | null;
  action_url?: string | null;
}): Promise<FCMResult> {
  try {
    let query = supabase.from("app_users").select("fcm_token").not("fcm_token", "is", null);

    if (announcement.target_version) {
      query = query.eq("app_version", announcement.target_version);
    }

    const { data: users, error } = await query;
    if (error) {
      console.error("Failed to query app_users for announcement push:", error);
      return { sent: 0, failed: 0, opened: 0 };
    }

    const tokens = users?.map((u: any) => u.fcm_token).filter(Boolean) ?? [];
    if (tokens.length === 0) {
      console.log("No registered devices to receive push for announcement:", announcement.id);
      return { sent: 0, failed: 0, opened: 0 };
    }

    const result = await sendFCMBatch(tokens, {
      title: announcement.title,
      body: announcement.body,
      imageUrl: announcement.image_url ?? undefined,
      data: {
        type: "announcement",
        announcement_id: announcement.id,
        announcement_type: announcement.type ?? "general",
        target_version: announcement.target_version ?? "",
        mandatory: announcement.mandatory ? "true" : "false",
        action_url: announcement.action_url ?? "",
      },
    });

    console.log(`Push sent for announcement ${announcement.id}: ${result.sent} succeeded, ${result.failed} failed.`);
    return result;
  } catch (err) {
    console.error("sendAnnouncementPush unhandled error:", err);
    return { sent: 0, failed: 0, opened: 0 };
  }
}
