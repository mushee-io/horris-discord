# Horris Discord

Discord-only interface for the Horris protocol.

Horris Discord is intentionally **read-only / advisory**. It does not custody funds, sign transactions, broadcast trades, or bypass Horris policy. It calls the canonical Horris Core API for strategy, risk, perp-risk, and live UpDown position/order status.

## Commands

- `/help` — show available Horris commands and safety boundary.
- `/strategy amount balance risk` — request a stable strategy from Horris Core.
- `/risk amount balance risk` — run Horris deterministic policy against a stable strategy.
- `/perp-risk market side balance margin leverage entry stop take_profit risk` — run Horris perp risk analysis.
- `/perp-status account` — read live UpDown positions and orders for a Celo address.

## Architecture

```text
Discord user
   ↓
Horris Discord (this repo)
   ↓ signed interaction verification
Horris API client
   ↓
Horris Core API
   ↓
Horris deterministic policy / UpDown reads
```

The Discord app does not contain a second execution engine. Horris Core remains the authority.

## Environment

Copy `.env.example` to `.env.local` for local development.

Required for production:

- `DISCORD_PUBLIC_KEY` — Discord application public key.
- `DISCORD_APPLICATION_ID` — Discord application/client ID.
- `DISCORD_BOT_TOKEN` — used only by the command registration script. Do not expose it to the browser.
- `HORRIS_API_BASE_URL` — canonical Horris deployment, e.g. `https://horris-delta.vercel.app`.

Optional:

- `DISCORD_GUILD_ID` — registers commands to one guild instantly during development. Omit for global registration.

Never commit Discord tokens or private keys.

## Run locally

```bash
npm install
npm run dev
```

Interaction endpoint:

```text
http://localhost:3000/api/discord
```

Health endpoint:

```text
http://localhost:3000/api/health
```

## Register slash commands

```bash
npm run discord:register
```

Set Discord's **Interactions Endpoint URL** to:

```text
https://<your-deployment>/api/discord
```

Discord will validate the endpoint using an Ed25519 PING request.

## Deploy

Designed for Vercel / Next.js Node runtime. Add the production environment variables in the deployment dashboard, deploy, then run `npm run discord:register` locally or from a trusted environment.

## Safety boundary

- Every production interaction must pass Discord Ed25519 signature verification.
- Requests older/newer than five minutes are rejected.
- Interaction body size is bounded.
- Upstream calls are timeout-bounded.
- Discord replies are ephemeral by default.
- No wallet secret is accepted.
- No signing or transaction submission code exists in this repo.
- Horris Core performs the real deterministic policy checks.
