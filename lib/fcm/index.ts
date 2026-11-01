import crypto from "node:crypto";
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

// ============================================
// FCM Legacy API (Server Key)
// ============================================

async function sendFCMLegacyBatch(
  tokens: string[],
  payload: FCMPayload,
  serverKey: string
): Promise<FCMResult> {
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < tokens.length; i += 500) {
    const chunk = tokens.slice(i, i + 500);
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
        const text = await response.text();
        console.error("FCM Legacy API error:", response.status, text);
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
      console.error("FCM Legacy chunk error:", err);
      failed += chunk.length;
    }
  }

  return { sent, failed, opened: 0 };
}

// ============================================
// FCM HTTP v1 API (Service Account / OAuth2)
// Uses Google's token endpoint directly — no extra SDK needed
// ============================================

async function getOAuthAccessToken(serviceAccountJson: string): Promise<string | null> {
  try {
    let raw = serviceAccountJson.trim();
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      raw = raw.slice(1, -1);
    }
    const sa = JSON.parse(raw);
    const now = Math.floor(Date.now() / 1000);

    // Build JWT header + payload
    const header = { alg: "RS256", typ: "JWT" };
    const claim = {
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    };

    const encode = (obj: object) =>
      Buffer.from(JSON.stringify(obj)).toString("base64url");

    const headerB64 = encode(header);
    const claimB64 = encode(claim);
    const unsigned = `${headerB64}.${claimB64}`;

    // Clean private key ensuring newline characters are intact
    const privateKey = (sa.private_key as string).replace(/\\n/g, "\n");

    // Sign with Node.js crypto (RSA-SHA256)
    const sign = crypto.createSign("RSA-SHA256");
    sign.update(unsigned);
    const signature = sign.sign(privateKey, "base64url");
    const jwt = `${unsigned}.${signature}`;

    // Exchange JWT for access token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    if (!tokenRes.ok) {
      console.error("OAuth2 token error:", await tokenRes.text());
      return null;
    }

    const tokenData = (await tokenRes.json()) as { access_token?: string };
    return tokenData.access_token ?? null;
  } catch (err) {
    console.error("getOAuthAccessToken error:", err);
    return null;
  }
}

async function sendFCMv1Batch(
  tokens: string[],
  payload: FCMPayload,
  projectId: string,
  serviceAccountJson: string
): Promise<FCMResult> {
  const accessToken = await getOAuthAccessToken(serviceAccountJson);
  if (!accessToken) {
    console.error("FCM v1: could not obtain OAuth2 access token");
    return { sent: 0, failed: tokens.length, opened: 0 };
  }

  let sent = 0;
  let failed = 0;
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

  // FCM v1 sends one message per token (no batching endpoint in v1)
  // Use Promise.allSettled in groups of 100 for speed
  const CONCURRENCY = 100;
  for (let i = 0; i < tokens.length; i += CONCURRENCY) {
    const chunk = tokens.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((token) =>
        fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            message: {
              token,
              notification: {
                title: payload.title,
                body: payload.body,
                ...(payload.imageUrl ? { image: payload.imageUrl } : {}),
              },
              data: payload.data ?? {},
              android: { priority: "high" },
              apns: {
                payload: { aps: { sound: "default" } },
              },
            },
          }),
        }).then((r) => r.ok)
      )
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) sent++;
      else failed++;
    }
  }

  return { sent, failed, opened: 0 };
}

// ============================================
// Main Send Function — auto-detects config
// ============================================

export async function sendFCMBatch(
  tokens: string[],
  payload: FCMPayload
): Promise<FCMResult> {
  const validTokens = Array.from(new Set(tokens.filter(Boolean)));
  if (validTokens.length === 0) {
    return { sent: 0, failed: 0, opened: 0 };
  }

  const serverKey = process.env.FCM_SERVER_KEY?.trim();
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  const projectId = (
    process.env.FCM_PROJECT_ID || process.env.FIREBASE_PROJECT_ID
  )?.trim();

  // Prefer HTTP v1 (modern, recommended)
  if (serviceAccountJson && projectId) {
    console.log(`FCM v1: sending to ${validTokens.length} tokens`);
    return sendFCMv1Batch(validTokens, payload, projectId, serviceAccountJson);
  }

  // Fallback to Legacy API
  if (serverKey) {
    console.log(`FCM Legacy: sending to ${validTokens.length} tokens`);
    return sendFCMLegacyBatch(validTokens, payload, serverKey);
  }

  console.warn(
    "FCM not configured: set FCM_SERVER_KEY (Legacy) or FIREBASE_SERVICE_ACCOUNT_JSON + FCM_PROJECT_ID (v1)"
  );
  return { sent: 0, failed: validTokens.length, opened: 0 };
}

// ============================================
// Send push for an announcement
// ============================================

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

    console.log(
      `Push for announcement ${announcement.id}: ${result.sent} sent, ${result.failed} failed.`
    );
    return result;
  } catch (err) {
    console.error("sendAnnouncementPush unhandled error:", err);
    return { sent: 0, failed: 0, opened: 0 };
  }
}
