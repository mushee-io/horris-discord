import { describe, expect, it } from "vitest";
import { missingTradeFields, parseTradePrompt, summarizeParsedMessage } from "../lib/activity-trade";

describe("Horris Activity trade parser", () => {
  it("parses a compact long request", () => {
    const parsed = parseTradePrompt("Use $50 to long BTC conservatively at 100000 with 2x leverage", 1000);
    expect(parsed.market).toBe("BTC");
    expect(parsed.side).toBe("long");
    expect(parsed.risk).toBe("Conservative");
    expect(parsed.preferredMarginUsd).toBe(50);
    expect(parsed.preferredLeverage).toBe(2);
    expect(parsed.entryPrice).toBe(100000);
    expect(missingTradeFields(parsed)).toEqual([]);
  });

  it("normalizes UpDown market aliases and short intent", () => {
    const parsed = parseTradePrompt("short eth/usdt with 25 margin entry 4000", 500, "Aggressive");
    expect(parsed.market).toBe("ETH");
    expect(parsed.side).toBe("short");
    expect(parsed.risk).toBe("Aggressive");
  });

  it("allows a complete directional intent to resolve entry from the live UpDown oracle", () => {
    const parsed = parseTradePrompt("BTC looks bullish", 1000);
    expect(parsed.market).toBe("BTC");
    expect(parsed.side).toBe("long");
    expect(parsed.entryPrice).toBeUndefined();
    expect(missingTradeFields(parsed)).toEqual([]);

    const summary = summarizeParsedMessage("BTC looks bullish");
    expect(summary).toContain("live UpDown entry will be fetched");
    expect(summary).toContain("No order has been submitted");
    expect(summary).toContain("/trade");
  });
});
