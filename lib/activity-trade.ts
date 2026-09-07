import type { HorrisRisk, PerpSide } from "./horris-api";

export const ACTIVITY_MARKETS = ["BTC", "ETH", "CELO", "EURm", "JPYm", "NGNm", "AUDm", "GBPm"] as const;

export type ParsedTradePrompt = {
  market?: string;
  side?: PerpSide;
  risk: HorrisRisk;
  accountBalanceUsd: number;
  entryPrice?: number;
  preferredMarginUsd?: number;
  preferredLeverage?: number;
};

function compactNumber(raw: string) {
  const match = /^([0-9]+(?:\.[0-9]+)?)([km])?$/i.exec(raw.replace(/,/g, ""));
  if (!match) return undefined;
  const base = Number(match[1]);
  if (!Number.isFinite(base) || base <= 0) return undefined;
  const multiplier = match[2]?.toLowerCase() === "k" ? 1_000 : match[2]?.toLowerCase() === "m" ? 1_000_000 : 1;
  const value = base * multiplier;
  return Number.isFinite(value) && value <= 1_000_000_000 ? value : undefined;
}

function firstNumber(prompt: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = pattern.exec(prompt);
    const value = match?.[1] ? compactNumber(match[1]) : undefined;
    if (value !== undefined) return value;
  }
  return undefined;
}

function parseMarket(prompt: string) {
  const normalized = prompt.toUpperCase();
  for (const market of ACTIVITY_MARKETS) {
    const upper = market.toUpperCase();
    if (new RegExp(`(^|[^A-Z0-9])${upper.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[/_-]?(?:USDT|USD|PERP))?([^A-Z0-9]|$)`, "i").test(normalized)) return market;
  }
  return undefined;
}

function parseSide(prompt: string): PerpSide | undefined {
  if (/\b(long|buy|bullish)\b/i.test(prompt)) return "long";
  if (/\b(short|sell|bearish)\b/i.test(prompt)) return "short";
  return undefined;
}

function parseRisk(prompt: string, override?: HorrisRisk): HorrisRisk {
  if (override) return override;
  if (/\b(conservative|conservatively|safe|safely|low[ -]?risk)\b/i.test(prompt)) return "Conservative";
  if (/\b(aggressive|aggressively|degen|high[ -]?risk)\b/i.test(prompt)) return "Aggressive";
  return "Balanced";
}

export function parseTradePrompt(prompt: string, accountBalanceUsd: number, riskOverride?: HorrisRisk): ParsedTradePrompt {
  const clean = String(prompt).trim().slice(0, 1_000);
  const safeBalance = Number.isFinite(accountBalanceUsd) && accountBalanceUsd > 0 && accountBalanceUsd <= 1_000_000_000 ? accountBalanceUsd : 1_000;

  const preferredLeverage = firstNumber(clean, [/\b([0-9]+(?:\.[0-9]+)?)\s*x\b/i, /\bleverage\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)/i]);
  const preferredMarginUsd = firstNumber(clean, [
    /\b(?:use|with|margin|risking|put)\s*(?:\$|usd|usdc)?\s*([0-9]+(?:\.[0-9]+)?[km]?)/i,
    /\b(?:margin|size)\s*[:=]\s*(?:\$|usd|usdc)?\s*([0-9]+(?:\.[0-9]+)?[km]?)/i,
  ]);
  const entryPrice = firstNumber(clean, [
    /\b(?:entry|entry price|price)\s*[:=@]?\s*\$?\s*([0-9]+(?:\.[0-9]+)?[km]?)/i,
    /\bat\s+\$?\s*([0-9]+(?:\.[0-9]+)?[km]?)(?!\s*x\b)/i,
  ]);

  return {
    market: parseMarket(clean),
    side: parseSide(clean),
    risk: parseRisk(clean, riskOverride),
    accountBalanceUsd: safeBalance,
    entryPrice,
    preferredMarginUsd,
    preferredLeverage,
  };
}

export function missingTradeFields(parsed: ParsedTradePrompt) {
  const missing: string[] = [];
  if (!parsed.market) missing.push("market");
  if (!parsed.side) missing.push("side");
  if (!parsed.entryPrice) missing.push("entry price");
  return missing;
}

export function summarizeParsedMessage(prompt: string) {
  const parsed = parseTradePrompt(prompt, 1_000);
  const parts = [parsed.market, parsed.side?.toUpperCase(), parsed.preferredMarginUsd ? `$${parsed.preferredMarginUsd} margin` : undefined, parsed.preferredLeverage ? `${parsed.preferredLeverage}x` : undefined, parsed.risk].filter(Boolean);
  const missing = missingTradeFields(parsed);
  if (missing.length) return `Horris found: ${parts.join(" · ") || "no complete trade intent"}. Missing ${missing.join(", ")}. Open /trade for AI planning and deterministic risk checks.`;
  return `Horris found: ${parts.join(" · ")} · entry ${parsed.entryPrice}. Open /trade to generate the AI proposal and run Horris policy. No order has been submitted.`;
}
