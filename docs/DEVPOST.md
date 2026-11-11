# Devpost submission: Haat

**Tagline (max ~200 chars):** An export desk run by AI agents, settled by PayPal. India's makers list by voice note in their own language and sell to buyers abroad, and to their AI shopping agents.

## Inspiration

A block printer in Bagru can make cloth that sells in a Brooklyn boutique. Between his workshop and that buyer sit an English listing, an export price that survives fees and currency conversion, a trusted way to get paid, a GST export invoice under a Letter of Undertaking, an RBI purpose code, tracking for seller protection, and splitting the money with the people who printed it. Each step loses the long tail. PayPal is how small Indian sellers get paid from abroad (since 2021, cross-border is PayPal's whole business in India), so we built the desk that does everything around the payment.

At the same time, buyers are starting to shop through AI agents. Those agents can only buy from catalogues that are structured and payable. A weaver with no website is invisible to them. Haat fixes both.

## What it does

- **List by voice.** The maker sends a photo and a voice note in Hindi or Tamil. One multimodal Gemini call transcribes and translates it, writes an honest English listing, proposes an HS code with a reason, and extracts the asking price and stock. Haat prices it for export by working backwards from the maker's rupees through PayPal's fee, GST on the fee and the conversion spread. One tap publishes it to the shop and to the **PayPal Catalog**.
- **Sell to people and to agents.** Humans check out with **PayPal Smart Buttons**. A buyer-side **shopping agent** finds pieces and prepares a real **PayPal order** inside a spending mandate the buyer set; the human approves in PayPal, so the agent can never pay on its own. Haat is also an **MCP server**, so outside agents (Claude, ChatGPT, custom) can search the catalogue and start a PayPal checkout.
- **The autopilot after payment.** When the capture completes, the seller's export desk agent (1) reads what PayPal settled, including the fee and seller-protection status, (2) writes the GST export invoice under LUT with RBI purpose code P0103 and a checked HS code, (3) attaches India Post tracking to the PayPal capture, (4) works out each maker's share and sends it: through **PayPal Payouts** from a marketplace account, or, because PayPal accounts registered in India cannot send payouts, as one-tap UPI requests from the cooperative (PayPal brings the dollars in, UPI carries the rupees the last mile), and (5) tells the maker what happened, in their own language.
- **Talk to the desk.** The maker can say "send an invoice to the shop in Berlin for 20 dupattas" in Hindi; the seller agent confirms and sends a **PayPal invoice** with the official **PayPal Agent Toolkit**. It can also check invoices, transactions and disputes.
- **Dispute desk.** Reads real PayPal disputes, matches each to the order, and recommends sending proof of fulfilment (the tracking it already attached) or refunding. The seller decides; Haat calls `provide-evidence` or `accept-claim`.
- **Every dollar traced.** Each order draws the payment as threads: the buyer's dollars peel off into shipping, PayPal's fee (the real one from the capture), GST on the fee and conversion, and the rest runs on to the cooperative and splits into one strand per maker, named, in rupees. Product pages show the same picture as an estimate before you buy.
- **A desk you can listen to.** Every reply to the maker has a Listen button that speaks it in Hindi or Tamil (Gemini TTS), and sale news arrives as a voice note, for makers who would rather hear than read.
- **A ledger you can audit.** Every PayPal request, from our REST client and from the Agent Toolkit, streams live with its status, latency and `PayPal-Debug-Id`.

## How we built it

- **Server:** Node 24, Express 5, TypeScript, SQLite (`node:sqlite`), Server-Sent Events for live updates.
- **PayPal:** a typed REST client with token caching, idempotency keys and a ledger hook; Orders v2 (create, capture, `/track`), JS SDK buttons, Catalog Products, Payouts (with a UPI split for Indian accounts, which cannot send payouts), Disputes (`provide-evidence` multipart, `accept-claim`), webhook registration and signature verification, and the **@paypal/agent-toolkit** tools (invoicing, transactions, insights, disputes). We wrote an adapter that converts the toolkit's Zod schemas into Gemini function declarations, so our Gemini agents call PayPal's own tool implementations.
- **AI:** Google Gemini via `@google/genai`: multimodal structured output (photo + audio to listing), a tool-calling agent loop for the seller and buyer agents, a compliance step for the export paperwork, and dispute advice. Model fallback keeps a demo alive when one model is overloaded.
- **Agentic commerce, built for trust:** agents prepare and explain, PayPal and people move the money. Spending mandates are enforced before PayPal is ever called, every purchase ends in a human approval inside PayPal, every agent action and PayPal call is on an auditable ledger, and the listing agent is forbidden from claims the maker never made. The same tools are exposed through an MCP server (`@modelcontextprotocol/sdk`, Streamable HTTP) exposing search, details, checkout and order status.
- **Frontend:** React 19, Vite, Tailwind CSS 4, with a design system built from the craft: paper and ink, natural indigo, madder and turmeric, Newsreader and IBM Plex (including Plex Devanagari for Hindi).

## Challenges we ran into

- Making the maker's rupees survive the trip. Pricing has to gross up for a percentage fee, a fixed fee, GST on the fee and the conversion spread at the same time, and the reply to the maker must quote the number they will actually receive, not the number they asked for.
- Keeping the agents honest. Listing copy for craft drifts towards claims nobody made ("natural dye", "master artisan"). The prompts forbid unsupported claims, and the UI shows the maker's original words next to the English.
- Capturing exactly once across three paths (JS SDK, approval link for MCP agents, webhook) with idempotency keys and an in-flight guard.

## Accomplishments we're proud of

- A Hindi voice note becomes a priced export listing in seconds, and the Live stage times the whole loop with a stopwatch: voice note to makers' split.
- An AI shopping agent buys from a maker with no website, and the maker's own agent does the export paperwork and splits the money for the cooperative, with PayPal carrying the payment across the border.
- We designed around a real constraint instead of hiding it: PayPal accounts registered in India receive from abroad but cannot send PayPal Payouts, so the makers' shares go out as UPI requests from the cooperative. With a marketplace account outside India, the same step uses PayPal Payouts (`PAYOUT_MODE=paypal`).
- Every PayPal call is visible and auditable.

## What we learned

The hard part of cross-border commerce for small sellers is not the payment, it is everything around it, and most of that is language, judgement and paperwork: exactly what agents are good at, as long as money movement stays with PayPal and a human.

## What's next

WhatsApp as the seller channel, real India Post DNK booking, e-FIRA matching from PayPal transaction search, PayPal Vault for buyer mandates that can pay without a click under a limit, and pilots with weaver cooperatives.

## Built with

PayPal Orders v2, PayPal JS SDK, PayPal Catalog Products, PayPal Payouts, UPI deep links, PayPal Invoicing, PayPal Disputes, PayPal Webhooks, PayPal Agent Toolkit, Model Context Protocol, Google Gemini, Node.js, Express, TypeScript, SQLite, React, Vite, Tailwind CSS.

## AI tools statement

- **Google Gemini API** (`gemini-3.5-flash` primary; `gemini-3.6-flash`, `gemini-3.8-flash`, `gemini-3.1-flash-lite` as automatic fallbacks): in the product, for multimodal listing generation from photos and voice notes, transcription and translation, the seller and buyer tool-calling agents, export-paperwork reasoning, maker notifications, and dispute advice.
- **Gemini TTS** (`gemini-3.8-flash-tts`): speaks agent replies and sale updates to makers in their language, and generated the sample Hindi voice note used by the "Try it with a sample" button.
- **PayPal Agent Toolkit**: PayPal's tool implementations used by the seller agent.
- **Claude (Anthropic) via Claude Code**: used by the team as a coding assistant during development.
- Product photography is stock (Unsplash and Pexels licences, credits in `server/seed/images/CREDITS.md`); no AI-generated images are presented as real products.

## What is real, and what is not

We would rather you trust a smaller claim than doubt a bigger one.

| | Status |
|---|---|
| Photo + Hindi voice note to listing (Gemini), spoken replies | Real, runs live |
| Listing published to the PayPal Catalog | Real sandbox call |
| Buyer agent creates a PayPal order inside a mandate; human approves in PayPal | Real sandbox calls |
| Capture, export invoice, tracking on the capture, makers' split, Hindi sale voice note | Real sandbox calls (verified on: TODO date after the first full purchase) |
| Wholesale invoice through the PayPal Agent Toolkit | Real sandbox calls |
| MCP endpoint | Tested with the official MCP client (search, details, checkout, status) |
| Makers' split | UPI requests (Indian account); sample UPI IDs on a demo handle that cannot receive money |
| India Post booking | Simulated (tracking number format is real and is attached to the real PayPal capture) |
| WhatsApp channel | Not built; the seller chat is a web chat shaped like the phone the maker already uses |
| PayPal fee, GST on fee, conversion spread | Estimates, labelled in the UI; the fee on an order is the real one from the capture |
| Makers and photos | Sample profiles; stock photography with credits |

## Testing instructions

Try it in two minutes: open the app, go to **Live**, press **Send Rafiq's voice note**, tap **Publish** on the phone, press **Ask the buyer's agent**, approve in the PayPal popup with the sandbox buyer below, and watch the stopwatch. Full steps in the README section "Testing it (judges)".

Sandbox buyer (US Personal sandbox account): TODO email / TODO password
