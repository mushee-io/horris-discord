import nacl from "tweetnacl";
import { afterEach, describe, expect, it } from "vitest";
import { ephemeral, MAX_TIMESTAMP_SKEW_SECONDS, optionMap, verifyDiscordRequest } from "../lib/discord-security";

const originalPublicKey = process.env.DISCORD_PUBLIC_KEY;

afterEach(() => {
  if (originalPublicKey === undefined) delete process.env.DISCORD_PUBLIC_KEY;
  else process.env.DISCORD_PUBLIC_KEY = originalPublicKey;
});

function hex(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("hex");
}

describe("Discord interaction security", () => {
  it("verifies a fresh Ed25519 interaction", () => {
    const pair = nacl.sign.keyPair();
    process.env.DISCORD_PUBLIC_KEY = hex(pair.publicKey);
    const body = JSON.stringify({ type: 1 });
    const now = 1_800_000_000;
    const timestamp = String(now);
    const signature = nacl.sign.detached(new TextEncoder().encode(timestamp + body), pair.secretKey);
    const headers = new Headers({
      "x-signature-ed25519": hex(signature),
      "x-signature-timestamp": timestamp
    });
    expect(verifyDiscordRequest(body, headers, now)).toBe(true);
  });

  it("rejects stale requests and altered bodies", () => {
    const pair = nacl.sign.keyPair();
    process.env.DISCORD_PUBLIC_KEY = hex(pair.publicKey);
    const body = JSON.stringify({ type: 1 });
    const timestamp = "1800000000";
    const signature = nacl.sign.detached(new TextEncoder().encode(timestamp + body), pair.secretKey);
    const headers = new Headers({
      "x-signature-ed25519": hex(signature),
      "x-signature-timestamp": timestamp
    });
    expect(verifyDiscordRequest(body, headers, 1_800_000_000 + MAX_TIMESTAMP_SKEW_SECONDS + 1)).toBe(false);
    expect(verifyDiscordRequest(`${body} `, headers, 1_800_000_000)).toBe(false);
  });

  it("maps command options and keeps responses ephemeral and mention-safe", () => {
    expect(optionMap([{ name: "market", value: "BTC" }, { name: "leverage", value: 3 }])).toEqual({ market: "BTC", leverage: 3 });
    expect(ephemeral("ok")).toEqual({
      type: 4,
      data: { content: "ok", flags: 64, allowed_mentions: { parse: [] } }
    });
  });
});
