import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const EMBEDDED_FLAG = 1n << 17n;

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive"
    }
  });
}

function applicationFlags(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0n;
  const app = value as Record<string, unknown>;
  try {
    if (typeof app.flags_new === "string" && /^\d+$/.test(app.flags_new)) return BigInt(app.flags_new);
    if (typeof app.flags === "number" && Number.isSafeInteger(app.flags) && app.flags >= 0) return BigInt(app.flags);
  } catch {}
  return 0n;
}

export async function GET() {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  const applicationId = process.env.DISCORD_APPLICATION_ID?.trim();

  if (!token || !applicationId) {
    return response({ ok: false, code: "DISCORD_ACTIVITY_NOT_CONFIGURED" }, 503);
  }

  const headers = { Authorization: `Bot ${token}` };
  let appResponse: Response;
  try {
    appResponse = await fetch("https://discord.com/api/v10/oauth2/applications/@me", {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(8000)
    });
  } catch {
    return response({ ok: false, code: "DISCORD_ACTIVITY_STATUS_UNAVAILABLE" }, 502);
  }

  if (!appResponse.ok) {
    const code = appResponse.status === 401
      ? "DISCORD_BOT_TOKEN_INVALID"
      : appResponse.status === 403
        ? "DISCORD_BOT_ACCESS_DENIED"
        : "DISCORD_API_ERROR";
    return response({ ok: false, code, discordStatus: appResponse.status }, 502);
  }

  const app = await appResponse.json() as Record<string, unknown>;
  const flags = applicationFlags(app);
  let commands: Array<Record<string, unknown>> = [];

  try {
    const commandsResponse = await fetch(`https://discord.com/api/v10/applications/${applicationId}/commands`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(8000)
    });
    if (commandsResponse.ok) commands = await commandsResponse.json() as Array<Record<string, unknown>>;
  } catch {}

  const primaryEntry = commands.find((command) => command?.type === 4);
  const activityEmbedded = (flags & EMBEDDED_FLAG) !== 0n;
  const applicationIdMatches = app.id === applicationId;

  return response({
    ok: applicationIdMatches && activityEmbedded,
    applicationIdMatches,
    activityEmbedded,
    primaryEntryPoint: primaryEntry
      ? {
          present: true,
          name: typeof primaryEntry.name === "string" ? primaryEntry.name : "Launch",
          handler: typeof primaryEntry.handler === "number" ? primaryEntry.handler : null
        }
      : { present: false },
    launchUrl: `https://discord.com/activities/${applicationId}`,
    portalChecks: {
      activitiesEnabled: activityEmbedded,
      urlMappingExpected: "/ → horris-discord.vercel.app",
      supportedPlatformsExpected: "Web/Desktop",
      applicationUrlOverrideExpected: "disabled for production"
    }
  });
}
