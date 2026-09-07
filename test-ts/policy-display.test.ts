import { describe, expect, it } from "vitest";
import { formatPolicyDecision } from "../lib/policy-display";

describe("Discord policy decision display", () => {
  it("shows exact failed Horris policy details", () => {
    const result = formatPolicyDecision({
      accepted: false,
      analysis: {
        approved: false,
        checks: [
          { code: "LEVERAGE_CAP", label: "Leverage cap", passed: true, detail: "2.00x requested · 3x Horris cap" },
          { code: "ACCOUNT_RISK", label: "Account risk", passed: false, detail: "10.00% projected account loss at stop · 1% cap" },
          { code: "MARGIN_UTILIZATION", label: "Margin utilization", passed: false, detail: "100.00% of account margin · 20% cap" },
        ],
      },
    });

    expect(result.verdict).toBe("POLICY BLOCK");
    expect(result.failedLines).toEqual([
      "BLOCKED BY · Account risk — 10.00% projected account loss at stop · 1% cap",
      "BLOCKED BY · Margin utilization — 100.00% of account margin · 20% cap",
    ]);
  });

  it("does not invent a reason when policy passes", () => {
    const result = formatPolicyDecision({
      accepted: true,
      analysis: { approved: true, checks: [] },
    });

    expect(result.verdict).toBe("POLICY PASS");
    expect(result.failedLines).toEqual([]);
  });
});
