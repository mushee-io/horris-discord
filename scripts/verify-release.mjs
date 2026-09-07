import { readFile } from "node:fs/promises";

const required = [
  "app/page.tsx",
  "app/setup/page.tsx",
  "app/wallet/connect/page.tsx",
  "app/api/discord/route.ts",
  "app/api/commands-status/route.ts",
  "app/api/wallet/challenge/route.ts",
  "app/api/wallet/verify/route.ts",
  "app/api/health/route.ts",
  "app/api/oauth/token/route.ts",
  "app/api/activity/compose/route.ts",
  "app/api/activity/status/route.ts",
  "components/HorrisActivity.tsx",
  "components/WalletConnectClient.tsx",
  "lib/activity-auth.ts",
  "lib/activity-core.ts",
  "lib/activity-trade.ts",
  "lib/commands.ts",
  "lib/discord-security.ts",
  "lib/horris-api.ts",
  "lib/policy-display.ts",
  "lib/wallet-commands.ts",
  "lib/wallet-link.ts",
  "scripts/register-discord.mjs",
  ".env.example"
];

const contents = await Promise.all(required.map(async (path) => [path, await readFile(path, "utf8")]));
const joined = contents.map(([, content]) => content).join("\n");

for (const command of ["trade", "help", "connect-wallet", "wallet", "disconnect-wallet", "strategy", "risk", "perp-risk", "perp-status", "Analyze with Horris"]) {
  if (!joined.includes(command)) throw new Error(`Missing Discord command or surface: ${command}`);
}

for (const forbidden of ["NEXT_PUBLIC_DISCORD", "NEXT_PUBLIC_HORRIS", "eth_sendTransaction", "wallet_sendCalls", "writeContract(", "sendTransaction(", "privateKey", "seedPhrase", "mnemonic"]) {
  if (joined.includes(forbidden)) throw new Error(`Forbidden release primitive found: ${forbidden}`);
}

if (!joined.includes("verifyDiscordRequest")) throw new Error("Discord signature verification is missing");
if (!joined.includes("MAX_TIMESTAMP_SKEW_SECONDS")) throw new Error("Discord replay window is missing");
if (!joined.includes("DISCORD_CLIENT_SECRET")) throw new Error("Discord Activity server-side OAuth secret configuration is missing");
if (!joined.includes("commands.authorize") || !joined.includes("commands.authenticate")) throw new Error("Discord Activity OAuth handshake is missing");
if (!joined.includes("Generate a Horris AI trade plan directly in Discord")) throw new Error("Direct Discord /trade planning command is missing");
if (!joined.includes("requestActivityAdvisor") || !joined.includes("getMarketPrice")) throw new Error("Direct /trade AI or live price integration is missing");
if (!joined.includes("BLOCKED BY") || !joined.includes("HORRIS MATH")) throw new Error("Deterministic policy explanation is missing from direct /trade output");
if (!joined.includes("verifyMessage") || !joined.includes("personal_sign")) throw new Error("Wallet ownership verification flow is missing");
if (!joined.includes("MAX_WALLET_REQUEST_BYTES")) throw new Error("Wallet verification request body bounds are missing");
if (!joined.includes("KV_REST_API_URL") || !joined.includes("UPSTASH_REDIS_REST_URL")) throw new Error("Persistent wallet storage configuration is missing");
if (!joined.includes("walletPersistentStoreConfigured") || !joined.includes("walletLinkSecretConfigured")) throw new Error("Wallet deployment readiness checks are missing");
if (!joined.includes("WALLET_DISCORD_COMMANDS")) throw new Error("Wallet commands are missing from command registration/readiness surfaces");
if (!joined.includes("defaults to your linked wallet") || !joined.includes("getWalletLink(actorId)")) throw new Error("Linked wallet is not wired into /perp-status");
if (!joined.includes("commands.openExternalLink")) throw new Error("Explicit external wallet handoff is missing");
if (!joined.includes("commands.shareLink")) throw new Error("Discord-native sharing is missing");
if (!joined.includes("executionEnabled: false")) throw new Error("Execution lock evidence is missing");
if (!joined.includes("horris-policy")) throw new Error("Horris Core policy authority boundary is missing");

console.log("Horris Discord release gate passed.");
