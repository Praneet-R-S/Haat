// Publishing, checkout and capture. Shared by the storefront, the buyer agent and MCP.

import { activity, orders, products, sellers, uid, type Order } from '../db/index.ts';
import { approvalLink, captureOrder, captureSummary, createCatalogProduct, createOrder } from '../paypal/api.ts';
import { bus } from '../events/bus.ts';
import { runAutopilot } from '../agents/autopilot.ts';

export const publicUrl = () => (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 8787}`).replace(/\/$/, '');

export async function publishListing(productId: string, opts: { priceUsd?: number; actor?: string } = {}) {
  const p = products.get(productId);
  if (!p) throw new Error('Unknown product');
  const seller = sellers.get(p.seller_id)!;
  let paypalProductId = p.paypal_product_id;
  if (!paypalProductId) {
    const res = await createCatalogProduct({
      id: p.id,
      name: p.title,
      description: `${p.subtitle}. Made by ${seller.business}, ${seller.place}.`,
      imageUrl: p.images[0] ? publicUrl() + p.images[0] : undefined,
      homeUrl: `${publicUrl()}/app/p/${p.slug}`,
      actor: opts.actor ?? 'seller-agent',
    });
    paypalProductId = res.data?.id ?? null;
  }
  products.update(p.id, {
    status: 'live',
    paypal_product_id: paypalProductId,
    ...(opts.priceUsd ? { price_usd: Math.round(opts.priceUsd * 100) / 100 } : {}),
  });
  const live = products.get(p.id)!;
  activity.add({
    seller_id: seller.id,
    order_id: null,
    kind: 'listing.published',
    title: `"${live.title}" is live at $${live.price_usd.toFixed(2)}, synced to PayPal Catalog`,
    detail: { productId: p.id, paypalProductId },
  });
  bus.emitEvent('listing.published', { product: live }, `seller:${seller.id}`);
  return live;
}

export async function startCheckout(opts: {
  productId: string;
  quantity?: number;
  channel: Order['channel'];
  agentNote?: string;
  actor: string;
}) {
  const p = products.get(opts.productId);
  if (!p || p.status !== 'live') throw new Error('That piece is not available');
  const qty = Math.max(1, Math.min(opts.quantity ?? 1, p.stock));
  const id = uid();
  const number = orders.nextNumber();
  const shipping = p.pricing.shipping_usd ?? 12;
  const seller = sellers.get(p.seller_id)!;
  const res = await createOrder({
    reference: number,
    customId: id,
    description: `${p.title} by ${seller.business}`,
    item: {
      name: p.title,
      description: p.subtitle,
      sku: p.slug,
      unitUsd: p.price_usd,
      quantity: qty,
      imageUrl: p.images[0] ? publicUrl() + p.images[0] : undefined,
      url: `${publicUrl()}/app/p/${p.slug}`,
    },
    shippingUsd: shipping,
    returnUrl: `${publicUrl()}/checkout/return`,
    cancelUrl: `${publicUrl()}/checkout/cancel`,
    actor: opts.actor,
  });
  orders.insert({
    id,
    number,
    product_id: p.id,
    seller_id: p.seller_id,
    quantity: qty,
    amount_usd: Math.round((p.price_usd * qty + shipping) * 100) / 100,
    shipping_usd: shipping,
    channel: opts.channel,
    status: 'created',
    paypal_order_id: res.data.id,
    agent_note: opts.agentNote ?? null,
  });
  bus.emitEvent('order.created', { orderId: id, number, channel: opts.channel }, `seller:${p.seller_id}`);
  return { order: orders.get(id)!, paypalOrderId: res.data.id as string, approveUrl: approvalLink(res.data) };
}

const inflight = new Map<string, Promise<Order>>();

/** Capture an approved PayPal order exactly once, then hand it to the seller's autopilot. */
export function captureAndFulfil(paypalOrderId: string, actor: string): Promise<Order> {
  const existing = orders.get(paypalOrderId);
  if (existing && existing.status !== 'created') return Promise.resolve(existing);
  if (inflight.has(paypalOrderId)) return inflight.get(paypalOrderId)!;
  const job = (async () => {
    const order = orders.get(paypalOrderId);
    if (!order) throw new Error('Unknown order');
    const res = await captureOrder(paypalOrderId, actor);
    const s = captureSummary(res.data);
    if (s.status !== 'COMPLETED' || !s.captureId) {
      orders.update(order.id, { status: 'failed' });
      throw new Error(`Payment not completed (${s.status ?? 'unknown'})`);
    }
    orders.update(order.id, {
      status: 'paid',
      capture_id: s.captureId,
      buyer_name: s.payerName ?? null,
      buyer_email: s.payerEmail ?? null,
      ship_to: s.shipTo,
      paid_at: new Date().toISOString(),
      settlement: { gross: s.gross, paypal_fee: s.paypalFee, net: s.net, protection: s.sellerProtection, capture_status: s.captureStatus },
    });
    const p = products.get(order.product_id)!;
    products.update(p.id, { stock: Math.max(0, p.stock - order.quantity) });
    activity.add({
      seller_id: order.seller_id,
      order_id: order.id,
      kind: 'order.paid',
      title: `${order.number} paid · $${s.gross} via PayPal${order.channel !== 'storefront' ? ' (bought by an AI shopping agent)' : ''}`,
      detail: { captureId: s.captureId, gross: s.gross, paypalFee: s.paypalFee, net: s.net, sellerProtection: s.sellerProtection, channel: order.channel },
    });
    const paid = orders.get(order.id)!;
    bus.emitEvent('order.paid', { order: paid }, `seller:${order.seller_id}`);
    // Fire and forget: the seller's export desk takes over.
    runAutopilot(paid.id, { gross: s.gross, fee: s.paypalFee, net: s.net, protection: s.sellerProtection }).catch((err) =>
      activity.add({ seller_id: order.seller_id, order_id: order.id, kind: 'autopilot.error', title: `Autopilot stopped: ${err.message}`, detail: {} }),
    );
    return paid;
  })().finally(() => inflight.delete(paypalOrderId));
  inflight.set(paypalOrderId, job);
  return job;
}
