// A buyer-side shopping agent. It finds pieces, explains who made them, and prepares a
// PayPal checkout within a spending mandate the buyer set. It can never pay by itself:
// every purchase ends in a PayPal approval the human clicks.

import type { Content } from '@google/genai';
import { runAgent, type AgentEvent, type AgentTool } from '../ai/gemini.ts';
import { orders, products, sellers, threads } from '../db/index.ts';
import { startCheckout } from '../domain/commerce.ts';

export interface Mandate {
  budgetUsd: number;
  shipCountry: string;
  note?: string;
}

const card = (p: ReturnType<typeof products.get> & {}) => {
  const s = sellers.get(p.seller_id)!;
  return {
    product_id: p.id,
    slug: p.slug,
    title: p.title,
    subtitle: p.subtitle,
    price_usd: p.price_usd,
    shipping_usd: p.pricing.shipping_usd,
    landed_usd: Math.round((p.price_usd + (p.pricing.shipping_usd ?? 0)) * 100) / 100,
    maker: `${s.name}, ${s.business}, ${s.place}`,
    image: p.images[0],
    stock: p.stock,
  };
};

export function buyerTools(mandate: Mandate, channel: 'buyer-agent' | 'mcp'): AgentTool[] {
  const actor = channel === 'mcp' ? 'mcp-agent' : 'buyer-agent';
  return [
    {
      name: 'search_catalog',
      description: 'Search live handmade pieces from Indian makers. Returns price, shipping and landed cost in USD.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'What the buyer wants, in plain words' }, max_price_usd: { type: 'number' } },
        required: ['query'],
      },
      source: 'Haat catalog (synced to PayPal Catalog)',
      execute: async (a: { query: string; max_price_usd?: number }) => products.search(a.query, a.max_price_usd).slice(0, 6).map((p) => card(p)),
    },
    {
      name: 'product_details',
      description: 'Full details for one piece: story, materials, size, care, HS code and the maker.',
      parameters: { type: 'object', properties: { product_id: { type: 'string' } }, required: ['product_id'] },
      source: 'Haat',
      execute: async (a: { product_id: string }) => {
        const p = products.get(a.product_id);
        if (!p) throw new Error('No such product');
        const s = sellers.get(p.seller_id)!;
        return { ...card(p), story: p.story, materials: p.materials, dimensions: p.dimensions, care: p.care, hs_code: p.hs_code, maker_bio: s.bio, craft: s.craft };
      },
    },
    {
      name: 'request_checkout',
      description:
        'Prepare a PayPal checkout for one piece. Creates a real PayPal order and returns it for the buyer to approve. The buyer must approve in PayPal; you cannot complete payment yourself. Respects the spending mandate.',
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'string' },
          quantity: { type: 'integer' },
          reason: { type: 'string', description: 'One line on why this fits what the buyer asked for' },
        },
        required: ['product_id', 'reason'],
      },
      source: 'PayPal Orders API',
      execute: async (a: { product_id: string; quantity?: number; reason: string }) => {
        const p = products.get(a.product_id);
        if (!p) throw new Error('No such product');
        const qty = a.quantity ?? 1;
        const landed = p.price_usd * qty + (p.pricing.shipping_usd ?? 0);
        if (landed > mandate.budgetUsd) {
          return { blocked: true, reason: `Landed cost $${landed.toFixed(2)} is over the buyer's mandate of $${mandate.budgetUsd.toFixed(2)}. Ask before going over budget.` };
        }
        const res = await startCheckout({ productId: p.id, quantity: qty, channel, agentNote: a.reason, actor });
        return {
          approval_required: true,
          order_number: res.order.number,
          paypal_order_id: res.paypalOrderId,
          total_usd: res.order.amount_usd,
          approve_url: res.approveUrl,
          product: card(p),
          reason: a.reason,
        };
      },
    },
    {
      name: 'order_status',
      description: 'Status of an order the buyer placed: paid, shipped (tracking), etc.',
      parameters: { type: 'object', properties: { order_number: { type: 'string' } }, required: ['order_number'] },
      source: 'Haat',
      execute: async (a: { order_number: string }) => {
        const o = orders.get(a.order_number);
        if (!o) throw new Error('No such order');
        return { number: o.number, status: o.status, total_usd: o.amount_usd, tracking: o.tracking?.number ?? null, carrier: o.tracking?.carrier ?? null };
      },
    },
  ];
}

const SYSTEM = (m: Mandate) => `You are a personal shopping agent for a buyer outside India who wants honest, handmade pieces directly from Indian makers.
Spending mandate set by the buyer: up to $${m.budgetUsd.toFixed(2)} landed (price + shipping) per purchase, shipping to ${m.shipCountry}.${m.note ? ` Buyer note: ${m.note}.` : ''}
How to work: search first, then compare at most three options in plain prose (who made it, where, what it is, landed price). Recommend one. When the buyer wants it, or clearly asked you to buy, call request_checkout. Then tell them to approve the payment in the PayPal card. Never say a purchase is complete until order_status says paid.
Never invent pieces, makers, prices or claims (no "master artisan", no "natural dye" unless the listing says so). Keep replies short: 2-5 sentences of plain text. No markdown at all: no asterisks, no headers, no numbered lists.`;

export async function buyerMessage(opts: { sessionId: string; text: string; mandate: Mandate; onEvent?: (e: AgentEvent) => void }) {
  const id = `buyer:${opts.sessionId}`;
  const t = threads.get(id);
  const history: Content[] = t?.history ?? [];
  const messages: any[] = t?.messages ?? [];
  messages.push({ role: 'buyer', text: opts.text, at: new Date().toISOString() });
  history.push({ role: 'user', parts: [{ text: opts.text }] });
  const result = await runAgent({
    system: SYSTEM(opts.mandate),
    history,
    tools: buyerTools(opts.mandate, 'buyer-agent'),
    ctx: { actor: 'buyer-agent', channel: id, state: {} },
    maxSteps: 6,
    onEvent: opts.onEvent,
  });
  messages.push({ role: 'agent', text: result.text, at: new Date().toISOString() });
  threads.upsert(id, 'buyer', null, result.history, messages);
  return { text: result.text, model: result.model };
}
