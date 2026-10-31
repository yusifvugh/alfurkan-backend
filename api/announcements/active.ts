import { supabase } from "../../lib/supabase/client.js";

// GET /api/announcements/active
export default async function handler(req: any, res?: any) {
  const isWeb = typeof req.headers?.get === "function";

  const sendResponse = (statusCode: number, data: any) => {
    if (res && typeof res.status === "function") {
      return res.status(statusCode).json(data);
    }
    return new Response(JSON.stringify(data), {
      status: statusCode,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    });
  };

  if (req.method !== "GET") {
    return sendResponse(405, { ok: false, error: "Method Not Allowed" });
  }

  try {
    // 1. Fetch system config
    const { data: configRows } = await supabase
      .from("system_config")
      .select("key, value")
      .in("key", [
        "maintenance_mode",
        "maintenance_message",
        "min_supported_version",
        "force_update_version",
        "latest_version",
        "latest_build_number",
        "release_notes_url",
        "announcements_enabled",
      ]);

    const config: Record<string, any> = {};
    for (const row of configRows ?? []) {
      config[row.key] = row.value;
    }

    // 2. Fetch active announcements
    let announcements: any[] = [];
    if (config.announcements_enabled !== false) {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("announcements")
        .select("*")
        .eq("is_published", true)
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .or(`scheduled_at.is.null,scheduled_at.lte.${now}`)
        .order("priority", { ascending: false })
        .order("published_at", { ascending: false })
        .limit(10);

      if (!error && data) {
        announcements = data;
      }
    }

    return sendResponse(200, {
      ok: true,
      timestamp: new Date().toISOString(),
      maintenance: {
        enabled: config.maintenance_mode === true || config.maintenance_mode === "true",
        message: config.maintenance_message ?? "التطبيق تحت الصيانة، سيعمل قريباً",
      },
      versioning: {
        min_supported_version: config.min_supported_version ?? "1.0.0",
        force_update_version: config.force_update_version ?? null,
        latest_version: config.latest_version ?? "1.0.0",
        latest_build_number: config.latest_build_number ?? 1,
        release_notes_url: config.release_notes_url ?? null,
      },
      announcements,
    });
  } catch (error) {
    console.error("Active announcements error:", error);
    return sendResponse(500, {
      ok: false,
      error: "Internal Server Error",
    });
  }
}
