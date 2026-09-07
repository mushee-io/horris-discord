# Horris Discord

Horris Discord is the Discord-native interface for Horris Core: an **AI trading desk inside Discord** with deterministic risk controls and verified wallet ownership.

The canonical chat flow is now direct: `/trade` accepts the trade prompt, planning balance and risk profile inside Discord, resolves a live UpDown price when needed, asks Horris AI for a bounded proposal, sends the proposal through canonical Horris policy, and returns PASS/BLOCK with exact failed policy rules. No Activity launch is required for `/trade`.

## What ships

- `/trade prompt balance risk` — direct AI trade plan inside Discord
- `/connect-wallet` — creates a short-lived secure wallet-verification link
- `/wallet` — shows the verified wallet for the Discord user
- `/disconnect-wallet` — removes the Discord ↔ wallet association
- `/perp-status [account]` — read live UpDown positions/orders; defaults to the linked wallet when `account` is omitted
- `/strategy amount balance risk`
- `/risk amount balance risk`
- `/perp-risk market side balance margin leverage entry stop take_profit risk`
- `/help`
- **Message context command:** `Apps → Analyze with Horris`
- **Discord Activity / mini-app** at `/` as an additional visual trading desk
- AI natural-language trade composer
- SAFE / BALANCED / DEGEN risk dial mapped to Horris profiles
- live read-only UpDown position/order dashboard
- Discord-native invite dialog and trade-setup sharing
- explicit external Horris Terminal handoff for wallet review

## Direct `/trade` flow

```text
Discord /trade
   ↓
Parse immutable user intent
   ↓
Live UpDown price when entry is not supplied
   ↓
Horris AI proposal (untrusted)
   ↓
Horris deterministic policy (authority)
   ↓
PASS or BLOCK + exact failed rules + deterministic risk math
```

The Discord response labels model commentary as non-authoritative. Account risk, stop distance, notional and projected stop-loss math come from deterministic Horris policy inputs, not from the model's prose.

## Wallet-link flow

```text
/connect-wallet
   ↓
short-lived signed Horris link
   ↓
external browser wallet
   ↓
one-time ownership message signature
   ↓
server verifies signature with viem
   ↓
Discord user ID ↔ wallet address stored in Redis/KV
   ↓
/wallet and /perp-status can use the verified wallet
```

The ownership signature is **not a transaction** and does not grant spending permission. Horris Discord never receives a seed phrase or private key.

## Security boundary

Horris Discord does **not** custody funds, receive recovery phrases/private keys, sign transactions, broadcast trades, or implement a second execution engine.

```text
Discord user
   ↓
Horris commands / Activity
   ↓ signed Discord interaction or Discord OAuth identity
Horris Discord backend
   ↓
Horris Core API
   ↓
Horris AI proposal (untrusted)
   ↓
Horris deterministic policy (authority)
   ↓
External Horris Terminal / wallet review
```

AI cannot approve itself. `executionEnabled` stays false throughout this repository.

## Production environment

```text
DISCORD_PUBLIC_KEY=
DISCORD_APPLICATION_ID=
DISCORD_CLIENT_SECRET=
DISCORD_BOT_TOKEN=

# Optional: instant guild-scoped command registration during development
DISCORD_GUILD_ID=

# Optional canonical public origin for wallet links
HORRIS_DISCORD_PUBLIC_URL=https://horris-discord.vercel.app

# Recommended explicit wallet-link HMAC secret.
# If omitted, DISCORD_CLIENT_SECRET is the server-only fallback.
WALLET_LINK_SECRET=

# Persistent wallet-link storage: either pair is supported.
KV_REST_API_URL=
KV_REST_API_TOKEN=
# or
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

HORRIS_API_BASE_URL=https://horris-delta.vercel.app
HORRIS_TERMINAL_URL=https://horris-delta.vercel.app/terminal
```

`DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `WALLET_LINK_SECRET` and Redis/KV tokens are server-only secrets. Never expose them through `NEXT_PUBLIC_` variables or commit them to Git.

## Discord Developer Portal setup

1. Create/select the Horris Discord application.
2. Enable **User Install** and **Guild Install**.
3. Configure the OAuth redirect required by the Discord Activity setup.
4. Under **Activities → URL Mappings**, map `/` to the deployed Horris Discord host.
5. Enable **Activities**.
6. Set the **Interactions Endpoint URL** to `https://<deployment>/api/discord`.
7. Add the production environment variables above.
8. Connect a persistent Vercel KV / Upstash Redis resource.
9. Deploy.
10. Run `npm run discord:register` from a trusted environment, or allow the configured postbuild registration to run.
11. Check `/api/health` and `/api/commands-status` before testing in Discord.

## Local development

```bash
npm install
npm run dev
```

Useful endpoints:

```text
/                           Activity UI
/api/discord                Discord interaction webhook
/api/oauth/token            Activity OAuth code exchange
/api/activity/compose       authenticated AI trade planning
/api/activity/status        authenticated read-only positions/orders
/api/wallet/challenge       one-time wallet ownership challenge
/api/wallet/verify          wallet signature verification
/api/health                 deployment readiness without exposing secrets
/api/commands-status        registered-command readiness
/wallet/connect             external wallet verification UI
```

Browser access to `/` renders a preview. Live Activity OAuth, invites and sharing require the app to run inside Discord. Direct slash commands use the signed interaction endpoint and do not require launching the Activity.

## Hardening

- Discord Ed25519 signature verification
- signed timestamp freshness checks
- replay cache for interaction IDs
- per-user/global interaction rate limits
- bounded interaction and wallet-verification request bodies
- Activity API requests require a valid Discord OAuth identity
- OAuth access tokens remain memory-only on the Activity client
- OAuth and bot secrets stay server-only
- wallet-link URLs are short-lived and HMAC protected
- wallet ownership signatures are verified server-side with viem
- production wallet associations require persistent Redis/KV storage
- Horris Core host validation blocks unsafe/private upstream origins
- upstream timeouts fail closed
- AI proposal context is revalidated before display
- exact failed Horris policy rules are surfaced on BLOCK
- explicit `horris-policy` authority check
- no signing/broadcast primitives in the Discord repository
- CI runs dependency audit, release safety checks, tests, typecheck and production build

## Product principle

**AI proposes → Horris checks → user reviews → wallet approves outside Discord.**

No guaranteed-profit claims and no automatic copying of shared trade setups.
