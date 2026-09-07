import { NextRequest, NextResponse } from "next/server";
import { ActivityAuthError, verifyActivityIdentity } from "../../../../lib/activity-auth";
import { requestActivityAdvisor } from "../../../../lib/activity-core";
import { missingTradeFields, parseTradePrompt } from "../../../../lib/activity-trade";
import { getMarketPrice, HorrisApiError, type HorrisRisk } from "../../../../lib/horris-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const risks = new Set<HorrisRisk>(["Conservative", "Balanced", "Aggressive"]);
const buckets = new Map<string, { count: number; resetAt: number }>();

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" } });
}

function consume(userId: string) {
  const now = Date.now();
  const existing = buckets.get(userId);
  const bucket = !existing || existing.resetAt <= now ? { count: 0, resetAt: now + 60_000 } : existing;
  bucket.count += 1;
  buckets.set(userId, bucket);
  return { allowed: bucket.count <= 8, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)) };
}

export async function POST(request: NextRequest) {
  try {
    const identity = await verifyActivityIdentity(request.headers.get("authorization"));
    const rate = consume(identity.userId);
    if (!rate.allowed) return json({ error: "AI planning limit reached. Try again shortly.", retryAfter: rate.retryAfter, executionEnabled: false }, 429);

    const length = Number(request.headers.get("content-length") || "0");
    if (Number.isFinite(length) && length > 8_192) return json({ error: "Request too large.", executionEnabled: false }, 413);
    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: "Invalid request.", executionEnabled: false }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid request.", executionEnabled: false }, 400);
    const input = body as Record<string, unknown>;
    const prompt = typeof input.prompt === "string" ? input.prompt.trim().slice(0, 1_000) : "";
    const accountBalanceUsd = Number(input.accountBalanceUsd);
    const riskOverride = typeof input.risk === "string" && risks.has(input.risk as HorrisRisk) ? input.risk as HorrisRisk : undefined;
    if (!prompt) return json({ error: "Tell Horris what trade you want to plan.", executionEnabled: false }, 400);
    if (!Number.isFinite(accountBalanceUsd) || accountBalanceUsd <= 0 || accountBalanceUsd > 1_000_000_000) return json({ error: "Planning balance must be a positive number.", executionEnabled: false }, 400);

    const parsed = parseTradePrompt(prompt, accountBalanceUsd, riskOverride);
    const missing = missingTradeFields(parsed);
    if (missing.length) return json({ ready: false, parsed, missing, executionEnabled: false, message: `Add ${missing.join(", ")} to the prompt.` });

    let entryPrice = parsed.entryPrice;
    let priceSource: "prompt" | "live-updown-oracle" = "prompt";
    let livePriceAgeSeconds: number | undefined;
    if (!entryPrice) {
      const livePrice = await getMarketPrice(parsed.market!);
      entryPrice = Number(livePrice.price.mid);
      if (!Number.isFinite(entryPrice) || entryPrice <= 0) throw new HorrisApiError("Live UpDown entry price is invalid", 502, "HORRIS_CORE_INVALID_RESPONSE");
      priceSource = "live-updown-oracle";
      livePriceAgeSeconds = livePrice.price.ageSeconds;
    }

    const resolvedParsed = { ...parsed, entryPrice };
    const result = await requestActivityAdvisor({
      market: parsed.market!,
      side: parsed.side!,
      risk: parsed.risk,
      accountBalanceUsd: parsed.accountBalanceUsd,
      entryPrice,
      preferredMarginUsd: parsed.preferredMarginUsd,
      preferredLeverage: parsed.preferredLeverage,
    });

    return json({
      ready: true,
      parsed: resolvedParsed,
      priceSource,
      livePriceAgeSeconds,
      ...result,
      executionEnabled: false,
      nextStep: result.review.accepted ? "Review in Horris Terminal and approve with your wallet." : "Horris policy blocked this proposal. Adjust the plan before wallet review."
    });
  } catch (error) {
    if (error instanceof ActivityAuthError) return json({ error: error.message, executionEnabled: false }, error.status);
    if (error instanceof HorrisApiError) return json({ error: error.message, code: error.code, executionEnabled: false }, error.status >= 400 && error.status < 600 ? error.status : 502);
    return json({ error: "Horris trade planning failed safely.", executionEnabled: false }, 502);
  }
}
