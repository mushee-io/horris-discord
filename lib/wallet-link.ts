import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getAddress, isAddress, verifyMessage, type Hex } from "viem";

const LINK_TTL_SECONDS = 10 * 60;
const WALLET_TTL_SECONDS = 365 * 24 * 60 * 60;
const WALLET_SAVE_LOCK_SECONDS = 15;
const KEY_PREFIX = "horris:discord:wallet";
const REQUEST_ID = /^[a-f0-9]{32}$/;
const DISCORD_USER_ID = /^\d{16,20}$/;

type WalletChallenge = {
  address: string;
  chainId: number;
  message: string;
  createdAt: string;
};

type WalletLinkRequest = {
  requestId: string;
  discordUserId: string;
  interactionToken: string;
  expiresAt: number;
  challenge?: WalletChallenge;
};

export type WalletLink = {
  discordUserId: string;
  walletAddress: string;
  chainId: number;
  verifiedAt: string;
};

type LinkTokenPayload = {
  v: 1;
  rid: string;
  exp: number;
};

type RedisResult = { result?: unknown; error?: string };

type MemoryValue = { value: string; expiresAt: number };
const memory = new Map<string, MemoryValue>();

export class WalletLinkError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) {
    super(message);
    this.name = "WalletLinkError";
  }
}

function redisConfig() {
  const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/$/, "");
  const token = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  return url && token ? { url, token } : null;
}

function linkSecret() {
  const secret = (process.env.WALLET_LINK_SECRET || process.env.DISCORD_CLIENT_SECRET || "").trim();
  if (secret.length < 24) {
    throw new WalletLinkError("Wallet linking is not configured on this deployment.", "WALLET_LINK_SECRET_MISSING", 503);
  }
  return secret;
}

export function walletStoreConfigured() {
  return Boolean(redisConfig()) || process.env.NODE_ENV !== "production";
}

function ensureStore() {
  if (!walletStoreConfigured()) {
    throw new WalletLinkError("Wallet linking needs a persistent Redis/KV store on this deployment.", "WALLET_STORE_NOT_CONFIGURED", 503);
  }
}

async function redis(command: Array<string | number>) {
  const config = redisConfig();
  if (!config) return undefined;

  let response: Response;
  try {
    response = await fetch(`${config.url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify([command]),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000)
    });
  } catch {
    throw new WalletLinkError("Wallet storage is temporarily unavailable.", "WALLET_STORE_UNAVAILABLE", 503);
  }

  if (!response.ok) {
    throw new WalletLinkError("Wallet storage is temporarily unavailable.", "WALLET_STORE_HTTP_ERROR", 503);
  }

  const payload = await response.json() as RedisResult[];
  const first = payload[0];
  if (!first || first.error) {
    throw new WalletLinkError("Wallet storage rejected the request.", "WALLET_STORE_COMMAND_ERROR", 503);
  }
  return first.result;
}

function pruneMemory(now = Date.now()) {
  for (const [key, entry] of memory) {
    if (entry.expiresAt <= now) memory.delete(key);
  }
}

async function storeSet(key: string, value: string, ttlSeconds: number) {
  ensureStore();
  if (redisConfig()) {
    await redis(["SET", key, value, "EX", ttlSeconds]);
    return;
  }
  pruneMemory();
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

async function storeSetIfAbsent(key: string, value: string, ttlSeconds: number) {
  ensureStore();
  if (redisConfig()) {
    const result = await redis(["SET", key, value, "EX", ttlSeconds, "NX"]);
    return result === "OK";
  }
  pruneMemory();
  if (memory.has(key)) return false;
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  return true;
}

async function storeGet(key: string) {
  ensureStore();
  if (redisConfig()) {
    const result = await redis(["GET", key]);
    return typeof result === "string" ? result : null;
  }
  pruneMemory();
  return memory.get(key)?.value ?? null;
}

async function storeDelete(...keys: string[]) {
  ensureStore();
  if (!keys.length) return;
  if (redisConfig()) {
    await redis(["DEL", ...keys]);
    return;
  }
  for (const key of keys) memory.delete(key);
}

function requestKey(requestId: string) {
  return `${KEY_PREFIX}:request:${requestId}`;
}
function userKey(discordUserId: string) {
  return `${KEY_PREFIX}:user:${discordUserId}`;
}
function userSaveLockKey(discordUserId: string) {
  return `${KEY_PREFIX}:lock:${discordUserId}`;
}
function addressKey(address: string) {
  return `${KEY_PREFIX}:address:${address.toLowerCase()}`;
}

function encodeToken(payload: LinkTokenPayload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", linkSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function decodeToken(token: string): LinkTokenPayload {
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) throw new WalletLinkError("Invalid wallet connection link.", "INVALID_LINK");

  const expected = createHmac("sha256", linkSecret()).update(encoded).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(signature, "base64url"); }
  catch { throw new WalletLinkError("Invalid wallet connection link.", "INVALID_LINK"); }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new WalletLinkError("Invalid wallet connection link.", "INVALID_LINK");
  }

  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); }
  catch { throw new WalletLinkError("Invalid wallet connection link.", "INVALID_LINK"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new WalletLinkError("Invalid wallet connection link.", "INVALID_LINK");

  const payload = parsed as Record<string, unknown>;
  if (payload.v !== 1 || typeof payload.rid !== "string" || !REQUEST_ID.test(payload.rid) || typeof payload.exp !== "number") {
    throw new WalletLinkError("Invalid wallet connection link.", "INVALID_LINK");
  }
  if (!Number.isSafeInteger(payload.exp) || payload.exp <= Date.now()) {
    throw new WalletLinkError("This wallet connection link has expired. Run /connect-wallet again.", "LINK_EXPIRED", 410);
  }
  return payload as LinkTokenPayload;
}

async function getRequestFromToken(token: string) {
  const payload = decodeToken(token);
  const raw = await storeGet(requestKey(payload.rid));
  if (!raw) throw new WalletLinkError("This wallet connection request expired. Run /connect-wallet again.", "REQUEST_EXPIRED", 410);

  let request: WalletLinkRequest;
  try { request = JSON.parse(raw) as WalletLinkRequest; }
  catch { throw new WalletLinkError("Wallet connection request is invalid.", "REQUEST_INVALID", 400); }
  if (request.requestId !== payload.rid || request.expiresAt <= Date.now() || !DISCORD_USER_ID.test(request.discordUserId)) {
    throw new WalletLinkError("This wallet connection request expired. Run /connect-wallet again.", "REQUEST_EXPIRED", 410);
  }
  return request;
}

function normalizeAddress(value: string) {
  if (!isAddress(value)) throw new WalletLinkError("A valid EVM wallet address is required.", "INVALID_ADDRESS");
  return getAddress(value);
}

function normalizeChainId(value: unknown) {
  const chainId = Number(value);
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || chainId > 2_147_483_647) {
    throw new WalletLinkError("A valid wallet chain ID is required.", "INVALID_CHAIN_ID");
  }
  return chainId;
}

export async function createWalletLinkRequest(discordUserId: string, interactionToken: string) {
  if (!DISCORD_USER_ID.test(discordUserId)) throw new WalletLinkError("Discord user identity is missing.", "DISCORD_USER_MISSING");
  if (!interactionToken || interactionToken.length > 256) throw new WalletLinkError("Discord callback token is missing.", "DISCORD_CALLBACK_MISSING");
  ensureStore();
  linkSecret();

  const requestId = randomBytes(16).toString("hex");
  const expiresAt = Date.now() + LINK_TTL_SECONDS * 1000;
  const request: WalletLinkRequest = { requestId, discordUserId, interactionToken, expiresAt };
  await storeSet(requestKey(requestId), JSON.stringify(request), LINK_TTL_SECONDS);
  return encodeToken({ v: 1, rid: requestId, exp: expiresAt });
}

export async function createWalletChallenge(input: { token: string; address: string; chainId: unknown; domain: string }) {
  const request = await getRequestFromToken(input.token);
  const address = normalizeAddress(input.address);
  const chainId = normalizeChainId(input.chainId);
  const now = new Date();
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = new Date(request.expiresAt).toISOString();
  const message = [
    "Horris Wallet Link",
    "",
    `Domain: ${input.domain}`,
    `Discord User: ${request.discordUserId}`,
    `Wallet: ${address}`,
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expires At: ${expiresAt}`,
    "",
    "Purpose: verify wallet ownership for Horris Discord.",
    "This signature cannot move funds or grant spending permission."
  ].join("\n");

  request.challenge = { address, chainId, message, createdAt: now.toISOString() };
  const ttl = Math.max(1, Math.ceil((request.expiresAt - Date.now()) / 1000));
  await storeSet(requestKey(request.requestId), JSON.stringify(request), ttl);
  return { message, address, chainId, expiresAt };
}

async function saveWalletLink(link: WalletLink) {
  const lock = userSaveLockKey(link.discordUserId);
  const lockValue = randomBytes(16).toString("hex");
  const lockAcquired = await storeSetIfAbsent(lock, lockValue, WALLET_SAVE_LOCK_SECONDS);
  if (!lockAcquired) {
    throw new WalletLinkError("Another wallet link is already being finalized for this Discord account. Try again.", "WALLET_LINK_IN_PROGRESS", 409);
  }

  const targetAddressKey = addressKey(link.walletAddress);
  let claimedTarget = false;
  try {
    const existingOwner = await storeGet(targetAddressKey);
    if (existingOwner && existingOwner !== link.discordUserId) {
      throw new WalletLinkError("That wallet is already linked to another Discord account.", "WALLET_ALREADY_LINKED", 409);
    }

    if (!existingOwner) {
      claimedTarget = await storeSetIfAbsent(targetAddressKey, link.discordUserId, WALLET_TTL_SECONDS);
      if (!claimedTarget) {
        const racedOwner = await storeGet(targetAddressKey);
        if (racedOwner !== link.discordUserId) {
          throw new WalletLinkError("That wallet is already linked to another Discord account.", "WALLET_ALREADY_LINKED", 409);
        }
      }
    } else {
      // Refresh the reverse mapping when this Discord account already owns it.
      await storeSet(targetAddressKey, link.discordUserId, WALLET_TTL_SECONDS);
    }

    const previous = await getWalletLink(link.discordUserId);
    try {
      await storeSet(userKey(link.discordUserId), JSON.stringify(link), WALLET_TTL_SECONDS);
    } catch (error) {
      if (claimedTarget) {
        try { await storeDelete(targetAddressKey); } catch {}
      }
      throw error;
    }

    if (previous && previous.walletAddress.toLowerCase() !== link.walletAddress.toLowerCase()) {
      await storeDelete(addressKey(previous.walletAddress));
    }
  } finally {
    // The lock has a short TTL as a crash fallback; best-effort deletion keeps
    // normal sequential links responsive.
    try {
      const current = await storeGet(lock);
      if (current === lockValue) await storeDelete(lock);
    } catch {}
  }
}

export async function verifyWalletChallenge(input: { token: string; address: string; signature: string }) {
  const request = await getRequestFromToken(input.token);
  const challenge = request.challenge;
  if (!challenge) throw new WalletLinkError("Create a wallet challenge before signing.", "CHALLENGE_MISSING");

  const address = normalizeAddress(input.address);
  if (address.toLowerCase() !== challenge.address.toLowerCase()) {
    throw new WalletLinkError("The signed wallet does not match the requested wallet.", "ADDRESS_MISMATCH");
  }
  if (!/^0x[0-9a-fA-F]+$/.test(input.signature) || input.signature.length > 512) {
    throw new WalletLinkError("Wallet signature is invalid.", "INVALID_SIGNATURE");
  }

  let valid = false;
  try {
    valid = await verifyMessage({ address, message: challenge.message, signature: input.signature as Hex });
  } catch {
    valid = false;
  }
  if (!valid) throw new WalletLinkError("Wallet signature verification failed.", "SIGNATURE_VERIFICATION_FAILED", 401);

  const link: WalletLink = {
    discordUserId: request.discordUserId,
    walletAddress: address,
    chainId: challenge.chainId,
    verifiedAt: new Date().toISOString()
  };
  await saveWalletLink(link);
  await storeDelete(requestKey(request.requestId));
  return { link, interactionToken: request.interactionToken };
}

export async function getWalletLink(discordUserId: string) {
  if (!DISCORD_USER_ID.test(discordUserId)) return null;
  const raw = await storeGet(userKey(discordUserId));
  if (!raw) return null;
  try {
    const link = JSON.parse(raw) as WalletLink;
    if (link.discordUserId !== discordUserId || !isAddress(link.walletAddress) || !Number.isSafeInteger(link.chainId)) return null;
    return link;
  } catch {
    return null;
  }
}

export async function disconnectWallet(discordUserId: string) {
  const existing = await getWalletLink(discordUserId);
  if (!existing) return null;
  await storeDelete(userKey(discordUserId), addressKey(existing.walletAddress));
  return existing;
}

export async function notifyDiscordWalletLinked(interactionToken: string, link: WalletLink) {
  const applicationId = process.env.DISCORD_APPLICATION_ID?.trim();
  if (!applicationId || !interactionToken) return false;

  const short = `${link.walletAddress.slice(0, 6)}…${link.walletAddress.slice(-4)}`;
  try {
    const response = await fetch(`https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `Wallet connected ✓ ${short} · chain ${link.chainId}. Horris verified ownership; no spending permission was granted.`,
        flags: 64,
        allowed_mentions: { parse: [] }
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000)
    });
    return response.ok;
  } catch {
    return false;
  }
}
