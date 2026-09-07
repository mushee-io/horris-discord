import { isAddress } from "viem";
import {
  analyzePerp,
  getPerpStatus,
  getStableStrategy,
  HorrisApiError,
  type HorrisRisk,
  type OrdersResponse,
  type PerpAnalysisResponse,
  type PerpSide,
  type PositionsResponse,
  type StrategyResponse
} from "./horris-api";

export const HORRIS_RISKS = ["Conservative", "Balanced", "Aggressive"] as const;
export const HORRIS_MARKETS = ["BTC", "ETH", "CELO", "EURm", "JPYm", "NGNm", "AUDm", "GBPm"] as const;

export const COMMAND_LIMITS = {
  stableAmount: 1_000_000_000_000,
  accountBalance: 1_000_000_000_000_000,
  margin: 1_000_000_000_000,
  leverage: 100,
  price: 1_000_000_000_000
} as const;

const riskChoices = HORRIS_RISKS.map((name) => ({ name, value: name }));
const marketChoices = HORRIS_MARKETS.map((name) => ({ name, value: name }));

export const DISCORD_COMMANDS = [
  {
    name: "help",
    description: "Show Horris commands and safety boundary"
  },
  {
    name: "strategy",
    description: "Ask Horris Core for a stable strategy",
    options: [
      { name: "amount", description: "USDC amount", type: 10, required: true, min_value: 0.000001, max_value: COMMAND_LIMITS.stableAmount },
      { name: "balance", description: "Available USDC balance", type: 10, required: true, min_value: 0, max_value: COMMAND_LIMITS.accountBalance },
      { name: "risk", description: "Horris risk profile", type: 3, required: true, choices: riskChoices }
    ]
  },
  {
    name: "risk",
    description: "Run Horris deterministic risk policy",
    options: [
      { name: "amount", description: "USDC amount", type: 10, required: true, min_value: 0.000001, max_value: COMMAND_LIMITS.stableAmount },
      { name: "balance", description: "Available USDC balance", type: 10, required: true, min_value: 0, max_value: COMMAND_LIMITS.accountBalance },
      { name: "risk", description: "Horris risk profile", type: 3, required: true, choices: riskChoices }
    ]
  },
  {
    name: "perp-risk",
    description: "Analyze a perp proposal through Horris policy",
    options: [
      { name: "market", description: "UpDown market", type: 3, required: true, choices: marketChoices },
      { name: "side", description: "Trade side", type: 3, required: true, choices: [{ name: "Long", value: "long" }, { name: "Short", value: "short" }] },
      { name: "balance", description: "Account balance in USD", type: 10, required: true, min_value: 0.000001, max_value: COMMAND_LIMITS.accountBalance },
      { name: "margin", description: "Margin in USD", type: 10, required: true, min_value: 0.000001, max_value: COMMAND_LIMITS.margin },
      { name: "leverage", description: "Requested leverage", type: 10, required: true, min_value: 0.01, max_value: COMMAND_LIMITS.leverage },
      { name: "entry", description: "Entry price", type: 10, required: true, min_value: 0.000001, max_value: COMMAND_LIMITS.price },
      { name: "stop", description: "Stop-loss price", type: 10, required: true, min_value: 0.000001, max_value: COMMAND_LIMITS.price },
      { name: "take_profit", description: "Optional take-profit price", type: 10, required: false, min_value: 0.000001, max_value: COMMAND_LIMITS.price },
      { name: "risk", description: "Horris risk profile", type: 3, required: true, choices: riskChoices }
    ]
  },
  {
    name: "perp-status",
    description: "Read live UpDown positions and orders for a Celo wallet",
    options: [
      { name: "account", description: "Celo wallet address", type: 3, required: true, min_length: 42, max_length: 42 }
    ]
  }
] as const;

export class DiscordInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscordInputError";
  }
}

function bounded(value: unknown, label: string, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new DiscordInputError(`${label} must be between ${min} and ${max}.`);
  }
  return parsed;
}

function positive(value: unknown, label: string, max: number) {
  return bounded(value, label, Number.MIN_VALUE, max);
}

function nonNegative(value: unknown, label: string, max: number) {
  return bounded(value, label, 0, max);
}

function risk(value: unknown): HorrisRisk {
  if (typeof value !== "string" || !(HORRIS_RISKS as readonly string[]).includes(value)) throw new DiscordInputError("Risk must be Conservative, Balanced, or Aggressive.");
  return value as HorrisRisk;
}

function side(value: unknown): PerpSide {
  if (value !== "long" && value !== "short") throw new DiscordInputError("Side must be long or short.");
  return value;
}

function market(value: unknown) {
  if (typeof value !== "string" || !(HORRIS_MARKETS as readonly string[]).includes(value)) throw new DiscordInputError("Choose a supported UpDown market.");
  return value;
}

export function discordSafeErrorMessage(error: unknown) {
  if (error instanceof DiscordInputError) return error.message;
  if (error instanceof HorrisApiError) {
    if (error.code === "INVALID_ACCOUNT") return error.message;
    if (error.code === "HORRIS_CORE_TIMEOUT") return "Horris Core timed out. Try again.";
    if (error.code === "HORRIS_CORE_HTTP_429") return "Horris Core is busy. Try again shortly.";
    if (error.code.startsWith("HORRIS_CORE_HTTP_4")) return "Horris Core rejected this request.";
    return "Horris Core is temporarily unavailable. No transaction was submitted.";
  }
  return "Horris command failed safely. No transaction was submitted.";
}

export function formatStrategy(data: StrategyResponse) {
  const proposal = data.proposal;
  return `Horris STRATEGY · ${proposal.action.toUpperCase()} ${proposal.amount} ${proposal.assetIn} → ${proposal.assetOut} via ${proposal.protocol}. Risk ${proposal.riskScore}/100 · ${proposal.risk}. Policy: ${data.simulation.passed ? "PASS" : "BLOCK"}. Analysis only; no transaction submitted.`;
}

export function formatStableRisk(data: StrategyResponse) {
  if (data.simulation.passed) return `Horris POLICY PASS · ${data.proposal.amount} ${data.proposal.assetIn} · ${data.proposal.risk} · risk score ${data.proposal.riskScore}/100. No transaction submitted.`;
  const failed = data.simulation.checks.filter((check) => !check.passed).map((check) => check.rule).join(", ");
  return `Horris POLICY BLOCK · failed: ${failed || "policy"}. No transaction submitted.`;
}

export function formatPerpRisk(data: PerpAnalysisResponse, requestedMarket: string, requestedSide: PerpSide) {
  const analysis = data.analysis;
  if (analysis.approved) {
    return `Horris PERP PASS · ${requestedMarket.toUpperCase()} ${requestedSide.toUpperCase()} · $${analysis.notionalUsd.toFixed(2)} notional · ${analysis.accountRiskPercent.toFixed(2)}% account risk · ${analysis.stopDistancePercent.toFixed(2)}% stop distance. Analysis only; no order submitted.`;
  }
  const failed = analysis.checks.filter((check) => !check.passed).map((check) => check.label).join(", ");
  return `Horris PERP BLOCK · ${requestedMarket.toUpperCase()} ${requestedSide.toUpperCase()} · failed: ${failed || "policy"}. Analysis only; no order submitted.`;
}

export function formatPerpStatus(positions: PositionsResponse, orders: OrdersResponse) {
  const lines: string[] = [`Horris UPDOWN STATUS · ${positions.positionCount} open position${positions.positionCount === 1 ? "" : "s"} · ${orders.orderCount} open order${orders.orderCount === 1 ? "" : "s"}.`];

  for (const position of positions.positions.slice(0, 4)) {
    const leverage = position.effectiveLeverage === null ? "n/a" : `${position.effectiveLeverage.toFixed(2)}x`;
    lines.push(`POSITION · ${position.market} ${position.side.toUpperCase()} · $${Number(position.sizeUsd).toFixed(2)} size · ${leverage}`);
  }
  for (const order of orders.orders.slice(0, 4)) {
    const trigger = order.triggerPrice ? ` · trigger ${order.triggerPrice}` : "";
    lines.push(`ORDER · ${order.market} ${order.side.toUpperCase()} · ${order.type} · $${Number(order.sizeUsd).toFixed(2)}${trigger}${order.isFrozen ? " · FROZEN" : ""}`);
  }
  if (positions.positionCount > 4 || orders.orderCount > 4) lines.push("Showing the first 4 positions and first 4 orders.");
  lines.push("Read-only status; Discord cannot sign or execute trades.");
  return lines.join("\n");
}

export async function executeDiscordCommand(name: unknown, options: Record<string, unknown>) {
  if (name === "help") {
    return "Horris commands: /strategy, /risk, /perp-risk, /perp-status. Discord is read-only/advisory; Horris Core remains the policy authority and Discord cannot sign or submit transactions.";
  }

  if (name === "strategy" || name === "risk") {
    const amount = positive(options.amount, "Amount", COMMAND_LIMITS.stableAmount);
    const balance = nonNegative(options.balance, "Balance", COMMAND_LIMITS.accountBalance);
    const profile = risk(options.risk);
    const data = await getStableStrategy(amount, balance, profile);
    return name === "strategy" ? formatStrategy(data) : formatStableRisk(data);
  }

  if (name === "perp-risk") {
    const requestedMarket = market(options.market);
    const requestedSide = side(options.side);
    const profile = risk(options.risk);
    const takeProfit = options.take_profit === undefined ? undefined : positive(options.take_profit, "Take profit", COMMAND_LIMITS.price);
    const data = await analyzePerp({
      market: requestedMarket,
      side: requestedSide,
      risk: profile,
      accountBalanceUsd: positive(options.balance, "Balance", COMMAND_LIMITS.accountBalance),
      marginUsd: positive(options.margin, "Margin", COMMAND_LIMITS.margin),
      leverage: positive(options.leverage, "Leverage", COMMAND_LIMITS.leverage),
      entryPrice: positive(options.entry, "Entry", COMMAND_LIMITS.price),
      stopLoss: positive(options.stop, "Stop", COMMAND_LIMITS.price),
      takeProfit
    });
    return formatPerpRisk(data, requestedMarket, requestedSide);
  }

  if (name === "perp-status") {
    const account = String(options.account || "");
    if (!isAddress(account)) throw new DiscordInputError("A valid Celo wallet address is required.");
    const { positions, orders } = await getPerpStatus(account);
    return formatPerpStatus(positions, orders);
  }

  throw new DiscordInputError("Unknown Horris command.");
}
