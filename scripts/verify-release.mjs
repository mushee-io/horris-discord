import { readFile } from "node:fs/promises";

const required = [
  "app/api/discord/route.ts",
  "app/api/health/route.ts",
  "lib/commands.ts",
  "lib/discord-security.ts",
  "lib/horris-api.ts",
  "scripts/register-discord.mjs",
  ".env.example"
];

const contents = await Promise.all(required.map(async (path) => [path, await readFile(path, "utf8")]));
const joined = contents.map(([, content]) => content).join("\n");

for (const command of ["help", "strategy", "risk", "perp-risk", "perp-status"]) {
  if (!joined.includes(`\"${command}\"`)) throw new Error(`Missing Discord command: ${command}`);
}

for (const forbidden of ["NEXT_PUBLIC_DISCORD", "NEXT_PUBLIC_HORRIS", "eth_sendTransaction", "wallet_sendCalls", "writeContract(", "sendTransaction("]) {
  if (joined.includes(forbidden)) throw new Error(`Forbidden release primitive found: ${forbidden}`);
}

if (!joined.includes("verifyDiscordRequest")) throw new Error("Discord signature verification is missing");
if (!joined.includes("MAX_TIMESTAMP_SKEW_SECONDS")) throw new Error("Discord replay window is missing");
if (!joined.includes("executionEnabled: false")) throw new Error("Execution lock evidence is missing");
if (!joined.includes("Horris Core")) throw new Error("Horris Core authority boundary is missing");

console.log("Horris Discord release gate passed.");
