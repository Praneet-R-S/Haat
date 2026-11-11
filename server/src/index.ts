import express, { type Request, type Response, type NextFunction } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { bus } from './events/bus.ts';
import { DATA_DIR, activity, invoices, makers, orders, products, sellers, wipeDemo } from './db/index.ts';
import { seedIfEmpty } from './db/seed.ts';
import { paypalConfigured, paypalEnv } from './paypal/client.ts';
import { ensureWebhook, getOrder, verifyWebhook } from './paypal/api.ts';
import { aiConfigured, models } from './ai/gemini.ts';
import { draftListing } from './agents/listing.ts';
import { sellerMessage, sellerThread } from './agents/seller.ts';
import { buyerMessage } from './agents/buyer.ts';
import { disputesWithAdvice, respondToDispute } from './agents/disputes.ts';
import { AUTOPILOT_STEPS } from './agents/autopilot.ts';
import { captureAndFulfil, publicUrl, publishListing, startCheckout } from './domain/commerce.ts';
import { renderExportInvoice } from './domain/exportInvoice.ts';
import { priceForExport, FEES } from './domain/pricing.ts';
import { handleMcp } from './mcp/server.ts';
import { voiceFor } from './domain/voice.ts';
import { toolkitToolNames } from './paypal/toolkit.ts';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '30mb' }));

const ROOT = resolve(import.meta.dirname, '../..');
const WEB_DIST = resolve(ROOT, 'web/dist');
const SITE_DIR = resolve(ROOT, 'site');

type H = (req: Request, res: Response) => Promise<unknown> | unknown;
const route = (h: H) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await h(req, res);
    if (!res.headersSent && out !== undefined) res.json(out);
  } catch (err) {
    next(err);
  }
};

/** Stream agent events as NDJSON lines so the UI can render tool calls as they happen. */
function ndjson(res: Response) {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  return (obj: unknown) => res.write(JSON.stringify(obj) + '\n');
}

// ------------------------------------------------------------------ status

app.get(
  '/api/health',
  route(() => ({
    ok: true,
    paypal: { configured: paypalConfigured(), env: paypalEnv(), clientId: process.env.PAYPAL_CLIENT_ID ?? null, toolkitTools: toolkitToolNames() },
    ai: { configured: aiConfigured(), models: models() },
    publicUrl: publicUrl(),
    webhook: Boolean(process.env.PAYPAL_WEBHOOK_ID),
    fees: FEES,
  })),
);

app.get('/api/events', (req, res) => {
  const ch = typeof req.query.channels === 'string' && req.query.channels ? req.query.channels.split(',') : null;
  bus.attach(res, ch, req.query.replay !== '0');
});

app.get('/api/ledger', route(() => bus.recent((e) => e.type === 'ledger').slice(-150).reverse().map((e) => e.data)));

// ------------------------------------------------------------------ catalog

app.get('/api/sellers', route(() => sellers.all().map((s) => ({ ...s, makers: makers.forSeller(s.id), products: products.all({ sellerId: s.id, status: 'live' }).length }))));

app.get(
  '/api/sellers/:id',
  route((req) => {
    const s = sellers.get(String(req.params.id));
    if (!s) throw Object.assign(new Error('Not found'), { status: 404 });
    return {
      ...s,
      makers: makers.forSeller(s.id),
      products: products.all({ sellerId: s.id }),
      orders: orders.all({ sellerId: s.id }).map((o) => ({ ...o, product: products.get(o.product_id) })),
      invoices: invoices.all(s.id),
      activity: activity.recent({ sellerId: s.id, limit: 40 }),
      thread: sellerThread(s.id),
    };
  }),
);

app.get(
  '/api/products',
  route((req) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const list = q ? products.search(q) : products.all({ status: 'live' });
    return list.map((p) => ({ ...p, seller: sellers.get(p.seller_id) }));
  }),
);

app.get(
  '/api/products/:id',
  route((req) => {
    const p = products.get(String(req.params.id));
    if (!p) throw Object.assign(new Error('Not found'), { status: 404 });
    return { ...p, seller: sellers.get(p.seller_id), makers: makers.forSeller(p.seller_id) };
  }),
);

app.get('/api/quote', route(async (req) => priceForExport(Number(req.query.cost_inr ?? 1000), Number(req.query.weight_g ?? 400))));

// ------------------------------------------------------------------ seller studio

app.post(
  '/api/studio/draft',
  route(async (req) => {
    const { sellerId, images, audio, text } = req.body ?? {};
    return draftListing({ sellerId, images: images ?? [], audio, text });
  }),
);

app.post(
  '/api/tts',
  route(async (req) => {
    const text = String(req.body?.text ?? '').trim();
    if (!text) throw Object.assign(new Error('Nothing to say'), { status: 400 });
    return { url: await voiceFor(text) };
  }),
);

app.post('/api/studio/draft-stream', async (req, res) => {
  const send = ndjson(res);
  try {
    const { sellerId, images, audio, text } = req.body ?? {};
    const out = await draftListing({ sellerId, images: images ?? [], audio, text, onEvent: (e) => send({ type: 'event', event: e }) });
    send({ type: 'draft', ...out });
  } catch (err: any) {
    send({ type: 'error', error: err.message });
  }
  res.end();
});

app.post('/api/studio/publish', route(async (req) => publishListing(req.body.productId, { priceUsd: req.body.priceUsd, actor: 'seller' })));

app.post('/api/sellers/:id/message', async (req, res) => {
  const send = ndjson(res);
  try {
    const out = await sellerMessage({ sellerId: String(req.params.id), text: req.body?.text, audio: req.body?.audio, onEvent: (e) => send({ type: 'event', event: e }) });
    send({ type: 'reply', ...out });
  } catch (err: any) {
    send({ type: 'error', error: err.message });
  }
  res.end();
});

// ------------------------------------------------------------------ buyer agent

app.post('/api/buyer/message', async (req, res) => {
  const send = ndjson(res);
  try {
    const { sessionId, text, mandate } = req.body ?? {};
    const out = await buyerMessage({
      sessionId: String(sessionId || 'anon'),
      text: String(text ?? ''),
      mandate: { budgetUsd: Number(mandate?.budgetUsd ?? 120), shipCountry: String(mandate?.shipCountry ?? 'United States'), note: mandate?.note },
      onEvent: (e) => send({ type: 'event', event: e }),
    });
    send({ type: 'reply', ...out });
  } catch (err: any) {
    send({ type: 'error', error: err.message });
  }
  res.end();
});

// ------------------------------------------------------------------ checkout

app.post(
  '/api/checkout/orders',
  route(async (req) => {
    const r = await startCheckout({ productId: req.body.productId, quantity: req.body.quantity, channel: 'storefront', actor: 'storefront' });
    return { id: r.paypalOrderId, number: r.order.number, approveUrl: r.approveUrl };
  }),
);

app.post(
  '/api/checkout/orders/:id/capture',
  route(async (req) => {
    const o = await captureAndFulfil(String(req.params.id), req.body?.actor === 'buyer-agent' ? 'buyer-agent' : 'storefront');
    return { ...o, product: products.get(o.product_id) };
  }),
);

// PayPal redirect target for approval links (MCP agents and links opened outside the JS SDK).
app.get('/checkout/return', async (req, res) => {
  const token = String(req.query.token ?? '');
  try {
    const o = await captureAndFulfil(token, 'mcp-agent');
    res.redirect(`/app/orders/${o.id}?paid=1`);
  } catch (err: any) {
    res.status(400).send(`<p style="font:16px system-ui;padding:40px">Payment could not be completed: ${String(err.message).replace(/</g, '&lt;')}</p>`);
  }
});
app.get('/checkout/cancel', (_req, res) => res.redirect('/app/shop?cancelled=1'));

app.get(
  '/api/orders',
  route(() => orders.all().map((o) => ({ ...o, product: products.get(o.product_id), seller: sellers.get(o.seller_id) }))),
);

app.get(
  '/api/orders/:id',
  route((req) => {
    const o = orders.get(String(req.params.id));
    if (!o) throw Object.assign(new Error('Not found'), { status: 404 });
    return {
      ...o,
      product: products.get(o.product_id),
      seller: sellers.get(o.seller_id),
      activity: activity.recent({ orderId: o.id, limit: 30 }),
      steps: AUTOPILOT_STEPS,
      autopilot: bus.recent((e) => e.type === 'autopilot.step' && e.channel === `order:${o.id}`).map((e) => e.data),
    };
  }),
);

// The cooperative confirms it sent a maker's UPI share (UPI has no callback to a sandbox app).
app.post(
  '/api/orders/:id/split/:idx/paid',
  route((req) => {
    const o = orders.get(String(req.params.id));
    if (!o?.payout?.items) throw Object.assign(new Error('No split on this order'), { status: 404 });
    const idx = Number(req.params.idx);
    const items = o.payout.items.map((it: any, i: number) => (i === idx ? { ...it, paid_at: it.paid_at ?? new Date().toISOString() } : it));
    const payout = { ...o.payout, items, status: items.every((it: any) => it.paid_at) ? 'SENT' : 'READY' };
    orders.update(o.id, { payout });
    const it = items[idx];
    activity.add({ seller_id: o.seller_id, order_id: o.id, kind: 'payout.upi.sent', title: `${it.name} sent ₹${it.inr} by UPI (marked by the cooperative)`, detail: {} });
    bus.emitEvent('split.updated', { orderId: o.id, payout }, `seller:${o.seller_id}`);
    bus.emitEvent('split.updated', { orderId: o.id, payout }, `order:${o.id}`);
    return payout;
  }),
);

app.get('/api/orders/:id/export-invoice', (req, res) => {
  const o = orders.get(String(req.params.id));
  if (!o) return res.status(404).send('Not found');
  res.type('html').send(renderExportInvoice(o, products.get(o.product_id)!, sellers.get(o.seller_id)!));
});

app.get('/api/orders/:id/paypal', route(async (req) => (await getOrder(String(req.params.id), 'ops')).data));

// ------------------------------------------------------------------ disputes

app.get('/api/disputes', route(() => disputesWithAdvice()));
app.post('/api/disputes/:id/respond', route((req) => respondToDispute(String(req.params.id), req.body.action, String(req.body.note ?? ''))));

app.get('/api/activity', route(() => activity.recent({ limit: 80 })));

// Reset the sandbox demo (keeps PayPal catalog ids by re-syncing). Optional token guard for hosted demos.
app.post(
  '/api/demo/reset',
  route(async (req) => {
    if (process.env.DEMO_RESET_TOKEN && req.body?.token !== process.env.DEMO_RESET_TOKEN) throw Object.assign(new Error('Bad token'), { status: 403 });
    wipeDemo();
    await seedIfEmpty();
    return { ok: true };
  }),
);

// ------------------------------------------------------------------ webhooks

app.post(
  '/api/webhooks/paypal',
  route(async (req) => {
    const event = req.body;
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    let verified = false;
    if (webhookId) {
      try {
        verified = await verifyWebhook(req.headers as any, event, webhookId);
      } catch {
        verified = false;
      }
      if (!verified) return { ok: false, verified };
    }
    bus.emitEvent('webhook', { type: event?.event_type, id: event?.id, verified, resource: event?.resource?.id });
    if (event?.event_type === 'CHECKOUT.ORDER.APPROVED' && event?.resource?.id) {
      // Buyer approved but the client never called capture (closed tab, agent link): capture server-side.
      captureAndFulfil(event.resource.id, 'webhook').catch(() => {});
    }
    return { ok: true, verified };
  }),
);

// ------------------------------------------------------------------ MCP + static

app.post('/mcp', (req, res) => handleMcp(req, res).catch((err) => res.status(500).json({ error: err.message })));
app.get('/mcp', (_req, res) => res.status(405).json({ error: 'Use POST (Streamable HTTP, stateless)' }));

app.use('/uploads', express.static(resolve(DATA_DIR, 'uploads'), { maxAge: '7d' }));
app.use('/seed', express.static(resolve(ROOT, 'server/seed/images'), { maxAge: '7d' }));
if (existsSync(WEB_DIST)) {
  app.use('/app', express.static(WEB_DIST, { index: false, maxAge: '1h' }));
  app.get(/^\/app(\/.*)?$/, (_req, res) => res.sendFile(resolve(WEB_DIST, 'index.html')));
}
if (existsSync(SITE_DIR)) app.use('/', express.static(SITE_DIR, { extensions: ['html'] }));

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  res.status(status).json({ error: err.message ?? 'Server error', issue: err.issue, debugId: err.debugId });
});

const port = Number(process.env.PORT || 8787);
seedIfEmpty()
  .catch((e) => console.error('seed failed', e))
  .finally(() => {
    app.listen(port, () => {
      console.log(`Haat on http://localhost:${port}  (PayPal ${paypalConfigured() ? paypalEnv() : 'NOT CONFIGURED'}, AI ${aiConfigured() ? 'on' : 'off'})`);
      const pub = process.env.PUBLIC_URL;
      if (pub?.startsWith('https://') && paypalConfigured() && !process.env.PAYPAL_WEBHOOK_ID) {
        ensureWebhook(`${pub.replace(/\/$/, '')}/api/webhooks/paypal`)
          .then((id) => id && console.log(`PayPal webhook registered: ${id}. Set PAYPAL_WEBHOOK_ID=${id} to enable signature verification.`))
          .catch((e) => console.warn('webhook registration failed:', e.message));
      }
    });
  });
