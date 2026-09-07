import { NextRequest, NextResponse } from "next/server";
import { discordSafeErrorMessage, executeDiscordCommand } from "../../../lib/commands";
import { consumeInteractionId, ephemeral, MAX_INTERACTION_BYTES, optionMap, verifyDiscordRequest } from "../../../lib/discord-security";
import { consumeDiscordRateLimit, discordActorId } from "../../../lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

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

  // Discord endpoint verification PING. Signature verification above is still mandatory.
  if (interaction.type === 1) return json({ type: 1 });

  if (interaction.type !== 2 || !interaction.data || typeof interaction.data !== "object" || Array.isArray(interaction.data)) {
    return json({ error: "Unsupported Discord interaction." }, 400);
  }

  // Best-effort replay defense in addition to Discord's signed timestamp window.
  if (!consumeInteractionId(interaction.id)) return json(ephemeral("Duplicate Discord interaction ignored safely."));

  const rate = consumeDiscordRateLimit(discordActorId(interaction));
  if (!rate.allowed) {
    const retrySeconds = Math.max(1, Math.ceil(rate.retryAfterMs / 1000));
    return json(ephemeral(`Horris command rate limit reached. Try again in about ${retrySeconds}s.`));
  }

  const data = interaction.data as Record<string, unknown>;
  try {
    const content = await executeDiscordCommand(data.name, optionMap(data.options));
    return json(ephemeral(content));
  } catch (error) {
    return json(ephemeral(discordSafeErrorMessage(error)));
  }
}

export async function GET() {
  return json({ error: "Method not allowed." }, 405, { Allow: "POST" });
}
