import { NextResponse } from "next/server";
import { DISCORD_COMMANDS } from "../../../lib/commands";
import { WALLET_DISCORD_COMMANDS } from "../../../lib/wallet-commands";

export const dynamic = "force-dynamic";

const expected = [
  ...DISCORD_COMMANDS.map((command) => command.name),
  ...WALLET_DISCORD_COMMANDS.map((command) => command.name),
  "Analyze with Horris"
];

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export async function GET() {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  const applicationId = process.env.DISCORD_APPLICATION_ID?.trim();
  const guildId = process.env.DISCORD_GUILD_ID?.trim();

  if (!token || !applicationId) {
    return response({
      ok: false,
      code: "DISCORD_COMMANDS_NOT_CONFIGURED",
      scope: guildId ? "guild" : "global",
      expected
    }, 503);
  }

  const endpoint = guildId
    ? `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`
    : `https://discord.com/api/v10/applications/${applicationId}/commands`;

  let upstream: Response;
  try {
    upstream = await fetch(endpoint, {
      headers: { Authorization: `Bot ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8000)
    });
  } catch {
    return response({
      ok: false,
      code: "DISCORD_COMMANDS_STATUS_UNAVAILABLE",
      scope: guildId ? "guild" : "global",
      expected
    }, 502);
  }

  if (!upstream.ok) {
    const code = upstream.status === 401
      ? "DISCORD_BOT_TOKEN_INVALID"
      : upstream.status === 403
        ? "DISCORD_BOT_ACCESS_DENIED"
        : upstream.status === 404
          ? "DISCORD_GUILD_NOT_FOUND_OR_INACCESSIBLE"
          : "DISCORD_API_ERROR";

    return response({
      ok: false,
      code,
      discordStatus: upstream.status,
      scope: guildId ? "guild" : "global",
      expected
    }, 502);
  }

  const commands = await upstream.json() as Array<{ name?: string; type?: number }>;
  const registered = commands
    .filter((command) => typeof command?.name === "string")
    .map((command) => command.name as string);
  const missing = expected.filter((name) => !registered.includes(name));

  return response({
    ok: missing.length === 0,
    scope: guildId ? "guild" : "global",
    expected,
    registered,
    missing,
    registeredCount: registered.length
  });
}
