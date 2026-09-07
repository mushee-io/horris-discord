import { NextResponse } from "next/server";
import { getHorrisApiBaseUrl } from "../../../lib/horris-api";

export const dynamic = "force-dynamic";

function walletStoreReady() {
  const kv = Boolean(process.env.KV_REST_API_URL?.trim() && process.env.KV_REST_API_TOKEN?.trim());
  const upstash = Boolean(process.env.UPSTASH_REDIS_REST_URL?.trim() && process.env.UPSTASH_REDIS_REST_TOKEN?.trim());
  return kv || upstash;
}

function walletLinkSecretReady() {
  const secret = (process.env.WALLET_LINK_SECRET || process.env.DISCORD_CLIENT_SECRET || "").trim();
  return secret.length >= 24;
}

export async function GET() {
  let upstreamHost = "invalid";
  try { upstreamHost = new URL(getHorrisApiBaseUrl()).host; } catch {}

  const publicKeyConfigured = Boolean(process.env.DISCORD_PUBLIC_KEY?.trim());
  const applicationIdConfigured = Boolean(process.env.DISCORD_APPLICATION_ID?.trim());
  const clientSecretConfigured = Boolean(process.env.DISCORD_CLIENT_SECRET?.trim());
  const botTokenConfigured = Boolean(process.env.DISCORD_BOT_TOKEN?.trim());
  const walletStorageConfigured = walletStoreReady();
  const walletSecretConfigured = walletLinkSecretReady();
  const coreConfigured = upstreamHost !== "invalid";

  return NextResponse.json({
    service: "horris-discord",
    ok: publicKeyConfigured && applicationIdConfigured && clientSecretConfigured && botTokenConfigured && walletStorageConfigured && walletSecretConfigured && coreConfigured,
    readiness: {
      discordPublicKeyConfigured: publicKeyConfigured,
      discordApplicationIdConfigured: applicationIdConfigured,
      discordActivityOAuthConfigured: clientSecretConfigured,
      discordBotConfigured: botTokenConfigured,
      walletPersistentStoreConfigured: walletStorageConfigured,
      walletLinkSecretConfigured: walletSecretConfigured,
      activityUi: "/",
      activityComposeApi: "/api/activity/compose",
      walletConnectPage: "/wallet/connect",
      horrisCoreHost: upstreamHost
    },
    interactionEndpoint: "/api/discord",
    activityEnabledInCode: true,
    walletLinkingEnabledInCode: true,
    tradingReadOnly: true,
    signingEnabled: false,
    executionEnabled: false,
    secretsExposed: false
  }, {
    headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" }
  });
}
