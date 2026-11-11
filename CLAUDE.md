# Haat: notes for Claude (read first)

Haat is our entry for the **PayPal AI Hackathon 2026** (Devpost). Hard deadline: **Thu 12 Nov 2026, 12:00 PT = Fri 13 Nov 2026, 01:30 IST**. Aim to submit by Thursday evening IST.

An export desk run by AI agents for India's small makers. A maker sends a photo and a Hindi/Tamil voice note; Gemini writes an English export listing; buyers abroad (or their AI shopping agents) pay with PayPal; after capture an autopilot writes the GST export invoice, adds tracking to the capture, splits the money between the cooperative's makers and tells the maker in their language. Read `README.md` for the full picture.

## Two people, two lanes

| Lane | Owner | Paths you may edit |
|---|---|---|
| **Build** (product code) | Praneet | `server/src/**`, `web/src/**`, `server/scripts/**`, `package*.json`, `render.yaml` |
| **Ship** (deploy, QA, video, submission, landing page) | Teammate | `docs/submission/**`, `tools/**`, `site/**`, `README.md` (only the "Testing it (judges)" and "Deploy" sections) |

Do not edit files in the other lane. If you find a bug in the other lane, write it in `docs/submission/QA_REPORT.md` (Ship) or tell the owner. This keeps `git pull` free of conflicts at 1 a.m.

Git: `git pull --rebase` before you start and before every push. Small commits, clear messages. Never force-push `main`.

## Run it

```bash
npm install
npm run build          # builds web/ into web/dist
npm start              # http://localhost:8787  (landing /, app /app, live demo /app/live)
```

Secrets live in `.env` (gitignored, copy `.env.example`). Never commit `.env`, never paste keys into files, issues or commit messages. Get the sandbox keys from Praneet privately.

- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV=sandbox`
- `GEMINI_API_KEY` (your own key from aistudio.google.com/apikey is fine)
- `PAYOUT_MODE=upi`: our sandbox business account is **Indian**. Indian PayPal accounts can receive international payments but cannot *send* PayPal Payouts, so each maker's share goes out as a UPI request from the cooperative (PayPal brings the dollars in, UPI carries the rupees the last mile). With a marketplace account outside India, set `PAYOUT_MODE=paypal`.
- Buyer approvals need a **non-Indian sandbox Personal account** (an Indian merchant cannot take a domestic payment). Create a US Personal account under developer.paypal.com > Testing Tools > Sandbox Accounts.

Useful: `POST /api/demo/reset` (or the Reset link on `/app/live`) clears orders and reloads the sample catalogue. `cd server && npx tsx --env-file=../.env scripts/smoke-paypal.ts` checks every PayPal API we use.

## House rules (judges and an automated reviewer will read everything)

- Be honest. Never invent numbers, customers, testimonials, awards or claims about makers ("master", "natural dye" unless said). Sample makers are illustrative; photos are stock (`server/seed/images/CREDITS.md`); India Post booking is simulated; fees are labelled estimates. Keep it that way in every doc and in the video.
- No em dashes in user-visible text. Use periods, commas, colons or parentheses.
- Design system: paper `#f3eee4`, ink `#1b1814`, indigo `#1f3a5f`, madder `#a23b2a`, turmeric `#c8902e`, leaf `#3f6b4a`; Newsreader (display), IBM Plex Sans + Plex Sans Devanagari (UI), IBM Plex Mono (numbers). No gradient text, no glow, no generic icon tiles.
- The Devpost "AI tools statement" must list every AI tool used (`docs/DEVPOST.md` has it). Do not remove AI disclosure anywhere.

## Map

- `server/src/paypal/` REST client with ledger hook, Orders/Catalog/Tracking/Payouts/Disputes/Webhooks, Agent Toolkit adapter
- `server/src/agents/` listing (photo+voice to listing), seller chat agent, buyer shopping agent, autopilot, dispute desk
- `server/src/mcp/` MCP server for outside agents (`POST /mcp`)
- `web/src/pages/` Live stage, seller phone, shopping agent, shop, order, ledger; `web/src/MoneyFlow.tsx` (every dollar traced); `web/src/UpiSplit.tsx`
- `site/` the scroll-driven landing page (static HTML/CSS/JS)
- `docs/` Devpost text, demo script, submission workspace
