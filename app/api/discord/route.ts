import { NextRequest, NextResponse } from "next/server";
import { executeDiscordCommand } from "../../../lib/commands";
import { ephemeral, MAX_INTERACTION_BYTES, optionMap, verifyDiscordRequest } from "../../../lib/discord-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_INTERACTION_BYTES) return json({ error: "Interaction body too large." }, 413);

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_INTERACTION_BYTES) return json({ error: "Interaction body too large." }, 413);
  if (!verifyDiscordRequest(rawBody, request.headers)) return json({ error: "Invalid Discord signature." }, 401);

  let body: unknown;
  try { body = JSON.parse(rawBody); }
  catch { return json({ error: "Invalid JSON interaction." }, 400); }

  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid Discord interaction." }, 400);
  const interaction = body as Record<string, unknown>;

  // Discord endpoint verification PING.
  if (interaction.type === 1) return json({ type: 1 });

  if (interaction.type !== 2 || !interaction.data || typeof interaction.data !== "object") {
    return json({ error: "Unsupported Discord interaction." }, 400);
  }

  const data = interaction.data as Record<string, unknown>;
  try {
    const content = await executeDiscordCommand(data.name, optionMap(data.options));
    return json(ephemeral(content));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Horris command failed.";
    return json(ephemeral(message));
  }
}

export async function GET() {
  return json({
    service: "horris-discord",
    endpoint: "/api/discord",
    interactionVerification: "ed25519",
    readOnly: true,
    signingEnabled: false,
    executionEnabled: false
  });
}
