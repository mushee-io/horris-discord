import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" } });
}

export async function POST(request: NextRequest) {
  const applicationId = process.env.DISCORD_APPLICATION_ID?.trim();
  const clientSecret = process.env.DISCORD_CLIENT_SECRET?.trim();
  if (!applicationId || !clientSecret) return json({ error: "Discord Activity OAuth is not configured." }, 503);

  const length = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(length) && length > 4_096) return json({ error: "Request too large." }, 413);

  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid request." }, 400);
  const code = (body as Record<string, unknown>).code;
  if (typeof code !== "string" || code.length < 8 || code.length > 2_048 || /[\r\n\0]/.test(code)) return json({ error: "Invalid authorization code." }, 400);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  try {
    const response = await fetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: applicationId, client_secret: clientSecret, grant_type: "authorization_code", code }),
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    });
    const data = await response.json() as { access_token?: unknown; token_type?: unknown; expires_in?: unknown };
    if (!response.ok || typeof data.access_token !== "string" || typeof data.expires_in !== "number") return json({ error: "Discord authorization failed." }, 401);
    return json({ access_token: data.access_token, token_type: data.token_type === "Bearer" ? "Bearer" : "Bearer", expires_in: data.expires_in });
  } catch {
    return json({ error: "Discord authorization is temporarily unavailable." }, 503);
  } finally {
    clearTimeout(timer);
  }
}
