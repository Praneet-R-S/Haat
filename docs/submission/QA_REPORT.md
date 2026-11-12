# QA report (owner: teammate)

Report product bugs here; Praneet fixes `server/` and `web/`. Fix `site/` issues yourself.
For each issue: page, browser/device, steps, expected, actual, screenshot, ledger debug_id if a PayPal call failed.

## Checklist (desktop Chrome, one other browser, a real phone)
- [ ] Landing `/`: scroll top to bottom, voice-note play button, both CTAs, no sideways scroll on phone
- [ ] `/app/live`: Send voice note > Publish > Ask the buyer's agent > approve in PayPal > five autopilot steps > Hindi sale message + voice > UPI split > money flow sheet > stopwatch stops
- [ ] Listen buttons (सुनें) play Hindi audio
- [ ] UPI buttons: on a phone, tapping opens a UPI app (the demo handle will not complete a payment, which is expected); QR shows on desktop; "Sent" marks a share
- [ ] `/app/shop` > product > PayPal checkout as a human buyer; money flow estimate on the product page
- [ ] `/app/orders/<id>`: export invoice opens and prints; money flow matches the capture
- [ ] `/app/seller/bagru-chhipa-prints`: Hindi chat, wholesale invoice request ("send an invoice to ... for 20 pieces at $15") > agent confirms first > sends via Agent Toolkit > appears in Invoices tab
- [ ] `/app/ledger`: rows stream with debug ids; MCP tab; Dispute desk loads
- [ ] `/app/seller/kalai-terracotta`: Tamil reply
- [ ] Keyboard only: can you reach and use Send, Publish, Ask, PayPal button?

## Keyless pass (11 Nov, before the PayPal and Gemini keys were set)

Scripted sweep in Chrome at 1440x900 and 375x812 of `/`, `/app`, `/app/live`, `/app/shop`, a product page, both seller pages, `/app/agent`, `/app/ledger` and `/CREDITS`: no console errors, no failed requests (after fix 3), no sideways scroll, no em dashes in visible text. Anything that needs PayPal or Gemini (voice note, publish, buyer agent, checkout, autopilot, Tamil reply) is still to test.

## Issues found

1. **Fixed (site).** Landing page, paperwork pile on phones: the next slip hid words of the one below ("dabu.", "that fee and the conversion", "On ... protection."). On short phones (375x667) most descriptions were hidden. Fix in `site/site.css`: wider slips with tighter type and an even spread; on phones shorter than 760px, each slip shows its label and title only. Checked at 375x667, 375x812, 390x844 and 412x915: no word is covered.
2. **Fixed (product copy).** `/app/live`, `/app/shop` product pages and the seller "Makers" tab said every maker is paid "through PayPal Payouts". With our Indian sandbox account (`PAYOUT_MODE=upi`) the shares go out as UPI requests, so the copy now names both paths. The seller agent's instructions now follow `PAYOUT_MODE`, so it no longer tells the maker that PayPal Payouts paid them.
3. **Fixed (site).** `/CREDITS` had no icon, so the browser asked for `/favicon.ico` and got a 404. It now uses the landing page's inline icon.
4. **Fixed (deploy).** `render.yaml` did not set `PAYOUT_MODE`, so a deployment would start in `auto` and try PayPal Payouts first. It now sets `PAYOUT_MODE=upi`.
5. **Fixed (product).** First real purchase, 12 Nov (HT-01044): tracking failed with `400 INVALID_PARAMETER_VALUE` on `/carrier` (`IND_INDIAPOST` is not a PayPal carrier code), and the fallback to `OTHER` only fired on 422. `INDIA_POST` is accepted, so the autopilot now sends that, and the fallback also fires on a 400 that names `/carrier`. While debugging, tracking for HT-01044 was attached by hand with a probe script, so that order still shows the error in the app.

## Real purchases (12 Nov, US sandbox buyer)

| Order | Path | Paid | Settled | Invoice | Tracking on capture | UPI split | Hindi message |
|---|---|---|---|---|---|---|---|
| HT-01045 | approval link (`/checkout/return`) | $46.47 | fee $2.49, eligible | EXP/2026/HT-01045 | 201 | 4 makers, ₹2,001 | needs Gemini key |
| HT-01046 | approval link (`/checkout/return`) | $30.19 | fee $1.75, eligible | EXP/2026/HT-01046 | 201 | 3 makers, ₹1,000 | needs Gemini key |
| HT-01047 | JS SDK button on the product page | $47.19 | fee $2.53, eligible | EXP/2026/HT-01047 | 201 | 3 makers, ₹1,145 | needs Gemini key |

Without `GEMINI_API_KEY` the export invoice uses its built-in fallback (P0103, listing HS code, "compliance model unavailable") and the notify step shows an error. Re-run one purchase on `/app/live` once the key is set.
