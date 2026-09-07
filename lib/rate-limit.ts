const USER_WINDOW_MS = 60_000;
const USER_LIMIT = 20;
const GLOBAL_WINDOW_MS = 60_000;
const GLOBAL_LIMIT = 300;
const MAX_BUCKETS = 10_000;

const buckets = new Map<string, { count: number; resetAt: number }>();

function consume(key: string, limit: number, windowMs: number, nowMs: number) {
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= nowMs) {
    bucket = { count: 0, resetAt: nowMs + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return { allowed: bucket.count <= limit, retryAfterMs: Math.max(0, bucket.resetAt - nowMs) };
}

function prune(nowMs: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= nowMs) buckets.delete(key);
  }
  while (buckets.size > MAX_BUCKETS) {
    const oldest = buckets.keys().next().value as string | undefined;
    if (!oldest) break;
    buckets.delete(oldest);
  }
}

export function discordActorId(interaction: Record<string, unknown>) {
  const directUser = interaction.user;
  if (directUser && typeof directUser === "object" && !Array.isArray(directUser)) {
    const id = (directUser as Record<string, unknown>).id;
    if (typeof id === "string" && /^\d{16,20}$/.test(id)) return id;
  }

  const member = interaction.member;
  if (member && typeof member === "object" && !Array.isArray(member)) {
    const user = (member as Record<string, unknown>).user;
    if (user && typeof user === "object" && !Array.isArray(user)) {
      const id = (user as Record<string, unknown>).id;
      if (typeof id === "string" && /^\d{16,20}$/.test(id)) return id;
    }
  }
  return null;
}

export function consumeDiscordRateLimit(actorId: string | null, nowMs = Date.now()) {
  if (!Number.isFinite(nowMs) || nowMs <= 0) return { allowed: false, retryAfterMs: USER_WINDOW_MS };
  prune(nowMs);

  const globalResult = consume("global", GLOBAL_LIMIT, GLOBAL_WINDOW_MS, nowMs);
  if (!globalResult.allowed) return globalResult;
  if (!actorId) return globalResult;
  return consume(`user:${actorId}`, USER_LIMIT, USER_WINDOW_MS, nowMs);
}
