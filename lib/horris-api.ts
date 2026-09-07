import { isAddress } from "viem";

export type HorrisRisk = "Conservative" | "Balanced" | "Aggressive";
export type PerpSide = "long" | "short";

export type StrategyResponse = {
  proposal: {
    action: string;
    amount: number;
    assetIn: string;
    assetOut: string;
    protocol: string;
    risk: HorrisRisk;
    riskScore: number;
  };
  simulation: {
    passed: boolean;
    checks: Array<{ rule: string; passed: boolean; detail?: string }>;
  };
};

export type PerpAnalysisResponse = {
  venue: string;
  executionEnabled: false;
  analysis: {
    approved: boolean;
    notionalUsd: number;
    accountRiskPercent: number;
    stopDistancePercent: number;
    checks: Array<{ code: string; label: string; passed: boolean; detail: string }>;
    warnings: string[];
  };
};

export type Position = {
  market: string;
  side: "long" | "short";
  sizeUsd: string;
  collateralAmount: string;
  effectiveLeverage: number | null;
};

export type Order = {
  key: string;
  market: string;
  type: string;
  side: "long" | "short";
  sizeUsd: string;
  triggerPrice: string | null;
  acceptablePrice: string | null;
  isFrozen: boolean;
};

export type PositionsResponse = { positionCount: number; positions: Position[]; readOnly: true };
export type OrdersResponse = { orderCount: number; orders: Order[]; readOnly: true };

type FetchOptions = { method?: "GET" | "POST"; body?: string; timeoutMs?: number };

const MAX_CORE_RESPONSE_BYTES = 256 * 1024;
const MAX_CORE_ARRAY_ITEMS = 100;
const risks = new Set<HorrisRisk>(["Conservative", "Balanced", "Aggressive"]);

export class HorrisApiError extends Error {
  constructor(message: string, public readonly status = 502, public readonly code = "HORRIS_CORE_UNAVAILABLE") {
    super(message);
    this.name = "HorrisApiError";
  }
}

function isPrivateOrLocalHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host === "0:0:0:0:0:0:0:1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;

  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((value) => value < 0 || value > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

export function getHorrisApiBaseUrl() {
  const raw = (process.env.HORRIS_API_BASE_URL || "https://horris-delta.vercel.app").trim();
  const url = new URL(raw);
  const localDev = process.env.NODE_ENV !== "production" && url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");

  if (url.protocol !== "https:" && !localDev) throw new Error("HORRIS_API_BASE_URL must use HTTPS");
  if (url.username || url.password || url.search || url.hash) throw new Error("HORRIS_API_BASE_URL must be a plain origin");
  if (url.pathname !== "/" && url.pathname !== "") throw new Error("HORRIS_API_BASE_URL must not contain a path");
  if (!localDev && isPrivateOrLocalHostname(url.hostname)) throw new Error("HORRIS_API_BASE_URL cannot target a private or local host");
  return url.origin;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HorrisApiError(`${label} is invalid`, 502, "HORRIS_CORE_INVALID_RESPONSE");
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max = 200) {
  if (typeof value !== "string" || value.length === 0 || value.length > max) throw new HorrisApiError(`${label} is invalid`, 502, "HORRIS_CORE_INVALID_RESPONSE");
  return value;
}

function number(value: unknown, label: string, min = 0, max = 1e30) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new HorrisApiError(`${label} is invalid`, 502, "HORRIS_CORE_INVALID_RESPONSE");
  return value;
}

function integer(value: unknown, label: string, min = 0, max = 1_000_000) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new HorrisApiError(`${label} is invalid`, 502, "HORRIS_CORE_INVALID_RESPONSE");
  return value;
}

function bool(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new HorrisApiError(`${label} is invalid`, 502, "HORRIS_CORE_INVALID_RESPONSE");
  return value;
}

function decimalString(value: unknown, label: string) {
  const result = text(value, label, 120);
  const parsed = Number(result);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1e30) throw new HorrisApiError(`${label} is invalid`, 502, "HORRIS_CORE_INVALID_RESPONSE");
  return result;
}

function boundedArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length > MAX_CORE_ARRAY_ITEMS) throw new HorrisApiError(`${label} is invalid`, 502, "HORRIS_CORE_INVALID_RESPONSE");
  return value;
}

function validateStrategy(value: unknown): StrategyResponse {
  const root = record(value, "Horris strategy response");
  const proposal = record(root.proposal, "Horris strategy proposal");
  const simulation = record(root.simulation, "Horris strategy simulation");
  const risk = text(proposal.risk, "Horris strategy risk", 20) as HorrisRisk;
  if (!risks.has(risk)) throw new HorrisApiError("Horris strategy risk is invalid", 502, "HORRIS_CORE_INVALID_RESPONSE");

  const checks = boundedArray(simulation.checks, "Horris strategy checks").map((item) => {
    const check = record(item, "Horris strategy check");
    const detail = check.detail === undefined ? undefined : text(check.detail, "Horris strategy detail", 500);
    return { rule: text(check.rule, "Horris strategy rule", 100), passed: bool(check.passed, "Horris strategy check result"), ...(detail ? { detail } : {}) };
  });

  return {
    proposal: {
      action: text(proposal.action, "Horris strategy action", 80),
      amount: number(proposal.amount, "Horris strategy amount"),
      assetIn: text(proposal.assetIn, "Horris strategy asset", 40),
      assetOut: text(proposal.assetOut, "Horris strategy asset", 40),
      protocol: text(proposal.protocol, "Horris strategy protocol", 80),
      risk,
      riskScore: number(proposal.riskScore, "Horris strategy risk score", 0, 100)
    },
    simulation: { passed: bool(simulation.passed, "Horris strategy policy result"), checks }
  };
}

function validatePerp(value: unknown): PerpAnalysisResponse {
  const root = record(value, "Horris perp response");
  const analysis = record(root.analysis, "Horris perp analysis");
  if (root.executionEnabled !== false) throw new HorrisApiError("Horris Core execution boundary is invalid", 502, "HORRIS_CORE_INVALID_RESPONSE");

  const checks = boundedArray(analysis.checks, "Horris perp checks").map((item) => {
    const check = record(item, "Horris perp check");
    return {
      code: text(check.code, "Horris perp check code", 100),
      label: text(check.label, "Horris perp check label", 120),
      passed: bool(check.passed, "Horris perp check result"),
      detail: text(check.detail, "Horris perp check detail", 500)
    };
  });
  const warnings = boundedArray(analysis.warnings, "Horris perp warnings").slice(0, 20).map((warning) => text(warning, "Horris perp warning", 500));

  return {
    venue: text(root.venue, "Horris perp venue", 80),
    executionEnabled: false,
    analysis: {
      approved: bool(analysis.approved, "Horris perp approval"),
      notionalUsd: number(analysis.notionalUsd, "Horris perp notional"),
      accountRiskPercent: number(analysis.accountRiskPercent, "Horris perp account risk", 0, 100_000),
      stopDistancePercent: number(analysis.stopDistancePercent, "Horris perp stop distance", 0, 100_000),
      checks,
      warnings
    }
  };
}

function validatePositions(value: unknown): PositionsResponse {
  const root = record(value, "Horris positions response");
  if (root.readOnly !== true) throw new HorrisApiError("Horris Core read-only boundary is invalid", 502, "HORRIS_CORE_INVALID_RESPONSE");
  const positions = boundedArray(root.positions, "Horris positions").map((item): Position => {
    const position = record(item, "Horris position");
    const rawSide = position.side;
    if (rawSide !== "long" && rawSide !== "short") throw new HorrisApiError("Horris position side is invalid", 502, "HORRIS_CORE_INVALID_RESPONSE");
    const side: Position["side"] = rawSide;
    const leverage = position.effectiveLeverage === null ? null : number(position.effectiveLeverage, "Horris position leverage", 0, 100_000);
    return {
      market: text(position.market, "Horris position market", 120),
      side,
      sizeUsd: decimalString(position.sizeUsd, "Horris position size"),
      collateralAmount: decimalString(position.collateralAmount, "Horris position collateral"),
      effectiveLeverage: leverage
    };
  });
  return { positionCount: integer(root.positionCount, "Horris position count"), positions, readOnly: true };
}

function validateOrders(value: unknown): OrdersResponse {
  const root = record(value, "Horris orders response");
  if (root.readOnly !== true) throw new HorrisApiError("Horris Core read-only boundary is invalid", 502, "HORRIS_CORE_INVALID_RESPONSE");
  const orders = boundedArray(root.orders, "Horris orders").map((item): Order => {
    const order = record(item, "Horris order");
    const rawSide = order.side;
    if (rawSide !== "long" && rawSide !== "short") throw new HorrisApiError("Horris order side is invalid", 502, "HORRIS_CORE_INVALID_RESPONSE");
    const side: Order["side"] = rawSide;
    const nullableDecimal = (value: unknown, label: string) => value === null ? null : decimalString(value, label);
    return {
      key: text(order.key, "Horris order key", 160),
      market: text(order.market, "Horris order market", 120),
      type: text(order.type, "Horris order type", 100),
      side,
      sizeUsd: decimalString(order.sizeUsd, "Horris order size"),
      triggerPrice: nullableDecimal(order.triggerPrice, "Horris order trigger"),
      acceptablePrice: nullableDecimal(order.acceptablePrice, "Horris order acceptable price"),
      isFrozen: bool(order.isFrozen, "Horris order frozen state")
    };
  });
  return { orderCount: integer(root.orderCount, "Horris order count"), orders, readOnly: true };
}

async function readBoundedJson(response: Response) {
  const contentLength = Number(response.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_CORE_RESPONSE_BYTES) {
    throw new HorrisApiError("Horris Core response exceeded the safety limit", 502, "HORRIS_CORE_RESPONSE_TOO_LARGE");
  }

  if (!response.body) {
    const fallback = await response.text();
    if (Buffer.byteLength(fallback, "utf8") > MAX_CORE_RESPONSE_BYTES) throw new HorrisApiError("Horris Core response exceeded the safety limit", 502, "HORRIS_CORE_RESPONSE_TOO_LARGE");
    try { return JSON.parse(fallback) as unknown; }
    catch { throw new HorrisApiError("Horris Core returned invalid JSON", 502, "HORRIS_CORE_INVALID_RESPONSE"); }
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_CORE_RESPONSE_BYTES) {
        await reader.cancel();
        throw new HorrisApiError("Horris Core response exceeded the safety limit", 502, "HORRIS_CORE_RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(joined);
    return JSON.parse(decoded) as unknown;
  } catch (error) {
    if (error instanceof HorrisApiError) throw error;
    throw new HorrisApiError("Horris Core returned invalid JSON", 502, "HORRIS_CORE_INVALID_RESPONSE");
  }
}

function safeUpstreamMessage(status: number) {
  if (status === 400 || status === 422) return "Horris Core rejected the request.";
  if (status === 404) return "The required Horris Core route is unavailable.";
  if (status === 429) return "Horris Core is busy. Try again shortly.";
  if (status >= 500) return "Horris Core is temporarily unavailable.";
  return `Horris Core request failed (${status}).`;
}

async function horrisFetch(path: string, options: FetchOptions = {}) {
  if (!/^\/api\/[a-z0-9_\-/?=&%.]+$/i.test(path) || path.includes("..")) throw new HorrisApiError("Invalid Horris Core route", 500, "HORRIS_CORE_ROUTE_INVALID");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 2_500);
  try {
    const response = await fetch(`${getHorrisApiBaseUrl()}${path}`, {
      method: options.method || "GET",
      body: options.body,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {})
      },
      cache: "no-store",
      credentials: "omit",
      redirect: "error"
    });
    const data = await readBoundedJson(response);
    if (!response.ok) throw new HorrisApiError(safeUpstreamMessage(response.status), response.status, `HORRIS_CORE_HTTP_${response.status}`);
    return data;
  } catch (error) {
    if (error instanceof HorrisApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new HorrisApiError("Horris Core timed out. Try again.", 504, "HORRIS_CORE_TIMEOUT");
    throw new HorrisApiError("Horris Core is temporarily unavailable.", 502, "HORRIS_CORE_UNAVAILABLE");
  } finally {
    clearTimeout(timeout);
  }
}

export async function getCoreHealth() {
  const data = record(await horrisFetch("/api/health", { timeoutMs: 1_800 }), "Horris Core health response");
  if (data.service !== "horris") throw new HorrisApiError("Unexpected Horris Core identity", 502, "HORRIS_CORE_IDENTITY_MISMATCH");
  return data;
}

export async function getStableStrategy(amount: number, balance: number, risk: HorrisRisk) {
  const data = await horrisFetch("/api/strategy", {
    method: "POST",
    body: JSON.stringify({ amount, balance, risk })
  });
  return validateStrategy(data);
}

export async function analyzePerp(input: {
  market: string;
  side: PerpSide;
  risk: HorrisRisk;
  marginUsd: number;
  leverage: number;
  accountBalanceUsd: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit?: number;
}) {
  const data = await horrisFetch("/api/perps/analyze", {
    method: "POST",
    body: JSON.stringify(input)
  });
  return validatePerp(data);
}

export async function getPerpStatus(account: string) {
  if (!isAddress(account)) throw new HorrisApiError("A valid Celo wallet address is required.", 400, "INVALID_ACCOUNT");
  const encoded = encodeURIComponent(account);
  const [positionsRaw, ordersRaw] = await Promise.all([
    horrisFetch(`/api/perps/positions?account=${encoded}`, { timeoutMs: 2_500 }),
    horrisFetch(`/api/perps/orders?account=${encoded}`, { timeoutMs: 2_500 })
  ]);
  return { positions: validatePositions(positionsRaw), orders: validateOrders(ordersRaw) };
}
