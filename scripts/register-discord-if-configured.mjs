const required = ["DISCORD_BOT_TOKEN", "DISCORD_APPLICATION_ID"];
const missing = required.filter((name) => !process.env[name]?.trim());

if (missing.length) {
  console.log(`Skipping Discord command registration: missing ${missing.join(", ")}.`);
  process.exit(0);
}

console.log(process.env.DISCORD_GUILD_ID?.trim()
  ? "Registering Horris commands to the configured test guild…"
  : "Registering Horris commands globally…");

try {
  await import("./register-discord.mjs");
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown Discord registration error";
  console.error(`Discord command registration failed safely: ${message.slice(0, 900)}`);
  console.error("Horris deployment will continue. Check /api/commands-status after deploy for a safe diagnosis.");
  process.exitCode = 0;
}
