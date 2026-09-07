"use client";

import { useState } from "react";

type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

type Props = {
  token: string;
};

type ApiError = {
  message?: string;
  code?: string;
};

function provider() {
  if (typeof window === "undefined") return null;
  return (window as unknown as { ethereum?: EthereumProvider }).ethereum ?? null;
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default function WalletConnectClient({ token }: Props) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(token ? "Ready to verify wallet ownership." : "This wallet connection link is missing or invalid.");
  const [connected, setConnected] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function connect() {
    if (!token || busy) return;
    const wallet = provider();
    if (!wallet) {
      setStatus("No browser wallet was detected. Open this page in a browser with MetaMask or another EVM wallet installed.");
      return;
    }

    setBusy(true);
    setSuccess(false);
    try {
      setStatus("Waiting for wallet connection…");
      const accounts = await wallet.request({ method: "eth_requestAccounts" });
      if (!Array.isArray(accounts) || typeof accounts[0] !== "string") throw new Error("Wallet did not return an account.");
      const address = accounts[0];
      setConnected(address);

      const chainHex = await wallet.request({ method: "eth_chainId" });
      if (typeof chainHex !== "string") throw new Error("Wallet did not return a chain ID.");
      const chainId = Number.parseInt(chainHex, 16);
      if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("Wallet returned an invalid chain ID.");

      setStatus("Creating a Horris ownership challenge…");
      const challengeResponse = await fetch("/api/wallet/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, address, chainId })
      });
      const challenge = await challengeResponse.json() as ApiError & { ok?: boolean; message?: string; address?: string };
      if (!challengeResponse.ok || !challenge.ok || typeof challenge.message !== "string") {
        throw new Error(challenge.message || "Could not create the wallet challenge.");
      }

      setStatus("Sign the Horris verification message in your wallet. This is not a transaction.");
      const signature = await wallet.request({
        method: "personal_sign",
        params: [challenge.message, address]
      });
      if (typeof signature !== "string") throw new Error("Wallet did not return a signature.");

      setStatus("Verifying signature with Horris…");
      const verifyResponse = await fetch("/api/wallet/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, address, signature })
      });
      const verified = await verifyResponse.json() as ApiError & { ok?: boolean; walletAddress?: string; discordConfirmed?: boolean };
      if (!verifyResponse.ok || !verified.ok || typeof verified.walletAddress !== "string") {
        throw new Error(verified.message || "Wallet verification failed.");
      }

      setConnected(verified.walletAddress);
      setSuccess(true);
      setStatus(verified.discordConfirmed
        ? "Wallet verified. Horris also confirmed the connection back in Discord."
        : "Wallet verified. Return to Discord and use /wallet to confirm the link.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Wallet connection failed safely.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", background: "#070707", color: "#f5f5f5", display: "grid", placeItems: "center", padding: 24, fontFamily: "Inter, system-ui, sans-serif" }}>
      <section style={{ width: "100%", maxWidth: 560, border: "1px solid #2a2a2a", borderRadius: 20, padding: 28, background: "#0d0d0d", boxShadow: "0 20px 70px rgba(0,0,0,.4)" }}>
        <div style={{ fontSize: 12, letterSpacing: ".16em", textTransform: "uppercase", opacity: .62, marginBottom: 10 }}>Horris Discord</div>
        <h1 style={{ fontSize: 34, lineHeight: 1.05, margin: "0 0 12px", letterSpacing: "-.04em" }}>Connect your wallet</h1>
        <p style={{ color: "#bdbdbd", lineHeight: 1.6, margin: "0 0 24px" }}>
          Horris asks your wallet to sign a one-time ownership message. No transaction is sent and no spending permission is granted.
        </p>

        <div style={{ border: "1px solid #242424", borderRadius: 14, padding: 16, marginBottom: 18, background: "#111" }}>
          <div style={{ fontSize: 12, color: "#8c8c8c", marginBottom: 6 }}>STATUS</div>
          <div style={{ lineHeight: 1.5 }}>{status}</div>
          {connected ? <div style={{ marginTop: 10, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "#d6d6d6" }}>{shortAddress(connected)}</div> : null}
        </div>

        <button
          type="button"
          onClick={connect}
          disabled={!token || busy || success}
          style={{ width: "100%", border: 0, borderRadius: 12, padding: "14px 18px", fontWeight: 750, fontSize: 15, cursor: !token || busy || success ? "not-allowed" : "pointer", background: success ? "#262626" : "#f4f4f4", color: success ? "#d4d4d4" : "#0a0a0a", opacity: !token ? .5 : 1 }}
        >
          {success ? "WALLET CONNECTED" : busy ? "VERIFYING…" : "CONNECT & VERIFY WALLET"}
        </button>

        <p style={{ color: "#747474", fontSize: 12, lineHeight: 1.55, margin: "18px 0 0" }}>
          Horris will never ask for a recovery phrase. Wallet signing stays outside Discord; Discord remains the control interface.
        </p>
      </section>
    </main>
  );
}
