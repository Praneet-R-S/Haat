# Demo video: one golden path (target 2:50, hard limit 3:00)

Show one complete sale, live, on `/app/live`, with the stopwatch running. Everything else gets ten seconds at the end.

**Before each take**
- Open `/app/live` and press **Reset** (top right). Keep the landing page `/` open in another tab.
- Log out of sandbox.paypal.com so the approval popup is clean. Have the US sandbox buyer login ready.
- Sound on: the Hindi voice note and the spoken replies are part of the story.
- Phone pane: keep **EN on** so every Hindi message has its English line on screen. Also add subtitles in the edit for any Hindi audio.
- Record at 1920x1080 with the browser zoomed so text is readable. If a Gemini call is slow, cut the wait in editing; never fake a result.

| Time | Screen | Voice-over |
|---|---|---|
| 0:00 to 0:12 | Landing page hero, slow scroll | "Rafiq prints cloth by hand in Bagru, Rajasthan. Buyers abroad want it. What stops the sale isn't the cloth. It's everything around the payment." |
| 0:12 to 0:25 | Landing page: the paperwork pile | "An English listing, an export price, a way to get paid, a GST export invoice, a purpose code, tracking, and splitting the money with the people who printed it. So we built him an export desk, run by agents and settled by PayPal." |
| 0:25 to 0:55 | `/app/live`: press **Send Rafiq's voice note** (stopwatch starts). Transcript appears, then the listing. Tap **सुनें** for two seconds. Tap **Publish**; the Catalog row lands on the ledger | "He sends a photo and a voice note in Hindi. Gemini hears it, writes the listing in English, finds the customs code and prices it so his rupees survive PayPal's fee, GST and conversion. It answers him in Hindi, out loud. One tap, and it's live in the PayPal Catalog." |
| 0:55 to 1:30 | Press **Ask the buyer's agent**. Tool chips, results, the approval card; `POST /v2/checkout/orders` on the ledger. Approve in the PayPal popup | "His next buyer might not be a person. This shopping agent finds the cloth and creates a real PayPal order inside the buyer's budget. But it cannot pay. Trust stays with the human, who approves in PayPal." |
| 1:30 to 2:10 | Capture row on the ledger; five autopilot steps go green; the Hindi sale message arrives on the phone and plays as a voice note; the UPI split card; stopwatch stops; the **Where the money went** sheet rises | "The moment PayPal captures, Rafiq's desk takes over: the export invoice under LUT with purpose code P0103, India Post tracking on the PayPal capture for seller protection, and each printer's share. Then it tells Rafiq, in Hindi. And here is every dollar of that payment, traced to the three people who made the cloth." |
| 2:10 to 2:25 | Open the export invoice; then the UPI split card | "A design decision worth saying out loud: PayPal accounts registered in India can receive from abroad but cannot send PayPal Payouts. So PayPal brings the dollars in, and UPI carries each maker's share the last mile." |
| 2:25 to 2:40 | Ten-second montage, captioned "Also built": MCP connection details, a wholesale invoice sent by chat through the Agent Toolkit, the dispute desk | "Also built: outside AI agents can shop Haat over MCP, wholesale invoices go out through PayPal's Agent Toolkit, and a dispute desk drafts evidence from the tracking it already attached." |
| 2:40 to 2:50 | Stopwatch close-up, then the landing page close | "From a voice note in Bagru to a paid, documented, split sale abroad, in [read the real time off the stopwatch]. Haat." |

Only show a feature in the montage if it was tested for real. The MCP endpoint is tested with the official MCP client (`server/scripts/mcp-check.ts`); show a Claude Desktop shot only if it was connected to the deployed URL.
