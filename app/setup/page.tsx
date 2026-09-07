"use client";

import { useState } from "react";

type SetupResult = {
  ok?: boolean;
  code?: string;
  scope?: string;
  registered?: string[];
  registeredCount?: number;
  discordStatus?: number;
  missing?: string[];
};

export default function DiscordSetupPage() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SetupResult | null>(null);

  async function registerCommands() {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/register-commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store"
      });
      const data = await response.json() as SetupResult;
      setResult(data);
    } catch {
      setResult({ ok: false, code: "SETUP_REQUEST_FAILED" });
    } finally {
      setBusy(false);
    }
  }

  const success = result?.ok === true;

  return (
    <main style={{ minHeight: "100vh", background: "#0a0a0a", color: "#f5f2e9", padding: "48px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
      <div style={{ maxWidth: 820, margin: "0 auto", borderTop: "1px solid #444", borderBottom: "1px solid #444", padding: "32px 0" }}>
        <p style={{ fontSize: 11, letterSpacing: ".12em", color: "#888" }}>HORRIS / DISCORD SETUP</p>
        <h1 style={{ fontFamily: "Inter, Arial, sans-serif", fontSize: "clamp(48px, 8vw, 96px)", lineHeight: .9, margin: "20px 0 28px", letterSpacing: "-.06em" }}>REGISTER<br />COMMANDS</h1>
        <p style={{ maxWidth: 650, color: "#aaa", lineHeight: 1.6 }}>
          This registers the fixed Horris command set, including wallet verification commands, to the configured test server using credentials already stored in Vercel. No token or secret is shown in the browser.
        </p>

        <button
          type="button"
          onClick={registerCommands}
          disabled={busy}
          style={{
            marginTop: 28,
            border: "1px solid #f5f2e9",
            background: busy ? "#777" : "#f5f2e9",
            color: "#0a0a0a",
            padding: "14px 18px",
            font: "inherit",
            cursor: busy ? "wait" : "pointer"
          }}
        >
          {busy ? "REGISTERING…" : "REGISTER HORRIS COMMANDS →"}
        </button>

        {result && (
          <div style={{ marginTop: 28, borderTop: "1px solid #333", paddingTop: 22 }}>
            <p style={{ fontSize: 11, letterSpacing: ".12em", color: success ? "#f5f2e9" : "#aaa" }}>
              {success ? "REGISTRATION COMPLETE" : "REGISTRATION FAILED"}
            </p>
            {success ? (
              <>
                <p style={{ fontSize: 28, margin: "12px 0" }}>{result.registeredCount ?? result.registered?.length ?? 0} COMMANDS REGISTERED</p>
                <p style={{ color: "#aaa", lineHeight: 1.7 }}>{result.registered?.join(" · ")}</p>
                <p style={{ marginTop: 18, color: "#f5f2e9" }}>Refresh Discord, type /, then run /help first.</p>
              </>
            ) : (
              <>
                <p style={{ fontSize: 24, margin: "12px 0" }}>{result.code || "UNKNOWN_ERROR"}</p>
                {typeof result.discordStatus === "number" && <p style={{ color: "#aaa" }}>Discord API status: {result.discordStatus}</p>}
                {result.missing?.length ? <p style={{ color: "#aaa" }}>Missing: {result.missing.join(", ")}</p> : null}
              </>
            )}
          </div>
        )}

        <p style={{ marginTop: 22, fontSize: 11, color: "#666" }}>Expected: /trade · /help · /connect-wallet · /wallet · /disconnect-wallet · /strategy · /risk · /perp-risk · /perp-status · Analyze with Horris</p>
      </div>
    </main>
  );
}
