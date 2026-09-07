import { describe, expect, it } from "vitest";
import { DISCORD_COMMANDS, formatPerpRisk, formatPerpStatus, formatStableRisk, formatStrategy } from "../lib/commands";
import { WALLET_DISCORD_COMMANDS } from "../lib/wallet-commands";

const strategy = {
  proposal: { action: "swap", amount: 100, assetIn: "USDC", assetOut: "USDm", protocol: "Mento", risk: "Balanced" as const, riskScore: 24 },
  simulation: { passed: true, checks: [{ rule: "MAX_AMOUNT", passed: true }] }
};

describe("Discord command surface", () => {
  it("ships direct planning, advisory and wallet commands", () => {
    expect(DISCORD_COMMANDS.map((command) => command.name)).toEqual(["trade", "help", "strategy", "risk", "perp-risk", "perp-status"]);
    expect(WALLET_DISCORD_COMMANDS.map((command) => command.name)).toEqual(["connect-wallet", "wallet", "disconnect-wallet"]);
  });

  it("lets /perp-status default to the verified linked wallet", () => {
    const command = DISCORD_COMMANDS.find((entry) => entry.name === "perp-status");
    expect(command && "options" in command ? command.options[0]?.required : undefined).toBe(false);
  });

  it("formats stable strategy and risk replies as non-executing", () => {
    expect(formatStrategy(strategy)).toContain("Policy: PASS");
    expect(formatStrategy(strategy)).toContain("no transaction submitted");
    expect(formatStableRisk(strategy)).toContain("POLICY PASS");
  });

  it("formats perp policy results without claiming execution", () => {
    const message = formatPerpRisk({ venue: "UpDown", executionEnabled: false, analysis: { approved: true, notionalUsd: 300, accountRiskPercent: 0.6, stopDistancePercent: 2, checks: [], warnings: [] } }, "BTC", "long");
    expect(message).toContain("PERP PASS");
    expect(message).toContain("no order submitted");
  });

  it("shows exact deterministic reasons for blocked perp proposals", () => {
    const message = formatPerpRisk({ venue: "UpDown", executionEnabled: false, analysis: { approved: false, notionalUsd: 0.02, accountRiskPercent: 10, stopDistancePercent: 5, checks: [{ code: "ACCOUNT_RISK", label: "Account risk", passed: false, detail: "10.00% projected account loss at stop · 1% cap" }], warnings: [] } }, "BTC", "long");
    expect(message).toContain("PERP BLOCK");
    expect(message).toContain("10.00% projected account loss at stop · 1% cap");
  });

  it("formats bounded live status summaries", () => {
    const message = formatPerpStatus({ positionCount: 1, readOnly: true, positions: [{ market: "BTC/USDT", side: "long", sizeUsd: "500", collateralAmount: "100", effectiveLeverage: 5 }] }, { orderCount: 1, readOnly: true, orders: [{ key: "0x1", market: "BTC/USDT", type: "StopLossDecrease", side: "long", sizeUsd: "500", triggerPrice: "98000", acceptablePrice: null, isFrozen: false }] });
    expect(message).toContain("1 open position");
    expect(message).toContain("1 open order");
    expect(message).toContain("Read-only status");
  });
});
