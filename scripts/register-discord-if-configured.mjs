const required = ["DISCORD_BOT_TOKEN", "DISCORD_APPLICATION_ID"];
const missing = required.filter((name) => !process.env[name]?.trim());

if (missing.length) {
  console.log(`Skipping Discord command registration: missing ${missing.join(", ")}.`);
  process.exit(0);
}

console.log(process.env.DISCORD_GUILD_ID?.trim()
  ? "Registering Horris commands to the configured test guild…"
  : "Registering Horris commands globally…");

await import("./register-discord.mjs");
