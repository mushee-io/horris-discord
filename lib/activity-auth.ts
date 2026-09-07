import { createHash } from "node:crypto";

const MAX_TOKEN_LENGTH = 2_048;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE = 2_000;
const identityCache = new Map<string, { userId: string; expiresAt: number }>();

function prune(now: number) {
  for (const [key, value] of identityCache) if (value.expiresAt <= now) identityCache.delete(key);
  while (identityCache.size >= MAX_CACHE) {
    const first = identityCache.keys().next().value as string | undefined;
    if (!first) break;
    identityCache.delete(first);
  }
}

function tokenFromHeader(value: string | null) {
  if (!value?.startsWith("Bearer ")) return undefined;
  const token = value.slice(7).trim();
  if (!token || token.length > MAX_TOKEN_LENGTH || /[\r\n\0]/.test(token)) return undefined;
  return token;
}

export class ActivityAuthError extends Error {
  constructor(message = "Discord Activity authentication required", public readonly status = 401) {
    super(message);
    this.name = "ActivityAuthError";
  }
}

export async function verifyActivityIdentity(authorization: string | null) {
  const token = tokenFromHeader(authorization);
  if (!token) throw new ActivityAuthError();

  const key = createHash("sha256").update(token).digest("hex");
  const now = Date.now();
  prune(now);
  const cached = identityCache.get(key);
  if (cached && cached.expiresAt > now) return { userId: cached.userId };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_500);
  try {
    const response = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) throw new ActivityAuthError("Discord Activity session expired", 401);
    const data = await response.json() as { id?: unknown };
    if (typeof data.id !== "string" || !/^\d{16,20}$/.test(data.id)) throw new ActivityAuthError("Discord identity verification failed", 401);
    identityCache.set(key, { userId: data.id, expiresAt: now + CACHE_TTL_MS });
    return { userId: data.id };
  } catch (error) {
    if (error instanceof ActivityAuthError) throw error;
    throw new ActivityAuthError("Discord identity verification unavailable", 503);
  } finally {
    clearTimeout(timer);
  }
}
