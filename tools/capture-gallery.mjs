// Capture 1920x1080 PNGs of the key screens into docs/submission/gallery/ for the Devpost gallery.
// Task 4 in docs/team/TEAMMATE.md. The first image becomes the Devpost thumbnail.
//
// One-time setup (keeps Playwright out of the repo's dependencies):
//   npm i --prefix /tmp/haat-pw playwright-core
// Then, with Haat running (npm start):
//   PW_DIR=/tmp/haat-pw node tools/capture-gallery.mjs
//
// Options (environment variables):
//   BASE=http://localhost:8787   the server to capture (a deployed URL works too)
//   ONLY=01,06                   capture only these shots
//   ORDER=<order id or number>   which order to use for the money-flow and invoice shots (default: the newest paid one)
//   CHROME_PATH=/path/to/chrome  if Chrome is not in the usual place
//
// Run a full sale on /app/live first: the order, money-flow and invoice shots need a paid order,
// and the live, seller and agent screens look best mid-demo. Shots that need an order are skipped
// (with a note) when there is none.

import { mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'docs/submission/gallery');
const BASE = (process.env.BASE || 'http://localhost:8787').replace(/\/$/, '');
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',').map((s) => s.trim().padStart(2, '0'))) : null;
const W = 1920;
const H = 1080;

async function loadPlaywright() {
  try {
    return await import('playwright-core');
  } catch {
    const dir = process.env.PW_DIR;
    const entry = dir && join(dir, 'node_modules/playwright-core/index.mjs');
    if (!entry || !existsSync(entry)) {
      console.error('playwright-core not found. Run: npm i --prefix /tmp/haat-pw playwright-core, then set PW_DIR=/tmp/haat-pw');
      process.exit(1);
    }
    return import(pathToFileURL(entry).href);
  }
}

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  return candidates.find((p) => existsSync(p));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Scroll a scroll-driven landing act to its end state, the way a reader would get there. */
async function scrollActToEnd(page, act) {
  await page.evaluate(async (act) => {
    const el = document.querySelector(`[data-act="${act}"]`);
    if (!el) throw new Error(`No [data-act="${act}"] on the page`);
    const top = el.getBoundingClientRect().top + scrollY;
    const end = top + el.offsetHeight - innerHeight - 40;
    for (let y = top; y <= end; y += 160) {
      scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    scrollTo(0, end);
  }, act);
  await sleep(1800);
}

async function scrollToText(page, text) {
  const loc = page.getByText(text, { exact: false }).first();
  if (await loc.count()) await loc.scrollIntoViewIfNeeded();
  await sleep(800);
}

async function findOrder() {
  try {
    const list = await (await fetch(`${BASE}/api/orders`)).json();
    if (process.env.ORDER) return list.find((o) => o.id === process.env.ORDER || o.number === process.env.ORDER);
    return list.find((o) => ['paid', 'fulfilled'].includes(o.status));
  } catch {
    return undefined;
  }
}

const order = await findOrder();

const SHOTS = [
  { n: '01', name: 'landing-hero', path: '/' },
  { n: '02', name: 'landing-voice-note', path: '/', prep: (p) => scrollActToEnd(p, 'note') },
  { n: '03', name: 'live-stage', path: '/app/live' },
  { n: '04', name: 'seller-draft', path: '/app/seller/bagru-chhipa-prints' },
  { n: '05', name: 'agent-approval', path: '/app/agent' },
  { n: '06', name: 'money-flow', needsOrder: true, path: () => `/app/orders/${order.id}`, prep: (p) => scrollToText(p, 'Where the money went') },
  { n: '07', name: 'export-invoice', needsOrder: true, path: () => `/api/orders/${order.id}/export-invoice` },
  { n: '08', name: 'ledger', path: '/app/ledger' },
];

const { chromium } = await loadPlaywright();
const executablePath = chromePath();
const browser = await chromium.launch(executablePath ? { executablePath } : { channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
mkdirSync(OUT, { recursive: true });

let saved = 0;
for (const shot of SHOTS) {
  if (ONLY && !ONLY.has(shot.n)) continue;
  const file = join(OUT, `${shot.n}-${shot.name}.png`);
  if (shot.needsOrder && !order) {
    console.log(`skip ${shot.n}-${shot.name}: no paid order yet (run a sale on /app/live, or set ORDER=)`);
    continue;
  }
  const path = typeof shot.path === 'function' ? shot.path() : shot.path;
  try {
    // Not 'networkidle': the app keeps a Server-Sent Events stream open, so the network never goes idle.
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.evaluate(() => document.fonts?.ready);
    await sleep(3500);
    if (shot.prep) await shot.prep(page);
    await page.screenshot({ path: file });
    console.log(`saved ${file.replace(ROOT + '/', '')}`);
    saved++;
  } catch (err) {
    console.log(`fail ${shot.n}-${shot.name}: ${err.message.split('\n')[0]}`);
  }
}

await browser.close();
console.log(`${saved} screenshot(s) in docs/submission/gallery/${order ? ` (order ${order.number})` : ''}`);
