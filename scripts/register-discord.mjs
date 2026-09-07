const token = process.env.DISCORD_BOT_TOKEN?.trim();
const applicationId = process.env.DISCORD_APPLICATION_ID?.trim();
const guildId = process.env.DISCORD_GUILD_ID?.trim();

if (!token) throw new Error("DISCORD_BOT_TOKEN is required to register commands.");
if (!applicationId) throw new Error("DISCORD_APPLICATION_ID is required to register commands.");

const risks = ["Conservative", "Balanced", "Aggressive"].map((name) => ({ name, value: name }));
const markets = ["BTC", "ETH", "CELO", "EURm", "JPYm", "NGNm", "AUDm", "GBPm"].map((name) => ({ name, value: name }));

const commands = [
  { name: "help", description: "Show Horris commands and safety boundary" },
  {
    name: "strategy", description: "Ask Horris Core for a stable strategy", options: [
      { name: "amount", description: "USDC amount", type: 10, required: true, min_value: 0.000001 },
      { name: "balance", description: "Available USDC balance", type: 10, required: true, min_value: 0 },
      { name: "risk", description: "Horris risk profile", type: 3, required: true, choices: risks }
    ]
  },
  {
    name: "risk", description: "Run Horris deterministic risk policy", options: [
      { name: "amount", description: "USDC amount", type: 10, required: true, min_value: 0.000001 },
      { name: "balance", description: "Available USDC balance", type: 10, required: true, min_value: 0 },
      { name: "risk", description: "Horris risk profile", type: 3, required: true, choices: risks }
    ]
  },
  {
    name: "perp-risk", description: "Analyze a perp proposal through Horris policy", options: [
      { name: "market", description: "UpDown market", type: 3, required: true, choices: markets },
      { name: "side", description: "Trade side", type: 3, required: true, choices: [{ name: "Long", value: "long" }, { name: "Short", value: "short" }] },
      { name: "balance", description: "Account balance in USD", type: 10, required: true, min_value: 0.000001 },
      { name: "margin", description: "Margin in USD", type: 10, required: true, min_value: 0.000001 },
      { name: "leverage", description: "Requested leverage", type: 10, required: true, min_value: 0.01 },
      { name: "entry", description: "Entry price", type: 10, required: true, min_value: 0.000001 },
      { name: "stop", description: "Stop-loss price", type: 10, required: true, min_value: 0.000001 },
      { name: "take_profit", description: "Optional take-profit price", type: 10, required: false, min_value: 0.000001 },
      { name: "risk", description: "Horris risk profile", type: 3, required: true, choices: risks }
    ]
  },
  {
    name: "perp-status", description: "Read live UpDown positions and orders for a Celo wallet", options: [
      { name: "account", description: "Celo wallet address", type: 3, required: true, min_length: 42, max_length: 42 }
    ]
  }
];

const endpoint = guildId
  ? `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`
  : `https://discord.com/api/v10/applications/${applicationId}/commands`;

const response = await fetch(endpoint, {
  method: "PUT",
  headers: {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify(commands)
});

if (!response.ok) {
  const text = await response.text();
  throw new Error(`Discord command registration failed (${response.status}): ${text.slice(0, 500)}`);
}

const registered = await response.json();
console.log(`Registered ${registered.length} Horris command(s) ${guildId ? `for guild ${guildId}` : "globally"}.`);
console.log(registered.map((command) => `/${command.name}`).join(", "));
