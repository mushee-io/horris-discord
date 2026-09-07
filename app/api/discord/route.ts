import { NextRequest, NextResponse } from "next/server";
import { discordSafeErrorMessage, executeDiscordCommand } from "../../../lib/commands";
import { summarizeParsedMessage, missingTradeFields, parseTradePrompt } from "../../../lib/activity-trade";
import { requestActivityAdvisor } from "../../../lib/activity-core";
import { getMarketPrice, HorrisApiError, type HorrisRisk } from "../../../lib/horris-api";
import { consumeInteractionId, ephemeral, MAX_INTERACTION_BYTES, optionMap, verifyDiscordRequest } from "../../../lib/discord-security";
import { consumeDiscordRateLimit, discordActorId } from "../../../lib/rate-limit";
import { createWalletLinkRequest, disconnectWallet, getWalletLink, WalletLinkError } from "../../../lib/wallet-link";
import { formatPolicyDecision } from "../../../lib/policy-display";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      ...extraHeaders
    }
  });
}

function resolvedMessageContent(data: Record<string, unknown>) {
  const targetId = data.target_id;
  const resolved = data.resolved;
  if (typeof targetId !== "string" || !resolved || typeof resolved !== "object" || Array.isArray(resolved)) return undefined;
  const messages = (resolved as Record<string, unknown>).messages;
  if (!messages || typeof messages !== "object" || Array.isArray(messages)) return undefined;
  const message = (messages as Record<string, unknown>)[targetId];
  if (!message || typeof message !== "object" || Array.isArray(message)) return undefined;
  const content = (message as Record<string, unknown>).content;
  return typeof content === "string" ? content.slice(0, 1_000) : undefined;
}

function parseRisk(value: unknown): HorrisRisk {
  if (value === "Conservative" || value === "Balanced" || value === "Aggressive") return value;
  throw new Error("Invalid risk profile.");
}

function publicOrigin(request: NextRequest) {
  const configured = process.env.HORRIS_DISCORD_PUBLIC_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "https:" || (process.env.NODE_ENV !== "production" && url.protocol === "http:")) return url.origin;
    } catch {}
  }
  return request.nextUrl.origin;
}

function ephemeralLink(content: string, label: string, url: string) {
  const base = ephemeral(content);
  return {
    ...base,
    data: {
      ...base.data,
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 5, label, url }
          ]
        }
      ]
    }
  };
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

async function executeWalletCommand(name: unknown, actorId: string | null, interactionToken: unknown, request: NextRequest) {
  if (name !== "connect-wallet" && name !== "wallet" && name !== "disconnect-wallet") return null;
  if (!actorId) throw new WalletLinkError("Horris could not resolve your Discord user identity.", "DISCORD_USER_MISSING", 400);

  if (name === "connect-wallet") {
    if (typeof interactionToken !== "string") throw new WalletLinkError("Discord callback token is missing.", "DISCORD_CALLBACK_MISSING", 400);
    const token = await createWalletLinkRequest(actorId, interactionToken);
    const url = new URL("/wallet/connect", publicOrigin(request));
    url.searchParams.set("token", token);
    return ephemeralLink(
      "Secure wallet verification is ready. Open the link below and sign the one-time ownership message. Horris never receives custody and no transaction is submitted.",
      "CONNECT WALLET",
      url.toString()
    );
  }

  if (name === "wallet") {
    const link = await getWalletLink(actorId);
    if (!link) return ephemeral("No wallet is linked to your Discord account. Run /connect-wallet first.");
    const chainNote = link.chainId === 42220 ? "Celo mainnet" : `chain ${link.chainId} · switch to Celo (42220) before any future execution`;
    return ephemeral(`Horris WALLET ✓ ${shortAddress(link.walletAddress)} · ${chainNote} · verified ${link.verifiedAt}. Ownership verified; Discord cannot spend funds.`);
  }

  const removed = await disconnectWallet(actorId);
  if (!removed) return ephemeral("No wallet was linked to your Discord account.");
  return ephemeral(`Wallet disconnected ✓ ${shortAddress(removed.walletAddress)}. Horris Discord no longer associates it with your Discord account.`);
}

async function executeTrade(options: Record<string, unknown>) {
  const prompt = typeof options.prompt === "string" ? options.prompt.trim().slice(0, 1_000) : "";
  const balance = Number(options.balance);
  const risk = parseRisk(options.risk);
  if (prompt.length < 3) return "Tell Horris the trade you want, for example: Long BTC with $50 safely.";
  if (!Number.isFinite(balance) || balance <= 0 || balance > 1_000_000_000) return "Planning balance must be a positive number.";

  const parsed = parseTradePrompt(prompt, balance, risk);
  const missing = missingTradeFields(parsed);
  if (missing.length) return `Horris needs ${missing.join(" and ")} in the prompt. Example: Long BTC with $50 safely.`;

  let entryPrice = parsed.entryPrice;
  let priceLabel = "PROMPT PRICE";
  if (!entryPrice) {
    const live = await getMarketPrice(parsed.market!);
    entryPrice = Number(live.price.mid);
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) throw new HorrisApiError("Live UpDown entry price is invalid", 502, "HORRIS_CORE_INVALID_RESPONSE");
    priceLabel = "LIVE UPDOWN PRICE";
  }

  const result = await requestActivityAdvisor({
    market: parsed.market!,
    side: parsed.side!,
    risk: parsed.risk,
    accountBalanceUsd: parsed.accountBalanceUsd,
    entryPrice,
    preferredMarginUsd: parsed.preferredMarginUsd,
    preferredLeverage: parsed.preferredLeverage,
  });

  const p = result.proposal;
  const analysis = result.review.analysis;
  const policy = formatPolicyDecision({ accepted: result.review.accepted, analysis });
  const riskLine = analysis
    ? `${analysis.accountRiskPercent.toFixed(2)}% account risk · ${analysis.stopDistancePercent.toFixed(2)}% stop distance`
    : "Policy analysis unavailable";
  const mathLine = analysis
    ? `HORRIS MATH · $${analysis.notionalUsd.toFixed(4)} notional · $${(analysis.notionalUsd * analysis.stopDistancePercent / 100).toFixed(6)} projected loss at stop · ${(p.marginUsd / p.accountBalanceUsd * 100).toFixed(2)}% margin utilization`
    : "";
  const rationale = p.rationale
    ? `AI THESIS (NON-AUTHORITATIVE): ${p.rationale.replace(/\s+/g, " ").trim().slice(0, 360)}`
    : "";

  return [
    `HORRIS AI TRADE PLAN · ${policy.verdict}`,
    ...policy.failedLines,
    `${p.market} ${p.side.toUpperCase()} · ${p.leverage.toFixed(2)}x · $${p.marginUsd.toFixed(4)} margin`,
    `${priceLabel}: ${p.entryPrice} · STOP: ${p.stopLoss} · TAKE PROFIT: ${p.takeProfit}`,
    `${riskLine} · ${p.risk}`,
    mathLine,
    `Model: ${result.model}`,
    rationale,
    "AI proposes. Horris policy decides. No transaction or order was submitted."
  ].filter(Boolean).join("\n");
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType && !contentType.toLowerCase().startsWith("application/json")) return json({ error: "Unsupported content type." }, 415);

  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) return json({ error: "Invalid content length." }, 400);
    if (contentLength > MAX_INTERACTION_BYTES) return json({ error: "Interaction body too large." }, 413);
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_INTERACTION_BYTES) return json({ error: "Interaction body too large." }, 413);
  if (!verifyDiscordRequest(rawBody, request.headers)) return json({ error: "Invalid Discord signature." }, 401);

  let body: unknown;
  try { body = JSON.parse(rawBody); }
  catch { return json({ error: "Invalid JSON interaction." }, 400); }

  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid Discord interaction." }, 400);
  const interaction = body as Record<string, unknown>;

  if (interaction.type === 1) return json({ type: 1 });
  if (interaction.type !== 2 || !interaction.data || typeof interaction.data !== "object" || Array.isArray(interaction.data)) return json({ error: "Unsupported Discord interaction." }, 400);
  if (!consumeInteractionId(interaction.id)) return json(ephemeral("Duplicate Discord interaction ignored safely."));

  const actorId = discordActorId(interaction);
  const rate = consumeDiscordRateLimit(actorId);
  if (!rate.allowed) {
    const retrySeconds = Math.max(1, Math.ceil(rate.retryAfterMs / 1000));
    return json(ephemeral(`Horris command rate limit reached. Try again in about ${retrySeconds}s.`));
  }

  const data = interaction.data as Record<string, unknown>;

  if (data.name === "Analyze with Horris" || data.name === "analyze-with-horris") {
    const content = resolvedMessageContent(data);
    return json(ephemeral(content ? summarizeParsedMessage(content) : "Horris could not read that message. Use /trade to generate a plan directly in Discord."));
  }

  try {
    const walletResponse = await executeWalletCommand(data.name, actorId, interaction.token, request);
    if (walletResponse) return json(walletResponse);
    if (data.name === "help") return json(ephemeral("Horris commands: /trade, /connect-wallet, /wallet, /disconnect-wallet, /strategy, /risk, /perp-risk, /perp-status. /trade generates the AI plan directly in Discord. /perp-status uses your linked wallet unless you provide an address override. Wallet ownership is verified externally; signing and transaction approval never happen inside Discord."));
    if (data.name === "trade") return json(ephemeral(await executeTrade(optionMap(data.options))));
    if (data.name === "perp-status") {
      const options = optionMap(data.options);
      if (!options.account) {
        if (!actorId) return json(ephemeral("Horris could not resolve your Discord identity. Provide an account address explicitly."));
        const link = await getWalletLink(actorId);
        if (!link) return json(ephemeral("No wallet is linked yet. Run /connect-wallet, or provide an account address to /perp-status."));
        options.account = link.walletAddress;
        const content = await executeDiscordCommand(data.name, options);
        return json(ephemeral(`Using linked wallet ${shortAddress(link.walletAddress)}.\n${content}`));
      }
      return json(ephemeral(await executeDiscordCommand(data.name, options)));
    }
    const content = await executeDiscordCommand(data.name, optionMap(data.options));
    return json(ephemeral(content));
  } catch (error) {
    if (error instanceof WalletLinkError) return json(ephemeral(error.message));
    return json(ephemeral(discordSafeErrorMessage(error)));
  }
}

export async function GET() {
  return json({ error: "Method not allowed." }, 405, { Allow: "POST" });
}
