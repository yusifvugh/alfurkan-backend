import { supabase } from "../../lib/supabase/client.js";

// POST /api/users/register
export default async function handler(req: any, res?: any) {
  const isWeb = typeof req.headers?.get === "function";

  const sendResponse = (statusCode: number, data: any) => {
    if (res && typeof res.status === "function") {
      return res.status(statusCode).json(data);
    }
    return new Response(JSON.stringify(data), {
      status: statusCode,
      headers: { "Content-Type": "application/json" },
    });
  };

  if (req.method !== "POST") {
    return sendResponse(405, { ok: false, error: "Method Not Allowed" });
  }

  let body: any = {};
  try {
    if (isWeb) {
      body = await req.json();
    } else {
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    }
  } catch (e) {
    return sendResponse(400, { ok: false, error: "Invalid JSON body" });
  }

  const {
    device_id,
    fcm_token,
    app_version,
    build_number,
    platform,
    country,
    language,
  } = body ?? {};

  if (!device_id) {
    return sendResponse(400, { ok: false, error: "device_id is required" });
  }

  try {
    const { error } = await supabase.from("app_users").upsert({
      device_id,
      fcm_token: fcm_token ?? null,
      app_version: app_version ?? null,
      build_number: typeof build_number === "number" ? build_number : null,
      platform: platform ?? "android",
      country: country ?? null,
      language: language ?? "ar",
      last_active_at: new Date().toISOString(),
    });

    if (error) {
      console.error("Upsert app_user error:", error);
      return sendResponse(500, { ok: false, error: error.message });
    }

    return sendResponse(200, {
      ok: true,
      message: "Device registered successfully",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Register device unexpected error:", error);
    return sendResponse(500, { ok: false, error: "Internal Server Error" });
  }
}
