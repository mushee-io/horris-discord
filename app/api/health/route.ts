import { NextResponse } from "next/server";
import { getHorrisApiBaseUrl } from "../../../lib/horris-api";

export const dynamic = "force-dynamic";

export async function GET() {
  let upstreamHost = "invalid";
  try { upstreamHost = new URL(getHorrisApiBaseUrl()).host; } catch {}

  const publicKeyConfigured = Boolean(process.env.DISCORD_PUBLIC_KEY?.trim());
  return NextResponse.json({
    service: "horris-discord",
    ok: publicKeyConfigured && upstreamHost !== "invalid",
    readiness: {
      discordPublicKeyConfigured: publicKeyConfigured,
      discordApplicationIdConfigured: Boolean(process.env.DISCORD_APPLICATION_ID?.trim()),
      horrisCoreHost: upstreamHost
    },
    interactionEndpoint: "/api/discord",
    readOnly: true,
    signingEnabled: false,
    executionEnabled: false,
    secretsExposed: false
  }, {
    headers: {
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
