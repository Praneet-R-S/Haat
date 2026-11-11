# Teammate brief: the Ship lane

You own getting Haat **deployed, tested, filmed and submitted**. Praneet owns the product code. Work through the tasks below in order with your Claude. Each task names the file you fill in; those files already exist as templates.

## Before you start (10 minutes)

1. Clone the repo, then `npm install`.
2. Get the PayPal sandbox **Client ID and Secret** from Praneet privately (WhatsApp/DM, never in git). Copy `.env.example` to `.env`, fill them in, set `PAYOUT_MODE=upi`, and add your own `GEMINI_API_KEY`.
3. `npm run build` then `npm start`, open http://localhost:8787/app/live and press **Send Rafiq's voice note**. If a listing appears on the phone within about 30 seconds, you're set up.
4. Open Claude Code in the repo folder and paste this:

> Read CLAUDE.md and docs/team/TEAMMATE.md. I am the teammate in the Ship lane. Only edit the paths my lane owns. Start with task 1 and check each one off in docs/submission/SUBMISSION_CHECKLIST.md as we finish it.

## Task 1: sandbox buyer account (15 min). File: `README.md` (Testing section only)

- On developer.paypal.com > Testing Tools > Sandbox Accounts, create a **Personal** account with country **United States**. Our merchant account is Indian and cannot take a domestic Indian payment, so the buyer must be outside India.
- Do one full purchase on `/app/live`: send voice note > Publish > Ask the buyer's agent > approve in the PayPal popup with that US account. Confirm the five autopilot steps go green, Rafiq's phone gets a Hindi sale message plus the UPI split card, and the "Where the money went" sheet appears.
- Put the sandbox buyer email and password in the README line that says "add the sandbox personal account email and password here". (Sandbox test logins are meant to be shared with judges; real logins never are.)
- If anything fails, write the exact error and the ledger row (with its debug_id) in `docs/submission/QA_REPORT.md` and tell Praneet.

## Task 2: deploy (45 min, do it early: webhooks and judges need it). File: `docs/submission/DEPLOYMENT.md`

- Render (we have `render.yaml`): New > Blueprint > pick the GitHub repo. Set env vars: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `GEMINI_API_KEY`, `PAYOUT_MODE=upi`, and `PUBLIC_URL` = the https URL Render gives you. Redeploy after setting `PUBLIC_URL`.
- On first boot the logs print `PayPal webhook registered: <id>`. Add that as `PAYPAL_WEBHOOK_ID` and redeploy, so webhook signatures are verified.
- The free plan sleeps and its disk is wiped on redeploy. That's fine (the demo reseeds itself), but open the URL a minute before judging or recording.
- Run the Task 1 purchase again on the deployed URL. Record the URL and what you tested in `DEPLOYMENT.md`.
- Judges have until 15 Dec, so keep the deployment up until then. The free plan sleeps after ~15 minutes idle and takes ~1 minute to wake; Render Starter (paid) does not sleep. Decide with Praneet.
- Test MCP from Claude Desktop against the deployed URL: Settings > Connectors > Add custom connector > `https://<deployed>/mcp`, then ask Claude to find indigo cloth from Bagru and start a checkout. Note the result in QA_REPORT.md. Locally, `cd server && CHECKOUT=1 npx tsx scripts/mcp-check.ts https://<deployed>/mcp` checks the same thing.

## Task 3: QA pass (45 min). File: `docs/submission/QA_REPORT.md`

Walk the checklist in that file on desktop Chrome, one other browser, and a real phone. **Do not fix product code** (`server/`, `web/`); report it with steps and a screenshot. You may fix anything in `site/` (the landing page) yourself. Known small issue there: on a phone, the first two paper slips in the "paperwork pile" cover a few words.

## Task 4: gallery screenshots (30 min). Folder: `docs/submission/gallery/`

`tools/capture-gallery.mjs` is a stub. Ask Claude to finish it with Playwright (install `playwright-core` in a temp folder, use the installed Chrome) and capture 1920x1080 PNGs of: the landing hero, the voice-note peak on the landing page, `/app/live` mid-demo, the seller phone draft card, the buyer agent approval card, the "Where the money went" sheet, the export invoice, the ledger. These become the Devpost image gallery (first image = thumbnail).

## Task 5: the video (2 hours, the most important task). File: `docs/submission/VIDEO.md`

- Follow `docs/DEMO_SCRIPT.md` exactly: one golden path, one real sale, stopwatch running. **Under 3:00** is a hard rule. Record at 1920x1080, with the browser zoomed so text is readable.
- Press **Reset** on `/app/live` before each take. Turn sound on: the Hindi voice note and the spoken replies are part of the story.
- Voice-over: calm, plain English. No background music unless it's royalty-free with a licence you can show.
- Show it working for real: the PayPal popup approval and the ledger rows are proof. If a Gemini call is slow, cut the wait in editing; never fake a result.
- Upload to YouTube as **Public**, title "Haat: an export desk run by AI agents, settled by PayPal". Put the link in `VIDEO.md`.

## Task 6: Devpost submission (45 min). File: `docs/submission/SUBMISSION_CHECKLIST.md`

- On Devpost, create the project, add Praneet as a team member, and paste the sections from `docs/DEVPOST.md`.
- Repo URL: make sure the MIT licence shows in the GitHub "About" box. Add the video link, the deployed URL, the gallery images, and the testing instructions with the sandbox buyer login.
- Tick every box in the checklist. **Submit by Thursday 12 Nov, 9 pm IST.** The hard cutoff is 1:30 am, but Devpost slows down near deadlines.

## Optional, if time is left

- Dispute desk: log in to sandbox.paypal.com as the buyer, open a dispute on a paid order, then try Ledger > Dispute desk. Note the result in QA_REPORT.md.
- Tamil seller: on `/app/seller/kalai-terracotta`, send a photo with a typed Tamil message and check the reply is in Tamil.
