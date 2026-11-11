// The seller's export desk, as a conversation. The maker talks (voice or text, any
// Indian language); the agent answers in that language and acts through PayPal.

import type { Content } from '@google/genai';
import { generateJSON, inlinePart, runAgent, type AgentEvent, type AgentTool } from '../ai/gemini.ts';
import { activity, invoices, makers, orders, products, sellers, threads, uid } from '../db/index.ts';
import { callToolkit, toolkitTools } from '../paypal/toolkit.ts';
import { publishListing } from '../domain/commerce.ts';
import { inrPerUsd } from '../domain/pricing.ts';
import type { MediaIn } from './listing.ts';

function sellerTools(sellerId: string): AgentTool[] {
  const seller = sellers.get(sellerId)!;
  const actor = 'seller-agent';

  const own: AgentTool[] = [
    {
      name: 'list_my_listings',
      description: 'List this seller\'s products (drafts and live) with price, stock and PayPal catalog id.',
      parameters: { type: 'object', properties: {} },
      source: 'Haat',
      execute: async () =>
        products.all({ sellerId }).map((p) => ({ id: p.id, title: p.title, status: p.status, price_usd: p.price_usd, take_home_inr: p.pricing.seller_take_home_inr, stock: p.stock, paypal_product_id: p.paypal_product_id })),
    },
    {
      name: 'publish_listing',
      description: 'Publish a draft listing to the Haat storefront and the PayPal Catalog. Optionally set a new USD price. Only call after the seller agrees.',
      parameters: { type: 'object', properties: { product_id: { type: 'string' }, price_usd: { type: 'number' } }, required: ['product_id'] },
      source: 'PayPal Catalog API',
      execute: async (a: { product_id: string; price_usd?: number }) => {
        const p = await publishListing(a.product_id, { priceUsd: a.price_usd, actor });
        return { id: p.id, status: p.status, price_usd: p.price_usd, paypal_product_id: p.paypal_product_id };
      },
    },
    {
      name: 'list_my_orders',
      description: 'Recent orders for this seller with status, buyer country, amounts, tracking and maker payouts.',
      parameters: { type: 'object', properties: {} },
      source: 'Haat',
      execute: async () =>
        orders.all({ sellerId }).slice(0, 15).map((o) => ({
          number: o.number,
          status: o.status,
          piece: products.get(o.product_id)?.title,
          amount_usd: o.amount_usd,
          buyer_country: o.ship_to?.country,
          channel: o.channel,
          tracking: o.tracking?.number,
          purpose_code: o.export_doc?.purpose_code,
          makers_paid: o.payout?.items?.length ?? 0,
          paypal_order_id: o.paypal_order_id,
          capture_id: o.capture_id,
        })),
    },
    {
      name: 'list_makers',
      description: 'The makers in this cooperative and their share of each sale.',
      parameters: { type: 'object', properties: {} },
      source: 'Haat',
      execute: async () => makers.forSeller(sellerId).map((m) => ({ name: m.name, role: m.role, share_pct: m.share_pct })),
    },
    {
      name: 'send_wholesale_invoice',
      description:
        'Create AND send a PayPal invoice to a wholesale or repeat buyer abroad (boutique, shop, gallery) for one of this seller\'s products. Uses the PayPal Agent Toolkit create_invoice + send_invoice. Confirm quantity and unit price with the seller first.',
      parameters: {
        type: 'object',
        properties: {
          buyer_email: { type: 'string' },
          buyer_name: { type: 'string', description: 'Person or business name' },
          product_id: { type: 'string' },
          quantity: { type: 'integer' },
          unit_price_usd: { type: 'number' },
          note: { type: 'string', description: 'Short note to the buyer in English' },
        },
        required: ['buyer_email', 'product_id', 'quantity', 'unit_price_usd'],
      },
      source: 'PayPal Agent Toolkit',
      execute: async (a: any) => {
        const p = products.get(a.product_id);
        if (!p) throw new Error('Unknown product id');
        const { rate } = await inrPerUsd();
        const [given, ...rest] = String(a.buyer_name ?? '').split(' ');
        const created = await callToolkit(
          'create_invoice',
          {
            currency_code: 'USD',
            note: a.note ?? `Handmade by ${seller.business}, ${seller.place}. Export of goods under LUT.`,
            invoicer_business_name: seller.business,
            primary_recipients: [
              {
                billing_info: {
                  email_address: a.buyer_email,
                  ...(a.buyer_name ? { business_name: a.buyer_name, name: { given_name: given || a.buyer_name, surname: rest.join(' ') || '-' } } : {}),
                },
              },
            ],
            items: [
              {
                name: p.title.slice(0, 200),
                description: `${p.subtitle}. HS ${p.hs_code ?? ''}`.slice(0, 1000),
                quantity: String(a.quantity),
                unit_amount: { currency_code: 'USD', value: Number(a.unit_price_usd).toFixed(2) },
              },
            ],
          },
          actor,
          `Agent Toolkit · create_invoice for ${a.buyer_email}`,
        );
        const invoiceId: string | undefined =
          created?.id ?? created?.href?.split('/').pop() ?? created?.links?.find((l: any) => l.rel === 'self')?.href?.split('/').pop();
        if (!invoiceId) throw new Error('PayPal did not return an invoice id: ' + JSON.stringify(created).slice(0, 300));
        const sent = await callToolkit('send_invoice', { invoice_id: invoiceId, send_to_recipient: true }, actor, `Agent Toolkit · send_invoice ${invoiceId}`);
        const total = Number(a.unit_price_usd) * Number(a.quantity);
        const link = sent?.href ?? sent?.links?.find((l: any) => /payer-view|pay/i.test(l.rel ?? ''))?.href ?? null;
        invoices.insert({
          id: uid(),
          seller_id: sellerId,
          paypal_invoice_id: invoiceId,
          number: created?.detail?.invoice_number ?? null,
          buyer_email: a.buyer_email,
          buyer_name: a.buyer_name ?? null,
          amount_usd: total,
          status: 'SENT',
          items: [{ product_id: p.id, title: p.title, quantity: a.quantity, unit_usd: a.unit_price_usd }],
          link,
        });
        activity.add({
          seller_id: sellerId,
          order_id: null,
          kind: 'invoice.sent',
          title: `Wholesale invoice sent to ${a.buyer_email}: ${a.quantity} × ${p.title} = $${total.toFixed(2)}`,
          detail: { invoiceId, link },
        });
        return { invoice_id: invoiceId, status: 'SENT', total_usd: total, approx_inr: Math.round(total * rate), payer_link: link };
      },
    },
  ];

  const kit = toolkitTools(['list_invoices', 'get_invoice', 'send_invoice_reminder', 'list_transactions', 'list_disputes', 'get_dispute'], actor);
  return [...own, ...kit];
}

const systemFor = (sellerId: string) => {
  const s = sellers.get(sellerId)!;
  return `You are Haat, the export desk for ${s.name} (${s.business}, ${s.place}, ${s.state}, India). ${s.craft}.
You talk with the maker the way a capable, respectful nephew or niece who knows export would: short, warm, practical.
LANGUAGE: Reply in ${s.language_name} using its native script, simple everyday words, plain text only (no asterisks, no markdown; short lines are fine). After your reply add a new line starting with "EN:" and a one-sentence English gloss for the dashboard.
You can act through PayPal: publish listings to the PayPal Catalog, send wholesale invoices with the PayPal Agent Toolkit, check invoices, transactions and disputes.
Rules: confirm before sending an invoice or changing a price. Quote money as both USD and approximate rupees. Never invent orders, buyers or numbers: call a tool. If a tool fails, say so plainly and what to do next.
When a sale happens Haat's autopilot already prepares the export invoice under LUT (purpose code P0103 for payment before shipment), adds India Post tracking to the PayPal capture and pays the cooperative's makers by PayPal Payouts. You can explain any of that.`;
};

export interface SellerTurn {
  role: 'seller' | 'agent';
  text: string;
  english?: string;
  kind?: string;
  at: string;
  tools?: { name: string; source?: string; ok?: boolean }[];
}

export async function sellerMessage(opts: { sellerId: string; text?: string; audio?: MediaIn | null; onEvent?: (e: AgentEvent | { kind: 'heard'; original: string; english: string }) => void }) {
  const seller = sellers.get(opts.sellerId);
  if (!seller) throw new Error('Unknown seller');
  const id = `seller:${seller.id}`;
  const thread = threads.get(id);
  const history: Content[] = thread?.history ?? [];
  const messages: any[] = thread?.messages ?? [];

  let said = opts.text?.trim() ?? '';
  let english: string | undefined;
  if (opts.audio) {
    const { data } = await generateJSON<{ original: string; english: string }>({
      system: 'Transcribe this voice note exactly in its original language and script, then translate it to English.',
      parts: [inlinePart(opts.audio.data, opts.audio.mime)],
      schema: { type: 'object', properties: { original: { type: 'string' }, english: { type: 'string' } }, required: ['original', 'english'] },
      thinking: 'MINIMAL',
    });
    said = data.original;
    english = data.english;
    opts.onEvent?.({ kind: 'heard', original: data.original, english: data.english });
  }
  if (!said) throw new Error('Say or type something');

  messages.push({ role: 'seller', text: said, english, at: new Date().toISOString(), voice: Boolean(opts.audio) });
  history.push({ role: 'user', parts: [{ text: english ? `${said}\n(English: ${english})` : said }] });

  const used: { name: string; source?: string; ok?: boolean }[] = [];
  const tools = sellerTools(seller.id);
  const result = await runAgent({
    system: systemFor(seller.id),
    history,
    tools,
    ctx: { actor: 'seller-agent', channel: id, state: { sellerId: seller.id } },
    maxSteps: 8,
    onEvent: (e) => {
      if (e.kind === 'tool_call') used.push({ name: e.name, source: e.source });
      if (e.kind === 'tool_result') {
        const u = used.find((x) => x.name === e.name && x.ok === undefined);
        if (u) u.ok = e.ok;
      }
      opts.onEvent?.(e);
    },
  });

  const [nativePart, ...rest] = result.text.split(/\n\s*EN:\s*/);
  const reply = { role: 'agent', text: nativePart.trim(), english: rest.join(' ').trim() || undefined, at: new Date().toISOString(), tools: used };
  messages.push(reply);
  threads.upsert(id, 'seller', seller.id, result.history, messages);
  return { reply, heard: english ? { original: said, english } : null, model: result.model };
}

export function sellerThread(sellerId: string) {
  return threads.get(`seller:${sellerId}`)?.messages ?? [];
}
