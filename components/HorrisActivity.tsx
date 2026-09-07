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

const riskCopy: Record<Risk, { label: string; line: string }> = {
  Conservative: { label: "SAFE", line: "Lower leverage · tighter account-risk limits" },
  Balanced: { label: "BALANCED", line: "Moderate leverage · balanced risk budget" },
  Aggressive: { label: "DEGEN", line: "Higher limits · deterministic caps still apply" },
};

export default function HorrisActivity({ clientId, terminalUrl }: { clientId: string; terminalUrl: string }) {
  const sdkRef = useRef<DiscordSDK | null>(null);
  const [tab, setTab] = useState<Tab>("trade");
  const [authState, setAuthState] = useState<"loading" | "ready" | "preview" | "error">("loading");
  const [authError, setAuthError] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [user, setUser] = useState<DiscordUser | null>(null);
  const [risk, setRisk] = useState<Risk>("Balanced");
  const [balance, setBalance] = useState("1000");
  const [prompt, setPrompt] = useState("Long BTC with $50 at 100000");
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

  const riskIndex = useMemo(() => (["Conservative", "Balanced", "Aggressive"] as Risk[]).indexOf(risk), [risk]);
  const canUseLive = authState === "ready" && Boolean(accessToken);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2500);
  }

  async function compose() {
    if (!canUseLive) return notify("Open Horris inside Discord to use live AI planning.");
    setBusy(true); setResult(null);
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
    setStatusBusy(true); setStatus(null);
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
      <div className="brand"><span className="brand-mark">H</span><div><strong>HORRIS</strong><small>AI TRADING DESK · DISCORD</small></div></div>
      <div className="session">
        <span className={`signal ${authState}`} />
        <span>{authState === "ready" ? (user?.global_name || user?.username || "Discord connected") : authState === "preview" ? "Browser preview" : authState === "error" ? "Auth error" : "Connecting"}</span>
        <button className="text-button" onClick={invite}>INVITE</button>
      </div>
    </header>

    <nav className="activity-nav">
      {(["trade", "positions", "risk"] as Tab[]).map((item) => <button key={item} onClick={() => setTab(item)} className={tab === item ? "active" : ""}>{item.toUpperCase()}</button>)}
      <span className="execution-lock">EXECUTION · WALLET APPROVAL ONLY</span>
    </nav>

    {authState === "error" && <div className="system-banner danger"><strong>DISCORD AUTH FAILED</strong><span>{authError}</span></div>}
    {authState === "preview" && <div className="system-banner"><strong>ACTIVITY PREVIEW</strong><span>The interface is visible here. Live Discord OAuth, AI planning, invites and sharing activate when launched as a Discord Activity.</span></div>}

    {tab === "trade" && <section className="trade-layout">
      <div className="hero-panel">
        <p className="eyebrow">01 / NATURAL-LANGUAGE EXECUTION PLANNING</p>
        <h1>Tell Horris the trade.<br/><em>Policy decides the rest.</em></h1>
        <p className="lede">AI proposes leverage, margin, stop and target. Horris Core independently checks the proposal. Discord never holds a private key and never submits a trade.</p>

        <div className="composer">
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={1000} aria-label="Trade request" placeholder="Example: Use $50 to long BTC conservatively at 100000 with 2x leverage" />
          <div className="composer-meta">
            <label><span>PLANNING BALANCE</span><div className="money-input"><b>$</b><input value={balance} onChange={(e) => setBalance(e.target.value)} inputMode="decimal" /></div></label>
            <button className="primary" disabled={busy} onClick={compose}>{busy ? "HORRIS IS THINKING…" : "GENERATE PLAN →"}</button>
          </div>
        </div>

        <div className="quick-row">
          {[
            ["BTC LONG", "Long BTC with $50 at 100000"],
            ["ETH SHORT", "Short ETH with $50 at 4000"],
            ["CELO LONG", "Long CELO with $25 at 0.50"],
          ].map(([label, value]) => <button key={label} onClick={() => setPrompt(value)}>{label}</button>)}
        </div>
      </div>

      <aside className="risk-rail">
        <p className="eyebrow">RISK DIAL</p>
        <div className="risk-label"><strong>{riskCopy[risk].label}</strong><span>{risk}</span></div>
        <input className="risk-slider" type="range" min="0" max="2" step="1" value={riskIndex} onChange={(e) => setRisk((["Conservative", "Balanced", "Aggressive"] as Risk[])[Number(e.target.value)])} />
        <div className="risk-scale"><span>SAFE</span><span>BALANCED</span><span>DEGEN</span></div>
        <p>{riskCopy[risk].line}</p>
        <div className="authority-box"><small>AUTHORITY</small><strong>HORRIS POLICY</strong><span>AI cannot approve itself.</span></div>
      </aside>

      <div className="result-panel">
        <div className="result-head"><p className="eyebrow">02 / HORRIS PLAN</p><span>{result?.model ? `AI · ${result.model}` : "WAITING FOR INPUT"}</span></div>
        {!result && <div className="empty"><strong>NO PLAN YET</strong><p>Describe a trade above. Include a market, long/short direction and entry price. Margin and leverage are optional.</p></div>}
        {result?.error && <div className="error-box"><strong>PLAN FAILED SAFELY</strong><p>{result.error}</p></div>}
        {result && result.ready === false && <div className="needs"><strong>HORRIS NEEDS MORE CONTEXT</strong><p>{result.message}</p><div>{result.missing?.map((item) => <span key={item}>{item}</span>)}</div></div>}
        {result?.proposal && <>
          <div className="trade-ticket">
            <div><small>MARKET</small><strong>{result.proposal.market}</strong></div>
            <div><small>SIDE</small><strong>{result.proposal.side.toUpperCase()}</strong></div>
            <div><small>MARGIN</small><strong>${result.proposal.marginUsd.toFixed(2)}</strong></div>
            <div><small>LEVERAGE</small><strong>{result.proposal.leverage.toFixed(2)}×</strong></div>
            <div><small>ENTRY</small><strong>{result.proposal.entryPrice.toLocaleString()}</strong></div>
            <div><small>STOP</small><strong>{result.proposal.stopLoss.toLocaleString()}</strong></div>
            <div><small>TAKE PROFIT</small><strong>{result.proposal.takeProfit.toLocaleString()}</strong></div>
            <div><small>PROFILE</small><strong>{result.proposal.risk}</strong></div>
          </div>
          <div className={`verdict ${result.review?.accepted ? "pass" : "block"}`}>
            <span>{result.review?.accepted ? "✓" : "×"}</span>
            <div><small>DETERMINISTIC POLICY</small><strong>{result.review?.accepted ? "PASS" : "BLOCK"}</strong><p>{result.review?.analysis ? `${result.review.analysis.accountRiskPercent.toFixed(2)}% account risk · ${result.review.analysis.stopDistancePercent.toFixed(2)}% stop distance${result.review.analysis.rewardRisk ? ` · ${result.review.analysis.rewardRisk.toFixed(2)}R` : ""}` : "Proposal did not pass Horris validation."}</p></div>
          </div>
          {result.review?.analysis?.checks?.length ? <div className="checks">{result.review.analysis.checks.map((check) => <div key={check.code}><span>{check.passed ? "✓" : "×"}</span><p><strong>{check.label}</strong><small>{check.detail}</small></p></div>)}</div> : null}
          {result.proposal.rationale && <div className="rationale"><small>AI RATIONALE · UNTRUSTED INPUT</small><p>{result.proposal.rationale}</p></div>}
          <div className="actions"><button className="primary" disabled={!result.review?.accepted} onClick={openTerminal}>{result.review?.accepted ? "REVIEW + APPROVE IN WALLET →" : "POLICY BLOCKED"}</button><button className="secondary" onClick={shareTrade}>SHARE SETUP</button></div>
          <p className="fineprint">No guaranteed profit. Horris Discord cannot sign, custody funds or submit this order.</p>
        </>}
      </div>
    </section>}

    {tab === "positions" && <section className="single-panel">
      <p className="eyebrow">LIVE UPDOWN / CELO</p><h2>Your positions, without leaving Discord.</h2><p className="lede">Paste a public Celo wallet address. Horris reads UpDown positions and orders only; the address is stored locally in your browser for convenience.</p>
      <div className="wallet-row"><input value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="0x… Celo wallet" spellCheck={false} /><button className="primary" disabled={statusBusy} onClick={loadStatus}>{statusBusy ? "REFRESHING…" : "LOAD STATUS"}</button></div>
      {status?.error && <div className="error-box"><strong>STATUS UNAVAILABLE</strong><p>{status.error}</p></div>}
      {status?.positions && status.orders && <div className="position-grid">
        <div className="position-column"><div className="column-head"><span>POSITIONS</span><strong>{status.positions.positionCount}</strong></div>{status.positions.positions.length === 0 ? <p className="muted">No open UpDown positions.</p> : status.positions.positions.map((p, i) => <article key={`${p.market}-${i}`}><small>{p.market}</small><strong>{p.side.toUpperCase()} · ${Number(p.sizeUsd).toFixed(2)}</strong><span>{p.effectiveLeverage === null ? "Leverage n/a" : `${p.effectiveLeverage.toFixed(2)}× effective leverage`}</span></article>)}</div>
        <div className="position-column"><div className="column-head"><span>ORDERS</span><strong>{status.orders.orderCount}</strong></div>{status.orders.orders.length === 0 ? <p className="muted">No open UpDown orders.</p> : status.orders.orders.map((o) => <article key={o.key}><small>{o.market}</small><strong>{o.type} · {o.side.toUpperCase()}</strong><span>{o.triggerPrice ? `Trigger ${o.triggerPrice}` : "No trigger"}{o.isFrozen ? " · FROZEN" : ""}</span></article>)}</div>
      </div>}
    </section>}

    {tab === "risk" && <section className="single-panel risk-explain">
      <p className="eyebrow">WHY HORRIS IS DIFFERENT</p><h2>AI can suggest. It cannot overrule policy.</h2>
      <div className="flow"><div><small>01</small><strong>YOU ASK</strong><p>“Use $50 to long BTC conservatively.”</p></div><span>→</span><div><small>02</small><strong>AI PROPOSES</strong><p>Margin, leverage, stop and target.</p></div><span>→</span><div><small>03</small><strong>HORRIS CHECKS</strong><p>Deterministic leverage, loss, margin and reward/risk controls.</p></div><span>→</span><div><small>04</small><strong>YOU APPROVE</strong><p>Wallet signing happens outside Discord.</p></div></div>
      <div className="guard-grid"><article><small>AI AUTHORITY</small><strong>NONE</strong><p>AI output is treated as untrusted input.</p></article><article><small>DISCORD CUSTODY</small><strong>NONE</strong><p>No seed phrase or private key belongs in this app.</p></article><article><small>POLICY ENGINE</small><strong>HORRIS CORE</strong><p>The same risk authority used by the web terminal.</p></article><article><small>EXECUTION</small><strong>EXPLICIT WALLET</strong><p>Users leave the Activity for final wallet review.</p></article></div>
      <button className="primary wide" onClick={() => setTab("trade")}>PLAN A TRADE →</button>
    </section>}

    <footer><span>HORRIS / DISCORD ACTIVITY</span><span>CELO · UPDOWN</span><span>AI PROPOSES · POLICY DECIDES</span></footer>
  </main>;
}
