import nacl from "tweetnacl";

export const MAX_INTERACTION_BYTES = 64 * 1024;
export const MAX_TIMESTAMP_SKEW_SECONDS = 300;

function hexToBytes(value: string) {
  if (!/^[0-9a-fA-F]+$/.test(value) || value.length % 2 !== 0) throw new Error("Invalid hex");
  return Uint8Array.from(value.match(/.{1,2}/g)!.map((byte) => Number.parseInt(byte, 16)));
}

export function verifyDiscordRequest(rawBody: string, headers: Headers, nowSeconds = Math.floor(Date.now() / 1000)) {
  const publicKey = process.env.DISCORD_PUBLIC_KEY?.trim();
  if (!publicKey) return false;

  const signature = headers.get("x-signature-ed25519");
  const timestamp = headers.get("x-signature-timestamp");
  if (!signature || !timestamp) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > MAX_TIMESTAMP_SKEW_SECONDS) return false;

  try {
    return nacl.sign.detached.verify(
      new TextEncoder().encode(timestamp + rawBody),
      hexToBytes(signature),
      hexToBytes(publicKey)
    );
  } catch {
    return false;
  }
}

export function optionMap(options: unknown) {
  const result: Record<string, unknown> = {};
  if (!Array.isArray(options)) return result;
  for (const option of options) {
    if (!option || typeof option !== "object") continue;
    const entry = option as Record<string, unknown>;
    if (typeof entry.name === "string") result[entry.name] = entry.value;
  }
  return result;
}

export function ephemeral(content: string) {
  return { type: 4, data: { content: content.slice(0, 1_950), flags: 64 } } as const;
}
