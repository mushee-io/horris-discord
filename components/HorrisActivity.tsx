"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DiscordSDK } from "@discord/embedded-app-sdk";

type Risk = "Conservative" | "Balanced" | "Aggressive";
type Tab = "trade" | "positions" | "risk";
type ComposeResult = {
  ready?: boolean;
  error?: string;
  message?: string;
  missing?: string[];
  parsed?: { market?: string; side?: "long" | "short"; risk?: Risk; entryPrice?: number; preferredMarginUsd?: number; preferredLeverage?: number };
  model?: string;
  proposal?: { market: string; side: "long" | "short"; risk: Risk; marginUsd: number; leverage: number; accountBalanceUsd: number; entryPrice: number; stopLoss: number; takeProfit: number; rationale?: string };
  review?: { accepted: boolean; executable: false; authority: "horris-policy"; malformed: string[]; analysis: null | { approved: boolean; notionalUsd: number; accountRiskPercent: number; stopDistancePercent: number; rewardRisk?: number; checks: Array<{ code: string; label: string; passed: boolean; detail: string }>; warnings: string[] } };
  nextStep?: string;
  executionEnabled?: false;
};
type StatusResult = {
  error?: string;
  positions?: { positionCount: number; positions: Array<{ market: string; side: "long" | "short"; sizeUsd: string; collateralAmount: string; effectiveLeverage: number | null }> };
  orders?: { orderCount: number; orders: Array<{ key: string; market: string; type: string; side: "long" | "short"; sizeUsd: string; triggerPrice: string | null; acceptablePrice: string | null; isFrozen: boolean }> };
};
type DiscordUser = { id: string; username: string; global_name?: string | null; avatar?: string | null };

const riskCopy: Record<Risk, { label: string; line: string; index: string }> = {
  Conservative: { label: "SAFE", line: "Lower leverage · tighter account-risk limits", index: "01" },
  Balanced: { label: "BALANCED", line: "Moderate leverage · balanced risk budget", index: "02" },
  Aggressive: { label: "DEGEN", line: "Higher limits · deterministic caps still apply", index: "03" },
};

const riskValues: Risk[] = ["Conservative", "Balanced", "Aggressive"];

export default function HorrisActivity({ clientId, terminalUrl }: { clientId: string; terminalUrl: string }) {
  const sdkRef = useRef<DiscordSDK | null>(null);
  const [tab, setTab] = useState<Tab>("trade");
  const [authState, setAuthState] = useState<"loading" | "ready" | "preview" | "error">("loading");
  const [authError, setAuthError] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [user, setUser] = useState<DiscordUser | null>(null);
  const [risk, setRisk] = useState<Risk>("Balanced");
  const [balance, setBalance] = useState("1000");
  const [prompt, setPrompt] = useState("Long BTC with $50 safely");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ComposeResult | null>(null);
  const [wallet, setWallet] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);
  const [status, setStatus] = useState<StatusResult | null>(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    const stored = window.localStorage.getItem("horris:wallet");
    if (stored) setWallet(stored);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      if (!clientId || window.self === window.top) {
        if (!cancelled) setAuthState("preview");
        return;
      }
      try {
        const mod = await import("@discord/embedded-app-sdk");
        const sdk = new mod.DiscordSDK(clientId);
        sdkRef.current = sdk;
        await sdk.ready();
        const { code } = await sdk.commands.authorize({ client_id: clientId, response_type: "code", state: "", prompt: "none", scope: ["identify"] });
        const tokenResponse = await fetch("/api/oauth/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }), cache: "no-store" });
        const tokenData = await tokenResponse.json() as { access_token?: string; error?: string };
        if (!tokenResponse.ok || !tokenData.access_token) throw new Error(tokenData.error || "Discord authorization failed");
        const auth = await sdk.commands.authenticate({ access_token: tokenData.access_token });
        if (!auth?.user) throw new Error("Discord authentication failed");
        if (cancelled) return;
        setAccessToken(tokenData.access_token);
        setUser(auth.user as DiscordUser);
        setAuthState("ready");
      } catch (error) {
        if (cancelled) return;
        setAuthError(error instanceof Error ? error.message : "Discord Activity failed to initialize");
        setAuthState("error");
      }
    }
    void boot();
    return () => { cancelled = true; };
  }, [clientId]);

  const riskIndex = useMemo(() => riskValues.indexOf(risk), [risk]);
  const canUseLive = authState === "ready" && Boolean(accessToken);
  const sessionText = authState === "ready"
    ? (user?.global_name || user?.username || "Discord connected")
    : authState === "preview" ? "Browser preview"
      : authState === "error" ? "Auth error"
        : "Connecting";

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2500);
  }

  async function compose() {
    if (!canUseLive) return notify("Open Horris inside Discord to use live AI planning.");
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/activity/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ prompt, accountBalanceUsd: Number(balance), risk }),
        cache: "no-store",
      });
      const data = await response.json() as ComposeResult;
      setResult(data);
    } catch {
      setResult({ error: "Horris AI is temporarily unavailable. No order was submitted." });
    } finally {
      setBusy(false);
    }
  }

  async function loadStatus() {
    if (!canUseLive) return notify("Open Horris inside Discord for live position status.");
    setStatusBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/activity/status", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ account: wallet }),
        cache: "no-store",
      });
      const data = await response.json() as StatusResult;
      setStatus(data);
      if (response.ok) window.localStorage.setItem("horris:wallet", wallet);
    } catch {
      setStatus({ error: "Live UpDown status is temporarily unavailable." });
    } finally {
      setStatusBusy(false);
    }
  }

  async function openTerminal() {
    const sdk = sdkRef.current;
    try {
      if (sdk && authState === "ready") await sdk.commands.openExternalLink({ url: terminalUrl });
      else window.open(terminalUrl, "_blank", "noopener,noreferrer");
    } catch {
      notify("Discord blocked the external wallet handoff.");
    }
  }

  async function invite() {
    try {
      if (!sdkRef.current) return notify("Invite works when Horris is opened inside Discord.");
      await sdkRef.current.commands.openInviteDialog();
    } catch {
      notify("Invite is unavailable in this Discord context.");
    }
  }

  async function shareTrade() {
    if (!result?.proposal || !sdkRef.current) return notify("Generate a Horris plan inside Discord first.");
    const p = result.proposal;
    const verdict = result.review?.accepted ? "POLICY PASS" : "POLICY BLOCK";
    try {
      const { success } = await sdkRef.current.commands.shareLink({
        message: `Horris · ${p.market} ${p.side.toUpperCase()} · ${p.leverage.toFixed(2)}x · ${verdict}. AI planned, Horris policy checked. No trade is copied automatically.`,
        custom_id: `trade-${p.market}-${p.side}-${p.risk}`.slice(0, 100),
      });
      notify(success ? "Shared to Discord." : "Share cancelled.");
    } catch {
      notify("Sharing is unavailable right now.");
    }
  }

  return <main className="activity-shell">
    {toast && <div className="toast">{toast}</div>}

    <header className="topbar">
      <button className="wordmark" onClick={() => setTab("trade")} aria-label="Horris home">
        <span className="wordmark-main">HORRIS</span><span className="wordmark-tag">DISCORD / 01</span>
      </button>
      <nav className="desktop-nav" aria-label="Horris Activity sections">
        {(["trade", "positions", "risk"] as Tab[]).map((item) => <button key={item} onClick={() => setTab(item)} className={tab === item ? "active" : ""}>{item.toUpperCase()}</button>)}
      </nav>
      <div className="session">
        <span className={`signal ${authState}`} />
        <span>{sessionText}</span>
        <button className="outline-button compact" onClick={invite}>INVITE ↗</button>
      </div>
    </header>

    <div className="protocol-strip" aria-hidden="true">
      <span>HORRIS / AI EXECUTION INFRASTRUCTURE</span>
      <span>CELO · UPDOWN</span>
      <span>AI PROPOSES · POLICY DECIDES</span>
      <span>WALLET APPROVAL ONLY</span>
    </div>

    {authState === "error" && <div className="system-banner danger"><strong>DISCORD AUTH FAILED</strong><span>{authError}</span></div>}
    {authState === "preview" && <div className="system-banner"><strong>ACTIVITY PREVIEW</strong><span>Live Discord OAuth, AI planning, invites and sharing activate when launched as a Discord Activity.</span></div>}

    {tab === "trade" && <>
      <section className="masthead grid-frame">
        <div className="masthead-left">
          <p className="micro-label">01 / AI TRADING DESK</p>
          <h1><span>TRADE</span><span className="outline-type">WITH AI</span></h1>
        </div>
        <div className="masthead-right">
          <div className="crosshair" aria-hidden="true">＋</div>
          <p>Describe the trade in plain English. Horris AI builds the setup. Deterministic policy decides whether the setup is allowed.</p>
          <div className="masthead-meta"><span>NO CUSTODY</span><span>NO AUTONOMOUS SIGNING</span><span>CELO NATIVE</span></div>
        </div>
      </section>

      <section className="trade-workbench grid-frame">
        <div className="section-index"><span>02</span><small>EXECUTION<br/>PLANNING</small></div>
        <div className="workbench-main">
          <div className="section-heading">
            <span className="micro-label">WHAT DO YOU WANT HORRIS TO DO?</span>
            <span className="live-chip">{canUseLive ? "● LIVE" : "○ PREVIEW"}</span>
          </div>
          <textarea className="trade-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={1000} aria-label="Trade request" placeholder="Long BTC with $50 safely" />
          <div className="quick-row">
            {[
              ["BTC / LONG", "Long BTC with $50 safely"],
              ["ETH / SHORT", "Short ETH with $50 safely"],
              ["CELO / LONG", "Long CELO with $25 safely"],
            ].map(([label, value]) => <button key={label} onClick={() => setPrompt(value)}>{label}<span>↗</span></button>)}
          </div>
          <div className="compose-controls">
            <label className="balance-control"><span>PLANNING BALANCE / USD</span><div><b>$</b><input value={balance} onChange={(e) => setBalance(e.target.value)} inputMode="decimal" /></div></label>
            <button className="primary-button" disabled={busy} onClick={compose}>{busy ? "HORRIS IS THINKING" : "GENERATE PLAN"}<span>→</span></button>
          </div>
        </div>
      </section>

      <section className="risk-section grid-frame">
        <div className="risk-title-wrap"><p className="micro-label">03 / RISK PROFILE</p><h2>RISK</h2></div>
        <div className="risk-interface">
          <div className="risk-readout"><span>{riskCopy[risk].index}</span><strong>{riskCopy[risk].label}</strong><small>{riskCopy[risk].line}</small></div>
          <input className="risk-slider" type="range" min="0" max="2" step="1" value={riskIndex} onChange={(e) => setRisk(riskValues[Number(e.target.value)])} aria-label="Risk profile" />
          <div className="risk-options">{riskValues.map((item, index) => <button key={item} className={risk === item ? "active" : ""} onClick={() => setRisk(item)}><span>0{index + 1}</span><strong>{riskCopy[item].label}</strong></button>)}</div>
        </div>
      </section>

      <section className="authority-band grid-frame">
        <div><span className="micro-label">AUTHORITY / HORRIS CORE</span><strong>AI CAN SUGGEST.</strong></div>
        <div className="authority-outline">POLICY DECIDES.</div>
      </section>

      <section className="result-panel grid-frame">
        <div className="result-title"><p className="micro-label">04 / HORRIS PLAN</p><span>{result?.model ? `MODEL / ${result.model}` : "WAITING / INPUT"}</span></div>
        {!result && <div className="empty-state"><div className="empty-mark">＋</div><strong>NO PLAN YET</strong><p>Type a trade above. Horris will resolve the live UpDown entry price when you do not provide one.</p></div>}
        {result?.error && <div className="state-message error-box"><span>×</span><div><strong>PLAN FAILED SAFELY</strong><p>{result.error}</p></div></div>}
        {result && result.ready === false && <div className="state-message needs"><span>＋</span><div><strong>MORE CONTEXT REQUIRED</strong><p>{result.message}</p><div className="missing-list">{result.missing?.map((item) => <span key={item}>{item}</span>)}</div></div></div>}
        {result?.proposal && <>
          <div className="trade-ticket">
            <div><small>MARKET</small><strong>{result.proposal.market}</strong></div>
            <div><small>SIDE</small><strong>{result.proposal.side.toUpperCase()}</strong></div>
            <div><small>MARGIN / USD</small><strong>${result.proposal.marginUsd.toFixed(2)}</strong></div>
            <div><small>LEVERAGE</small><strong>{result.proposal.leverage.toFixed(2)}×</strong></div>
            <div><small>ENTRY</small><strong>{result.proposal.entryPrice.toLocaleString()}</strong></div>
            <div><small>STOP</small><strong>{result.proposal.stopLoss.toLocaleString()}</strong></div>
            <div><small>TAKE PROFIT</small><strong>{result.proposal.takeProfit.toLocaleString()}</strong></div>
            <div><small>PROFILE</small><strong>{result.proposal.risk}</strong></div>
          </div>
          <div className={`policy-verdict ${result.review?.accepted ? "pass" : "block"}`}>
            <div className="verdict-label"><small>DETERMINISTIC POLICY</small><strong>{result.review?.accepted ? "PASS" : "BLOCK"}</strong></div>
            <div className="verdict-glyph">{result.review?.accepted ? "✓" : "×"}</div>
            <p>{result.review?.analysis ? `${result.review.analysis.accountRiskPercent.toFixed(2)}% account risk / ${result.review.analysis.stopDistancePercent.toFixed(2)}% stop distance${result.review.analysis.rewardRisk ? ` / ${result.review.analysis.rewardRisk.toFixed(2)}R` : ""}` : "Proposal did not pass Horris validation."}</p>
          </div>
          {result.review?.analysis?.checks?.length ? <div className="checks">{result.review.analysis.checks.map((check, index) => <div key={check.code}><span className="check-index">0{index + 1}</span><span className="check-state">{check.passed ? "PASS" : "FAIL"}</span><p><strong>{check.label}</strong><small>{check.detail}</small></p></div>)}</div> : null}
          {result.proposal.rationale && <div className="rationale"><small>AI RATIONALE / UNTRUSTED INPUT</small><p>{result.proposal.rationale}</p></div>}
          <div className="actions"><button className="primary-button" disabled={!result.review?.accepted} onClick={openTerminal}>{result.review?.accepted ? "REVIEW + APPROVE" : "POLICY BLOCKED"}<span>→</span></button><button className="outline-button" onClick={shareTrade}>SHARE SETUP ↗</button></div>
          <p className="fineprint">NO GUARANTEED PROFIT / HORRIS DISCORD CANNOT SIGN, CUSTODY FUNDS OR SUBMIT THIS ORDER.</p>
        </>}
      </section>
    </>}

    {tab === "positions" && <section className="positions-page">
      <div className="page-hero grid-frame">
        <div><p className="micro-label">01 / LIVE UPDOWN</p><h1>YOUR<br/><span className="outline-type">POSITIONS</span></h1></div>
        <div className="page-hero-copy"><span className="crosshair">＋</span><p>Read live UpDown positions and orders from a public Celo address. Nothing here can sign or move funds.</p></div>
      </div>
      <div className="wallet-console grid-frame">
        <div className="section-index"><span>02</span><small>PUBLIC<br/>ACCOUNT</small></div>
        <div className="wallet-input-wrap"><label>CELO WALLET / READ ONLY</label><input value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="0x…" spellCheck={false} /><button className="primary-button" disabled={statusBusy} onClick={loadStatus}>{statusBusy ? "REFRESHING" : "LOAD STATUS"}<span>→</span></button></div>
      </div>
      {status?.error && <div className="state-message error-box status-error"><span>×</span><div><strong>STATUS UNAVAILABLE</strong><p>{status.error}</p></div></div>}
      <div className="position-counts grid-frame"><div><small>OPEN POSITIONS</small><strong>{status?.positions?.positionCount ?? "—"}</strong></div><div><small>OPEN ORDERS</small><strong>{status?.orders?.orderCount ?? "—"}</strong></div></div>
      {status?.positions && status.orders && <div className="position-grid grid-frame">
        <div className="position-column"><div className="column-head"><span>POSITIONS</span><span>UPDOWN / CELO</span></div>{status.positions.positions.length === 0 ? <p className="muted">NO OPEN UPDOWN POSITIONS.</p> : status.positions.positions.map((p, i) => <article key={`${p.market}-${i}`}><small>0{i + 1} / {p.market}</small><strong>{p.side.toUpperCase()}</strong><span>${Number(p.sizeUsd).toFixed(2)} SIZE</span><span>{p.effectiveLeverage === null ? "LEVERAGE N/A" : `${p.effectiveLeverage.toFixed(2)}× EFFECTIVE`}</span></article>)}</div>
        <div className="position-column"><div className="column-head"><span>ORDERS</span><span>READ ONLY</span></div>{status.orders.orders.length === 0 ? <p className="muted">NO OPEN UPDOWN ORDERS.</p> : status.orders.orders.map((o, i) => <article key={o.key}><small>0{i + 1} / {o.market}</small><strong>{o.type}</strong><span>{o.side.toUpperCase()} / ${Number(o.sizeUsd).toFixed(2)}</span><span>{o.triggerPrice ? `TRIGGER ${o.triggerPrice}` : "NO TRIGGER"}{o.isFrozen ? " / FROZEN" : ""}</span></article>)}</div>
      </div>}
    </section>}

    {tab === "risk" && <section className="risk-page">
      <div className="page-hero risk-hero grid-frame">
        <div><p className="micro-label">01 / SECURITY MODEL</p><h1>AI DOESN&apos;T<br/><span className="outline-type">DECIDE.</span></h1></div>
        <div className="page-hero-copy"><span className="crosshair">＋</span><p>Horris treats AI output as untrusted input. Policy remains deterministic, inspectable and separate from the model.</p></div>
      </div>
      <div className="process-list grid-frame">
        {[
          ["01", "YOU ASK", "Describe the intent in plain English."],
          ["02", "AI PROPOSES", "Margin, leverage, stop and target."],
          ["03", "HORRIS CHECKS", "Hard leverage, loss, margin and reward/risk controls."],
          ["04", "YOU APPROVE", "Final signing happens outside Discord in your wallet."],
        ].map(([number, title, copy]) => <article key={number}><span>{number}</span><strong>{title}</strong><p>{copy}</p><i>＋</i></article>)}
      </div>
      <div className="guard-grid grid-frame">
        <article><small>AI AUTHORITY</small><strong>NONE</strong><p>AI cannot approve its own proposal.</p></article>
        <article><small>DISCORD CUSTODY</small><strong>NONE</strong><p>No private key, seed phrase or signer lives in the Activity.</p></article>
        <article><small>POLICY ENGINE</small><strong>HORRIS CORE</strong><p>One risk authority shared with the Horris web terminal.</p></article>
        <article><small>EXECUTION</small><strong>EXPLICIT WALLET</strong><p>Users leave Discord for final wallet review.</p></article>
      </div>
      <div className="risk-cta grid-frame"><div><span className="micro-label">HORRIS / DISCORD</span><strong>PLAN WITH AI.<br/>EXECUTE WITH RULES.</strong></div><button className="primary-button" onClick={() => setTab("trade")}>PLAN A TRADE <span>→</span></button></div>
    </section>}

    <footer><span>HORRIS / DISCORD ACTIVITY</span><span>CELO / UPDOWN / AI EXECUTION INFRASTRUCTURE</span><span>© 2026 MUSHEE</span></footer>
  </main>;
}
