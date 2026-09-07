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

type FetchOptions = RequestInit & { timeoutMs?: number };

export class HorrisApiError extends Error {
  constructor(message: string, public readonly status = 502) {
    super(message);
    this.name = "HorrisApiError";
  }
}

export function getHorrisApiBaseUrl() {
  const raw = (process.env.HORRIS_API_BASE_URL || "https://horris-delta.vercel.app").trim();
  const url = new URL(raw);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new Error("HORRIS_API_BASE_URL must use HTTPS in production");
  return url.origin;
}

async function horrisFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 1_900);
  try {
    const response = await fetch(`${getHorrisApiBaseUrl()}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      },
      cache: "no-store"
    });
    let data: unknown;
    try { data = await response.json(); }
    catch { throw new HorrisApiError("Horris Core returned an invalid response", 502); }

    if (!response.ok) {
      const safeMessage = data && typeof data === "object" && "error" in data && typeof (data as { error?: unknown }).error === "string"
        ? String((data as { error: string }).error).slice(0, 300)
        : `Horris Core request failed (${response.status})`;
      throw new HorrisApiError(safeMessage, response.status);
    }
    return data as T;
  } catch (error) {
    if (error instanceof HorrisApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new HorrisApiError("Horris Core timed out. Try again.", 504);
    throw new HorrisApiError("Horris Core is temporarily unavailable", 502);
  } finally {
    clearTimeout(timeout);
  }
}

export async function getCoreHealth() {
  return horrisFetch<Record<string, unknown>>("/api/health", { timeoutMs: 1_500 });
}

export async function getStableStrategy(amount: number, balance: number, risk: HorrisRisk) {
  return horrisFetch<StrategyResponse>("/api/strategy", {
    method: "POST",
    body: JSON.stringify({ amount, balance, risk })
  });
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
  return horrisFetch<PerpAnalysisResponse>("/api/perps/analyze", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getPerpStatus(account: string) {
  if (!isAddress(account)) throw new HorrisApiError("A valid Celo wallet address is required", 400);
  const encoded = encodeURIComponent(account);
  const [positions, orders] = await Promise.all([
    horrisFetch<PositionsResponse>(`/api/perps/positions?account=${encoded}`, { timeoutMs: 1_900 }),
    horrisFetch<OrdersResponse>(`/api/perps/orders?account=${encoded}`, { timeoutMs: 1_900 })
  ]);
  return { positions, orders };
}
