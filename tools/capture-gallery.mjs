// STUB (owner: teammate, Task 4 in docs/team/TEAMMATE.md).
// Capture 1920x1080 PNGs of the key screens into docs/submission/gallery/ for the Devpost gallery.
// Suggested approach: install playwright-core in a temp folder, launch the installed Chrome
// (channel: 'chrome' or executablePath), visit each URL below against BASE, wait for content,
// and save `NN-name.png`. Run a demo on /app/live first so the order and ledger screens have data.
//
//   BASE=http://localhost:8787 node tools/capture-gallery.mjs
//
// Screens:
//   01-landing-hero        /                       (top)
//   02-landing-voice-note  /                       (scroll to the voice-note act)
//   03-live-stage          /app/live               (mid-demo)
//   04-seller-draft        /app/seller/bagru-chhipa-prints
//   05-agent-approval      /app/agent              (approval card visible)
//   06-money-flow          /app/orders/<id>        (scroll to "Where the money went")
//   07-export-invoice      /api/orders/<id>/export-invoice
//   08-ledger              /app/ledger
throw new Error('Not implemented yet: see the comment at the top of this file.');
