// Direct PayPal REST calls for the deterministic parts of the flow (checkout, capture,
// catalog sync, tracking, payouts, dispute evidence, webhooks). Agent-driven calls go
// through the official Agent Toolkit in toolkit.ts.

import { pp, PayPalError } from './client.ts';

const money = (v: number) => ({ currency_code: 'USD', value: v.toFixed(2) });
const isHttpsPublic = (u?: string | null) => !!u && /^https:\/\//.test(u) && !/localhost|127\.0\.0\.1/.test(u);

// ------------------------------------------------------------------ Orders v2

export interface CheckoutItem {
  name: string;
  description: string;
  sku: string;
  unitUsd: number;
  quantity: number;
  imageUrl?: string;
  url?: string;
}

export async function createOrder(opts: {
  reference: string;
  customId: string;
  item: CheckoutItem;
  shippingUsd: number;
  returnUrl: string;
  cancelUrl: string;
  actor: string;
  description: string;
}) {
  const itemTotal = opts.item.unitUsd * opts.item.quantity;
  const total = itemTotal + opts.shippingUsd;
  const item: any = {
    name: opts.item.name.slice(0, 127),
    description: opts.item.description.slice(0, 127),
    sku: opts.item.sku.slice(0, 127),
    unit_amount: money(opts.item.unitUsd),
    quantity: String(opts.item.quantity),
    category: 'PHYSICAL_GOODS',
  };
  if (isHttpsPublic(opts.item.imageUrl)) item.image_url = opts.item.imageUrl;
  if (isHttpsPublic(opts.item.url)) item.url = opts.item.url;

  return pp<any>('POST', '/v2/checkout/orders', {
    label: `Create order ${opts.reference} · $${total.toFixed(2)}`,
    actor: opts.actor,
    requestId: `create-${opts.customId}`,
    prefer: 'return=representation',
    body: {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: opts.reference,
          invoice_id: opts.reference,
          custom_id: opts.customId,
          description: opts.description.slice(0, 127),
          soft_descriptor: 'HAAT INDIA',
          amount: {
            ...money(total),
            breakdown: { item_total: money(itemTotal), shipping: money(opts.shippingUsd) },
          },
          items: [item],
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: 'Haat',
            shipping_preference: 'GET_FROM_FILE',
            user_action: 'PAY_NOW',
            landing_page: 'LOGIN',
            return_url: opts.returnUrl,
            cancel_url: opts.cancelUrl,
          },
        },
      },
    },
  });
}

export async function getOrder(id: string, actor = 'system') {
  return pp<any>('GET', `/v2/checkout/orders/${id}`, { label: `Get order ${id}`, actor });
}

export async function captureOrder(id: string, actor: string) {
  try {
    return await pp<any>('POST', `/v2/checkout/orders/${id}/capture`, {
      label: `Capture order ${id}`,
      actor,
      requestId: `capture-${id}`,
      prefer: 'return=representation',
      body: {},
    });
  } catch (err) {
    // A retried capture after success returns ORDER_ALREADY_CAPTURED; read the order instead.
    if (err instanceof PayPalError && err.issue === 'ORDER_ALREADY_CAPTURED') return getOrder(id, actor);
    throw err;
  }
}

export function approvalLink(order: any): string | undefined {
  return order?.links?.find((l: any) => l.rel === 'payer-action' || l.rel === 'approve')?.href;
}

export function captureSummary(order: any) {
  const pu = order?.purchase_units?.[0];
  const cap = pu?.payments?.captures?.[0];
  const addr = pu?.shipping?.address;
  return {
    status: order?.status as string,
    captureId: cap?.id as string | undefined,
    captureStatus: cap?.status as string | undefined,
    gross: cap?.amount?.value,
    paypalFee: cap?.seller_receivable_breakdown?.paypal_fee?.value,
    net: cap?.seller_receivable_breakdown?.net_amount?.value,
    sellerProtection: cap?.seller_protection?.status,
    payerName: [order?.payer?.name?.given_name, order?.payer?.name?.surname].filter(Boolean).join(' ') || pu?.shipping?.name?.full_name,
    payerEmail: order?.payer?.email_address as string | undefined,
    shipTo: addr
      ? {
          name: pu?.shipping?.name?.full_name,
          line1: addr.address_line_1,
          line2: addr.address_line_2,
          city: addr.admin_area_2,
          state: addr.admin_area_1,
          postal: addr.postal_code,
          country: addr.country_code,
        }
      : null,
  };
}

// ------------------------------------------------------------------ Catalog Products v1

export async function createCatalogProduct(opts: {
  id: string;
  name: string;
  description: string;
  imageUrl?: string;
  homeUrl?: string;
  actor: string;
}) {
  const body: any = {
    id: `HAAT-${opts.id.replace(/[^A-Za-z0-9-]/g, '').slice(0, 40)}`,
    name: opts.name.slice(0, 127),
    description: opts.description.slice(0, 256),
    type: 'PHYSICAL',
  };
  if (isHttpsPublic(opts.imageUrl)) body.image_url = opts.imageUrl;
  if (isHttpsPublic(opts.homeUrl)) body.home_url = opts.homeUrl;
  try {
    return await pp<any>('POST', '/v1/catalogs/products', {
      label: `Catalog: add "${opts.name.slice(0, 40)}"`,
      actor: opts.actor,
      requestId: `product-${opts.id}`,
      prefer: 'return=representation',
      body,
    });
  } catch (err) {
    if (err instanceof PayPalError && err.status === 409) {
      return pp<any>('GET', `/v1/catalogs/products/${body.id}`, { label: 'Catalog: product exists', actor: opts.actor });
    }
    throw err;
  }
}

// ------------------------------------------------------------------ Tracking (Orders v2 /track)

export async function addTracking(opts: {
  paypalOrderId: string;
  captureId: string;
  trackingNumber: string;
  carrier: string;
  carrierNameOther?: string;
  actor: string;
}) {
  const call = (carrier: string, other?: string) =>
    pp<any>('POST', `/v2/checkout/orders/${opts.paypalOrderId}/track`, {
      label: `Add tracking ${opts.trackingNumber} to capture`,
      actor: opts.actor,
      requestId: `track-${opts.captureId}-${opts.trackingNumber}`,
      body: {
        capture_id: opts.captureId,
        tracking_number: opts.trackingNumber,
        carrier,
        ...(other ? { carrier_name_other: other } : {}),
        notify_payer: true,
      },
    });
  try {
    return await call(opts.carrier, opts.carrierNameOther);
  } catch (err) {
    if (err instanceof PayPalError && err.status === 422 && opts.carrier !== 'OTHER') {
      return call('OTHER', opts.carrierNameOther ?? opts.carrier);
    }
    throw err;
  }
}

// ------------------------------------------------------------------ Payouts v1

export async function createPayout(opts: {
  batchId: string;
  subject: string;
  message: string;
  items: { receiver: string; amountUsd: number; note: string; itemId: string }[];
  actor: string;
}) {
  return pp<any>('POST', '/v1/payments/payouts', {
    label: `Payouts: ${opts.items.length} makers · $${opts.items.reduce((s, i) => s + i.amountUsd, 0).toFixed(2)}`,
    actor: opts.actor,
    requestId: `payout-${opts.batchId}`,
    body: {
      sender_batch_header: { sender_batch_id: opts.batchId, email_subject: opts.subject, email_message: opts.message },
      items: opts.items.map((i) => ({
        recipient_type: 'EMAIL',
        amount: { value: i.amountUsd.toFixed(2), currency: 'USD' },
        receiver: i.receiver,
        note: i.note.slice(0, 4000),
        sender_item_id: i.itemId,
      })),
    },
  });
}

export async function getPayout(batchId: string, actor = 'system') {
  return pp<any>('GET', `/v1/payments/payouts/${batchId}`, { label: `Payout batch status`, actor });
}

// ------------------------------------------------------------------ Disputes v1

export async function listDisputes(actor = 'system') {
  return pp<any>('GET', '/v1/customer/disputes', { label: 'List disputes', actor, query: { page_size: 20 } });
}

export async function getDispute(id: string, actor = 'system') {
  return pp<any>('GET', `/v1/customer/disputes/${id}`, { label: `Get dispute ${id}`, actor });
}

export async function provideTrackingEvidence(opts: {
  disputeId: string;
  carrier: string;
  trackingNumber: string;
  notes: string;
  actor: string;
}) {
  const form = new FormData();
  form.append(
    'input',
    new Blob(
      [
        JSON.stringify({
          evidences: [
            {
              evidence_type: 'PROOF_OF_FULFILLMENT',
              evidence_info: { tracking_info: [{ carrier_name: opts.carrier, tracking_number: opts.trackingNumber }] },
              notes: opts.notes.slice(0, 2000),
            },
          ],
        }),
      ],
      { type: 'application/json' },
    ),
  );
  return pp<any>('POST', `/v1/customer/disputes/${opts.disputeId}/provide-evidence`, {
    label: `Dispute ${opts.disputeId}: submit proof of fulfilment`,
    actor: opts.actor,
    rawBody: form,
  });
}

export async function acceptClaim(disputeId: string, note: string, actor: string) {
  return pp<any>('POST', `/v1/customer/disputes/${disputeId}/accept-claim`, {
    label: `Dispute ${disputeId}: accept claim`,
    actor,
    body: { note: note.slice(0, 2000), accept_claim_type: 'REFUND' },
  });
}

// ------------------------------------------------------------------ Webhooks

export const WEBHOOK_EVENTS = [
  'CHECKOUT.ORDER.APPROVED',
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.CAPTURE.REFUNDED',
  'CUSTOMER.DISPUTE.CREATED',
  'CUSTOMER.DISPUTE.UPDATED',
  'INVOICING.INVOICE.PAID',
  'PAYMENT.PAYOUTSBATCH.SUCCESS',
  'PAYMENT.PAYOUTS-ITEM.UNCLAIMED',
];

export async function ensureWebhook(url: string): Promise<string | undefined> {
  const list = await pp<any>('GET', '/v1/notifications/webhooks', { label: 'List webhooks' });
  const existing = list.data?.webhooks?.find((w: any) => w.url === url);
  if (existing) return existing.id;
  const created = await pp<any>('POST', '/v1/notifications/webhooks', {
    label: 'Register webhook',
    body: { url, event_types: WEBHOOK_EVENTS.map((name) => ({ name })) },
  });
  return created.data?.id;
}

export async function verifyWebhook(headers: Record<string, string | undefined>, event: unknown, webhookId: string) {
  const res = await pp<any>('POST', '/v1/notifications/verify-webhook-signature', {
    label: 'Verify webhook signature',
    body: {
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: webhookId,
      webhook_event: event,
    },
  });
  return res.data?.verification_status === 'SUCCESS';
}
