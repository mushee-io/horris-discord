# Horris Discord

Horris Discord is the Discord-native interface for Horris Core: an **AI trading desk inside Discord** with deterministic risk controls.

Users can launch the Activity with `/trade`, describe a perp idea in normal language, let Horris AI propose margin/leverage/stop/target, and then let canonical Horris policy decide whether the plan passes. Final signing remains an explicit wallet action outside Discord.

## What ships

- **Discord Activity / mini-app** at `/`
- `/trade` — launches the Activity directly using Discord's Activity callback
- `/help`
- `/strategy amount balance risk`
- `/risk amount balance risk`
- `/perp-risk market side balance margin leverage entry stop take_profit risk`
- `/perp-status account`
- **Message context command:** `Apps → Analyze with Horris`
- AI natural-language trade composer
- SAFE / BALANCED / DEGEN risk dial mapped to Horris profiles
- live read-only UpDown position/order dashboard
- Discord-native invite dialog
- Discord-native trade setup sharing
- explicit external Horris Terminal handoff for wallet review

## Security boundary

Horris Discord does **not** custody funds, receive seed phrases/private keys, sign transactions, broadcast trades, or implement a second execution engine.

```text
Discord user
   ↓
Horris Activity / commands
   ↓ Discord OAuth + signed interaction verification
Horris Discord backend
   ↓
Horris Core API
   ↓
Horris AI proposal (untrusted)
   ↓
Horris deterministic policy (authority)
   ↓
External Horris Terminal / wallet approval
```

AI cannot approve itself. `executionEnabled` stays false throughout this repository.

## Production environment

```text
DISCORD_PUBLIC_KEY=
DISCORD_APPLICATION_ID=
DISCORD_CLIENT_SECRET=
DISCORD_BOT_TOKEN=
HORRIS_API_BASE_URL=https://horris-delta.vercel.app
HORRIS_TERMINAL_URL=https://horris-delta.vercel.app/terminal
```

Optional for instant development command registration:

```text
DISCORD_GUILD_ID=
```

`DISCORD_CLIENT_SECRET` and `DISCORD_BOT_TOKEN` are server-only secrets. Never expose either through a `NEXT_PUBLIC_` variable.

## Discord Developer Portal setup

1. Create/select the Horris Discord application.
2. Enable **User Install** and **Guild Install**.
3. Under OAuth2 add a redirect URI (Discord's Activity flow handles returning to the Activity; `https://127.0.0.1` is sufficient for the required placeholder during setup).
4. Under **Activities → URL Mappings**, map `/` to the deployed Horris Discord host.
5. Enable **Activities**.
6. Set the **Interactions Endpoint URL** to `https://<deployment>/api/discord`.
7. Add the environment variables above to the deployment.
8. Deploy.
9. Run `npm run discord:register` from a trusted environment to register `/trade`, advisory commands, and `Analyze with Horris`.

Discord also creates a default Activity entry point when Activities are enabled. `/trade` is an additional fast launch path.

## Local development

```bash
npm install
npm run dev
```

Useful endpoints:

```text
/                         Activity UI
/api/discord              Discord interaction webhook
/api/oauth/token          Activity OAuth code exchange
/api/activity/compose     authenticated AI trade planning
/api/activity/status      authenticated read-only positions/orders
/api/health               safe deployment readiness
```

Browser access to `/` renders a preview. Live OAuth, AI planning, invites, sharing and Activity launch behavior require the app to run inside Discord.

## Hardening

- Discord Ed25519 signature verification
- signed timestamp freshness checks
- replay cache for interaction IDs
- per-user/global interaction rate limits
- bounded bodies and responses
- Activity API requests require a valid Discord OAuth identity
- OAuth access tokens remain memory-only on the Activity client
- OAuth client secret stays server-only
- Horris Core host validation blocks unsafe/private upstream origins
- upstream timeouts fail closed
- AI proposal context is revalidated before display
- explicit `horris-policy` authority check
- no signing/broadcast primitives in the repo
- wallet handoff uses Discord `openExternalLink`
- CI runs dependency audit, release safety checks, tests, typecheck and production build

## Product principle

**AI proposes → Horris checks → user reviews → wallet approves.**

No guaranteed-profit claims and no automatic copying of shared trade setups.
