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

## Issues found
_None yet._
