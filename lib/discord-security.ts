import nacl from "tweetnacl";

export const MAX_INTERACTION_BYTES = 16 * 1024;
export const MAX_TIMESTAMP_SKEW_SECONDS = 300;
export const MAX_INTERACTION_OPTIONS = 25;
export const MAX_DISCORD_RESPONSE_CHARS = 1_900;
export const REPLAY_CACHE_TTL_MS = 5 * 60 * 1000;
export const MAX_REPLAY_CACHE_ENTRIES = 5_000;

const PUBLIC_KEY_HEX_LENGTH = 64;
const SIGNATURE_HEX_LENGTH = 128;
const SAFE_OPTION_NAME = /^[a-z0-9_]{1,32}$/;
const DISCORD_SNOWFLAKE = /^\d{16,20}$/;
const blockedOptionNames = new Set(["__proto__", "prototype", "constructor"]);
const replayCache = new Map<string, number>();

function hexToBytes(value: string, expectedHexLength: number) {
  if (value.length !== expectedHexLength || !/^[0-9a-fA-F]+$/.test(value)) throw new Error("Invalid hex");
  return Uint8Array.from(value.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)));
}

function pruneReplayCache(nowMs: number) {
  for (const [key, expiresAt] of replayCache) {
    if (expiresAt <= nowMs) replayCache.delete(key);
  }
  while (replayCache.size >= MAX_REPLAY_CACHE_ENTRIES) {
    const oldest = replayCache.keys().next().value as string | undefined;
    if (!oldest) break;
    replayCache.delete(oldest);
  }
}

export function verifyDiscordRequest(rawBody: string, headers: Headers, nowSeconds = Math.floor(Date.now() / 1000)) {
  const publicKey = process.env.DISCORD_PUBLIC_KEY?.trim();
  if (!publicKey || publicKey.length !== PUBLIC_KEY_HEX_LENGTH) return false;

  const signature = headers.get("x-signature-ed25519")?.trim();
  const timestamp = headers.get("x-signature-timestamp")?.trim();
  if (!signature || !timestamp || signature.length !== SIGNATURE_HEX_LENGTH) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) || timestampSeconds <= 0) return false;
  if (!Number.isSafeInteger(nowSeconds) || Math.abs(nowSeconds - timestampSeconds) > MAX_TIMESTAMP_SKEW_SECONDS) return false;

  try {
    return nacl.sign.detached.verify(
      new TextEncoder().encode(timestamp + rawBody),
      hexToBytes(signature, SIGNATURE_HEX_LENGTH),
      hexToBytes(publicKey, PUBLIC_KEY_HEX_LENGTH)
    );
  } catch {
    return false;
  }
}

export function consumeInteractionId(value: unknown, nowMs = Date.now()) {
  if (typeof value !== "string" || !DISCORD_SNOWFLAKE.test(value)) return false;
  if (!Number.isFinite(nowMs) || nowMs <= 0) return false;
  pruneReplayCache(nowMs);
  const existing = replayCache.get(value);
  if (existing && existing > nowMs) return false;
  replayCache.set(value, nowMs + REPLAY_CACHE_TTL_MS);
  return true;
}

export function optionMap(options: unknown) {
  const result: Record<string, unknown> = {};
  if (options === undefined || options === null) return result;
  if (!Array.isArray(options)) throw new Error("Invalid Discord command options.");
  if (options.length > MAX_INTERACTION_OPTIONS) throw new Error("Too many Discord command options.");

  for (const option of options) {
    if (!option || typeof option !== "object" || Array.isArray(option)) throw new Error("Invalid Discord command option.");
    const entry = option as Record<string, unknown>;
    if (typeof entry.name !== "string" || !SAFE_OPTION_NAME.test(entry.name) || blockedOptionNames.has(entry.name)) {
      throw new Error("Invalid Discord command option name.");
    }
    if (Object.prototype.hasOwnProperty.call(result, entry.name)) throw new Error("Duplicate Discord command option.");
    result[entry.name] = entry.value;
  }
  return result;
}

export function ephemeral(content: string) {
  const safeContent = String(content).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, MAX_DISCORD_RESPONSE_CHARS);
  return {
    type: 4,
    data: {
      content: safeContent,
      flags: 64,
      allowed_mentions: { parse: [] as string[] }
    }
  } as const;
}
