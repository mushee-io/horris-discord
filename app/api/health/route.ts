import { NextResponse } from "next/server";
import { getHorrisApiBaseUrl } from "../../../lib/horris-api";

export const dynamic = "force-dynamic";

export async function GET() {
  let upstreamHost = "invalid";
  try { upstreamHost = new URL(getHorrisApiBaseUrl()).host; } catch {}

  const publicKeyConfigured = Boolean(process.env.DISCORD_PUBLIC_KEY?.trim());
  const applicationIdConfigured = Boolean(process.env.DISCORD_APPLICATION_ID?.trim());
  const clientSecretConfigured = Boolean(process.env.DISCORD_CLIENT_SECRET?.trim());
  return NextResponse.json({
    service: "horris-discord",
    ok: publicKeyConfigured && applicationIdConfigured && clientSecretConfigured && upstreamHost !== "invalid",
    readiness: {
      discordPublicKeyConfigured: publicKeyConfigured,
      discordApplicationIdConfigured: applicationIdConfigured,
      discordActivityOAuthConfigured: clientSecretConfigured,
      activityUi: "/",
      activityComposeApi: "/api/activity/compose",
      horrisCoreHost: upstreamHost
    },
    interactionEndpoint: "/api/discord",
    activityEnabledInCode: true,
    readOnly: true,
    signingEnabled: false,
    executionEnabled: false,
    secretsExposed: false
  }, {
    headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" }
  });
}
