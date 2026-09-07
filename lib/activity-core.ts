import { getHorrisApiBaseUrl, HorrisApiError, type HorrisRisk, type PerpSide } from "./horris-api";

export type ActivityAdvisorInput = {
  market: string;
  side: PerpSide;
  risk: HorrisRisk;
  accountBalanceUsd: number;
  entryPrice: number;
  preferredMarginUsd?: number;
  preferredLeverage?: number;
};

export type ActivityAdvisorResult = {
  proposal: {
    market: string;
    side: PerpSide;
    risk: HorrisRisk;
    marginUsd: number;
    leverage: number;
    accountBalanceUsd: number;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    rationale?: string;
  };
  review: {
    accepted: boolean;
    executable: false;
    malformed: string[];
    authority: "horris-policy";
    analysis: null | {
      approved: boolean;
      notionalUsd: number;
      accountRiskPercent: number;
      stopDistancePercent: number;
      rewardRisk?: number;
      checks: Array<{ code: string; label: string; passed: boolean; detail: string }>;
      warnings: string[];
    };
  };
  model: string;
  provider: "groq";
  executionEnabled: false;
};

function object(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HorrisApiError(`${label} is invalid`, 502, "HORRIS_CORE_INVALID_RESPONSE");
  return value as Record<string, unknown>;
}

function finite(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1_000_000_000) throw new HorrisApiError(`${label} is invalid`, 502, "HORRIS_CORE_INVALID_RESPONSE");
  return value;
}

function string(value: unknown, label: string, max = 2_000) {
  if (typeof value !== "string" || value.length === 0 || value.length > max) throw new HorrisApiError(`${label} is invalid`, 502, "HORRIS_CORE_INVALID_RESPONSE");
  return value;
}

function validateAdvisor(value: unknown, input: ActivityAdvisorInput): ActivityAdvisorResult {
  const root = object(value, "Horris advisor response");
  if (root.executionEnabled !== false) throw new HorrisApiError("Horris execution boundary is invalid", 502, "HORRIS_CORE_INVALID_RESPONSE");
  const proposal = object(root.proposal, "Horris advisor proposal");
  const review = object(root.review, "Horris advisor review");
  const side = proposal.side;
  const risk = proposal.risk;
  if (proposal.market !== input.market || side !== input.side || risk !== input.risk) throw new HorrisApiError("Horris advisor mutated immutable trade context", 502, "HORRIS_CORE_INVALID_RESPONSE");
  if (proposal.accountBalanceUsd !== input.accountBalanceUsd || proposal.entryPrice !== input.entryPrice) throw new HorrisApiError("Horris advisor mutated immutable numeric context", 502, "HORRIS_CORE_INVALID_RESPONSE");
  if (side !== "long" && side !== "short") throw new HorrisApiError("Horris advisor side is invalid", 502, "HORRIS_CORE_INVALID_RESPONSE");
  if (risk !== "Conservative" && risk !== "Balanced" && risk !== "Aggressive") throw new HorrisApiError("Horris advisor risk is invalid", 502, "HORRIS_CORE_INVALID_RESPONSE");
  if (review.executable !== false || review.authority !== "horris-policy") throw new HorrisApiError("Horris policy authority boundary is invalid", 502, "HORRIS_CORE_INVALID_RESPONSE");

  const analysisRaw = review.analysis === null ? null : object(review.analysis, "Horris advisor analysis");
  const analysis = analysisRaw ? {
    approved: analysisRaw.approved === true,
    notionalUsd: finite(analysisRaw.notionalUsd, "notional"),
    accountRiskPercent: finite(analysisRaw.accountRiskPercent, "account risk"),
    stopDistancePercent: finite(analysisRaw.stopDistancePercent, "stop distance"),
    ...(typeof analysisRaw.rewardRisk === "number" && Number.isFinite(analysisRaw.rewardRisk) ? { rewardRisk: analysisRaw.rewardRisk } : {}),
    checks: Array.isArray(analysisRaw.checks) ? analysisRaw.checks.slice(0, 20).map((item) => {
      const check = object(item, "Horris policy check");
      return { code: string(check.code, "check code", 100), label: string(check.label, "check label", 120), passed: check.passed === true, detail: string(check.detail, "check detail", 500) };
    }) : [],
    warnings: Array.isArray(analysisRaw.warnings) ? analysisRaw.warnings.slice(0, 10).filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 500)) : [],
  } : null;

  return {
    proposal: {
      market: input.market,
      side: input.side,
      risk: input.risk,
      marginUsd: finite(proposal.marginUsd, "margin"),
      leverage: finite(proposal.leverage, "leverage"),
      accountBalanceUsd: input.accountBalanceUsd,
      entryPrice: input.entryPrice,
      stopLoss: finite(proposal.stopLoss, "stop loss"),
      takeProfit: finite(proposal.takeProfit, "take profit"),
      ...(typeof proposal.rationale === "string" ? { rationale: proposal.rationale.slice(0, 2_000) } : {}),
    },
    review: {
      accepted: review.accepted === true,
      executable: false,
      malformed: Array.isArray(review.malformed) ? review.malformed.filter((item): item is string => typeof item === "string").slice(0, 20) : [],
      authority: "horris-policy",
      analysis,
    },
    model: string(root.model, "model", 128),
    provider: "groq",
    executionEnabled: false,
  };
}

export async function requestActivityAdvisor(input: ActivityAdvisorInput) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 24_000);
  try {
    const response = await fetch(`${getHorrisApiBaseUrl()}/api/perps/advisor`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    });
    const textBody = await response.text();
    if (textBody.length > 128_000) throw new HorrisApiError("Horris advisor response too large", 502, "HORRIS_CORE_INVALID_RESPONSE");
    let data: unknown;
    try { data = JSON.parse(textBody); } catch { throw new HorrisApiError("Horris advisor returned invalid JSON", 502, "HORRIS_CORE_INVALID_RESPONSE"); }
    if (!response.ok) {
      const root = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
      const code = typeof root.code === "string" ? root.code.slice(0, 80) : `HORRIS_CORE_HTTP_${response.status}`;
      throw new HorrisApiError(response.status === 429 ? "Horris AI is busy. Try again shortly." : "Horris AI is temporarily unavailable.", response.status, code);
    }
    return validateAdvisor(data, input);
  } catch (error) {
    if (error instanceof HorrisApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new HorrisApiError("Horris AI timed out", 504, "HORRIS_AI_TIMEOUT");
    throw new HorrisApiError("Horris AI is temporarily unavailable", 502, "HORRIS_AI_UNAVAILABLE");
  } finally {
    clearTimeout(timer);
  }
}
