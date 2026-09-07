export type DisplayPolicyCheck = {
  code: string;
  label: string;
  passed: boolean;
  detail: string;
};

function clean(value: string, max: number) {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function formatPolicyDecision(input: {
  accepted: boolean;
  analysis: null | { approved: boolean; checks: DisplayPolicyCheck[] };
}) {
  const passed = input.accepted && input.analysis?.approved === true;
  if (passed) {
    return {
      verdict: "POLICY PASS",
      failedLines: [] as string[],
      passed: true,
    };
  }

  if (!input.analysis) {
    return {
      verdict: "POLICY BLOCK",
      failedLines: ["BLOCKED BY · Horris policy analysis was unavailable."],
      passed: false,
    };
  }

  const failed = input.analysis.checks.filter((check) => !check.passed);
  if (!failed.length) {
    return {
      verdict: "POLICY BLOCK",
      failedLines: ["BLOCKED BY · Horris policy rejected this plan."],
      passed: false,
    };
  }

  const visible = failed.slice(0, 4).map((check) => {
    const label = clean(check.label || check.code, 90) || "Policy rule";
    const detail = clean(check.detail, 220);
    return `BLOCKED BY · ${label}${detail ? ` — ${detail}` : ""}`;
  });

  if (failed.length > visible.length) {
    visible.push(`BLOCKED BY · +${failed.length - visible.length} additional failed policy rule${failed.length - visible.length === 1 ? "" : "s"}.`);
  }

  return {
    verdict: "POLICY BLOCK",
    failedLines: visible,
    passed: false,
  };
}
