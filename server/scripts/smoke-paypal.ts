// End-to-end smoke test against the PayPal sandbox (everything except the buyer's click).
// Run: npx tsx --env-file=../.env scripts/smoke-paypal.ts
import { getAccessToken } from '../src/paypal/client.ts';
import { createCatalogProduct, createOrder, approvalLink, getOrder, createPayout, listDisputes } from '../src/paypal/api.ts';
import { callToolkit } from '../src/paypal/toolkit.ts';
import { pp } from '../src/paypal/client.ts';

const id = `smoke${Date.now().toString(36)}`;
const results: [string, boolean, string][] = [];
async function step(name: string, fn: () => Promise<string>) {
  try {
    results.push([name, true, await fn()]);
  } catch (e: any) {
    results.push([name, false, `${e.message} ${e.issue ?? ''} ${e.debugId ? 'debug_id ' + e.debugId : ''}`]);
  }
}

await step('OAuth token', async () => ((await getAccessToken()).length > 20 ? 'ok' : 'short token'));
await step('Catalog: create product', async () => (await createCatalogProduct({ id, name: 'Smoke test cloth', description: 'Smoke test', actor: 'smoke' })).data.id);
let orderId = '';
await step('Orders v2: create', async () => {
  const r = await createOrder({
    reference: id,
    customId: id,
    description: 'Smoke test',
    item: { name: 'Smoke test cloth', description: 'test', sku: id, unitUsd: 19.99, quantity: 1 },
    shippingUsd: 13.2,
    returnUrl: 'http://localhost:8787/checkout/return',
    cancelUrl: 'http://localhost:8787/checkout/cancel',
    actor: 'smoke',
  });
  orderId = r.data.id;
  return `${r.data.id} ${r.data.status} approve=${approvalLink(r.data) ? 'yes' : 'no'}`;
});
await step('Orders v2: get', async () => (await getOrder(orderId, 'smoke')).data.status);
if (process.env.PAYOUT_MODE === 'upi') results.push(['Payouts: batch', true, 'skipped: PAYOUT_MODE=upi (Indian account, makers paid by UPI)']);
else await step('Payouts: batch', async () => {
  const r = await createPayout({ batchId: id, subject: 'Smoke', message: 'Smoke', items: [{ receiver: 'smoke.maker@example.com', amountUsd: 1.11, note: 'smoke', itemId: `${id}-1` }], actor: 'smoke' });
  return `${r.data.batch_header?.payout_batch_id} ${r.data.batch_header?.batch_status}`;
});
let invoiceId = '';
await step('Agent Toolkit: create_invoice', async () => {
  const r = await callToolkit('create_invoice', {
    currency_code: 'USD',
    primary_recipients: [{ billing_info: { email_address: 'smoke.buyer@example.com' } }],
    items: [{ name: 'Smoke test cloth', quantity: '2', unit_amount: { currency_code: 'USD', value: '15.00' } }],
  }, 'smoke');
  invoiceId = r?.id ?? r?.href?.split('/').pop() ?? r?.links?.find((l: any) => l.rel === 'self')?.href?.split('/').pop() ?? '';
  return invoiceId || JSON.stringify(r).slice(0, 200);
});
await step('Agent Toolkit: send_invoice', async () => JSON.stringify(await callToolkit('send_invoice', { invoice_id: invoiceId, send_to_recipient: true }, 'smoke')).slice(0, 160));
await step('Agent Toolkit: list_transactions', async () => {
  const r = await callToolkit('list_transactions', { search_months: 1, page_size: 5 }, 'smoke');
  if (r?.ok === false || r?.error) throw new Error(`${r.status ?? ''} ${r.message ?? r.error} (enable Transaction search on the sandbox app)`);
  return JSON.stringify(r).slice(0, 120);
});
await step('Disputes: list', async () => `${(await listDisputes('smoke')).data.items?.length ?? 0} disputes`);
await step('Webhooks: list', async () => `${(await pp('GET', '/v1/notifications/webhooks')).data.webhooks?.length ?? 0} webhooks`);

for (const [n, ok, msg] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n.padEnd(34)} ${msg}`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
