import { readFile } from "node:fs/promises";

const required = [
  "app/page.tsx",
  "app/api/discord/route.ts",
  "app/api/health/route.ts",
  "app/api/oauth/token/route.ts",
  "app/api/activity/compose/route.ts",
  "app/api/activity/status/route.ts",
  "components/HorrisActivity.tsx",
  "lib/activity-auth.ts",
  "lib/activity-core.ts",
  "lib/activity-trade.ts",
  "lib/commands.ts",
  "lib/discord-security.ts",
  "lib/horris-api.ts",
  "scripts/register-discord.mjs",
  ".env.example"
];

const contents = await Promise.all(required.map(async (path) => [path, await readFile(path, "utf8")]));
const joined = contents.map(([, content]) => content).join("\n");

for (const command of ["trade", "help", "strategy", "risk", "perp-risk", "perp-status", "Analyze with Horris"]) {
  if (!joined.includes(command)) throw new Error(`Missing Discord command or surface: ${command}`);
}

for (const forbidden of ["NEXT_PUBLIC_DISCORD", "NEXT_PUBLIC_HORRIS", "eth_sendTransaction", "wallet_sendCalls", "writeContract(", "sendTransaction(", "privateKey", "seedPhrase", "mnemonic"]) {
  if (joined.includes(forbidden)) throw new Error(`Forbidden release primitive found: ${forbidden}`);
}

if (!joined.includes("verifyDiscordRequest")) throw new Error("Discord signature verification is missing");
if (!joined.includes("MAX_TIMESTAMP_SKEW_SECONDS")) throw new Error("Discord replay window is missing");
if (!joined.includes("DISCORD_CLIENT_SECRET")) throw new Error("Discord Activity server-side OAuth secret configuration is missing");
if (!joined.includes("commands.authorize") || !joined.includes("commands.authenticate")) throw new Error("Discord Activity OAuth handshake is missing");
if (!joined.includes("discord.com/activities/")) throw new Error("Discord Activity launch handoff is missing");
if (!joined.includes("commands.openExternalLink")) throw new Error("Explicit external wallet handoff is missing");
if (!joined.includes("commands.shareLink")) throw new Error("Discord-native sharing is missing");
if (!joined.includes("executionEnabled: false")) throw new Error("Execution lock evidence is missing");
if (!joined.includes("horris-policy")) throw new Error("Horris Core policy authority boundary is missing");

console.log("Horris Discord Activity release gate passed.");
