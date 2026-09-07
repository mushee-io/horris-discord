import { NextRequest, NextResponse } from "next/server";
import { DISCORD_COMMANDS } from "../../../lib/commands";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function sameOrigin(request: NextRequest) {
  const host = request.headers.get("host");
  if (!host) return false;

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host === host) return true;
    } catch {}
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  const referer = request.headers.get("referer");
  if (fetchSite === "same-origin" && referer) {
    try {
      return new URL(referer).host === host;
    } catch {}
  }

  return false;
}

function discordCommandPayload() {
  const chatCommands = DISCORD_COMMANDS.map((command) => {
    if (!("options" in command)) return { type: 1, ...command };

    // Discord rejects a slash command when a required option appears after an
    // optional option. Keep the source definitions readable, but normalize the
    // wire payload so required options always come first.
    const options = [...command.options].sort((a, b) => {
      return Number(Boolean(b.required)) - Number(Boolean(a.required));
    });

    return { type: 1, ...command, options };
  });

  return [
    ...chatCommands,
    { type: 3, name: "Analyze with Horris" }
  ];
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return json({ ok: false, code: "REGISTRATION_ORIGIN_REJECTED" }, 403);
  }

  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  const applicationId = process.env.DISCORD_APPLICATION_ID?.trim();
  const guildId = process.env.DISCORD_GUILD_ID?.trim();

  if (!token || !applicationId || !guildId) {
    return json({
      ok: false,
      code: "DISCORD_COMMANDS_NOT_CONFIGURED",
      missing: [
        !token ? "DISCORD_BOT_TOKEN" : null,
        !applicationId ? "DISCORD_APPLICATION_ID" : null,
        !guildId ? "DISCORD_GUILD_ID" : null
      ].filter(Boolean)
    }, 503);
  }

  const endpoint = `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`;
  const commands = discordCommandPayload();

  let upstream: Response;
  try {
    upstream = await fetch(endpoint, {
      method: "PUT",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(commands),
      cache: "no-store",
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    return json({ ok: false, code: "DISCORD_REGISTRATION_UNAVAILABLE" }, 502);
  }

  if (!upstream.ok) {
    const code = upstream.status === 401
      ? "DISCORD_BOT_TOKEN_INVALID"
      : upstream.status === 403
        ? "DISCORD_BOT_ACCESS_DENIED"
        : upstream.status === 404
          ? "DISCORD_GUILD_NOT_FOUND_OR_INACCESSIBLE"
          : "DISCORD_REGISTRATION_FAILED";

    let detail = "";
    try {
      const text = await upstream.text();
      detail = text.slice(0, 1000);
    } catch {}

    return json({
      ok: false,
      code,
      discordStatus: upstream.status,
      detail
    }, 502);
  }

  const registered = await upstream.json() as Array<{ name?: string }>;
  const names = registered
    .map((command) => command?.name)
    .filter((name): name is string => typeof name === "string");

  return json({
    ok: true,
    scope: "guild",
    registered: names,
    registeredCount: names.length
  });
}
