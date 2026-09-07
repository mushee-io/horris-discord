import { describe, expect, it } from "vitest";
import { DISCORD_COMMANDS, formatPerpRisk, formatPerpStatus, formatStableRisk, formatStrategy } from "../lib/commands";

const strategy = {
  proposal: { action: "swap", amount: 100, assetIn: "USDC", assetOut: "USDm", protocol: "Mento", risk: "Balanced" as const, riskScore: 24 },
  simulation: { passed: true, checks: [{ rule: "MAX_AMOUNT", passed: true }] }
};

describe("Discord command surface", () => {
  it("ships only the intended Horris command set", () => {
    expect(DISCORD_COMMANDS.map((command) => command.name)).toEqual(["help", "strategy", "risk", "perp-risk", "perp-status"]);
  });

  it("formats stable strategy and risk replies as non-executing", () => {
    expect(formatStrategy(strategy)).toContain("Policy: PASS");
    expect(formatStrategy(strategy)).toContain("no transaction submitted");
    expect(formatStableRisk(strategy)).toContain("POLICY PASS");
  });

  it("formats perp policy results without claiming execution", () => {
    const message = formatPerpRisk({
      venue: "UpDown",
      executionEnabled: false,
      analysis: {
        approved: true,
        notionalUsd: 300,
        accountRiskPercent: 0.6,
        stopDistancePercent: 2,
        checks: [],
        warnings: []
      }
    }, "BTC", "long");
    expect(message).toContain("PERP PASS");
    expect(message).toContain("no order submitted");
  });

  it("formats bounded live status summaries", () => {
    const message = formatPerpStatus({
      positionCount: 1,
      readOnly: true,
      positions: [{ market: "BTC/USDT", side: "long", sizeUsd: "500", collateralAmount: "100", effectiveLeverage: 5 }]
    }, {
      orderCount: 1,
      readOnly: true,
      orders: [{ key: "0x1", market: "BTC/USDT", type: "StopLossDecrease", side: "long", sizeUsd: "500", triggerPrice: "98000", acceptablePrice: null, isFrozen: false }]
    });
    expect(message).toContain("1 open position");
    expect(message).toContain("1 open order");
    expect(message).toContain("Read-only status");
  });
});
