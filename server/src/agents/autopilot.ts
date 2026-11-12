// The export desk autopilot. Runs the moment a capture completes:
//   1. read what PayPal actually settled (fee, net, seller protection)
//   2. prepare the export paperwork (GST export invoice under LUT, purpose code, HS)
//   3. book the parcel and attach tracking to the PayPal capture (seller protection)
//   4. pay each maker in the cooperative their share through PayPal Payouts
//   5. tell the seller what happened, in their own language
// Each step is emitted live so the seller and the ops ledger can watch it happen.

import { generateJSON } from '../ai/gemini.ts';
import { activity, makers, orders, products, sellers, threads, type Order } from '../db/index.ts';
import { addTracking, createPayout } from '../paypal/api.ts';
import { inrPerUsd } from '../domain/pricing.ts';
import { bus } from '../events/bus.ts';
import { voiceFor } from '../domain/voice.ts';
import { randomUUID } from 'node:crypto';
import { kv } from '../db/index.ts';

/** 'paypal' = PayPal Payouts, 'upi' = UPI requests from the cooperative. PAYOUT_MODE=auto learns from the first refusal. */
export function payoutMode(): 'paypal' | 'upi' {
  const m = (process.env.PAYOUT_MODE ?? 'auto').toLowerCase();
  if (m === 'upi' || m === 'paypal') return m;
  return kv.get('payout_mode') === 'upi' ? 'upi' : 'paypal';
}
function rememberIndianAccount() {
  kv.set('payout_mode', 'upi');
}
/** Standard UPI deep link: opens any UPI app with payee, amount and note filled in. */
export function upiLink(vpa: string, name: string, inr: number, note: string) {
  const q = new URLSearchParams({ pa: vpa, pn: name, am: inr.toFixed(2), cu: 'INR', tn: note });
  return `upi://pay?${q.toString()}`;
}

type StepStatus = 'running' | 'done' | 'skipped' | 'error';

export const AUTOPILOT_STEPS = [
  { key: 'settle', title: 'Payment settled on PayPal' },
  { key: 'paperwork', title: 'Export invoice under LUT, purpose code, HS code' },
  { key: 'ship', title: 'Parcel booked, tracking added to the PayPal capture' },
  { key: 'payout', title: "Each maker's share worked out and sent" },
  { key: 'notify', title: 'Seller told, in their own language' },
] as const;

function emit(order: Order, key: string, status: StepStatus, detail: Record<string, unknown> = {}) {
  const payload = { orderId: order.id, number: order.number, key, status, detail, at: new Date().toISOString() };
  bus.emitEvent('autopilot.step', payload, `seller:${order.seller_id}`);
  bus.emitEvent('autopilot.step', payload, `order:${order.id}`);
}

const PAPERWORK_SCHEMA = {
  type: 'object',
  properties: {
    purpose_code: { type: 'string', description: 'RBI purpose code for this inward remittance, e.g. P0103' },
    purpose_code_label: { type: 'string' },
    purpose_reason: { type: 'string', description: 'One sentence: why this code fits (payment received before shipment, goods not services, etc.)' },
    hs_code: { type: 'string' },
    hs_check: { type: 'string', description: 'One sentence confirming or correcting the HS code' },
    goods_description: { type: 'string', description: 'Customs-style goods description, e.g. "Handwoven cotton-silk stole, Chanderi"' },
    gst_treatment: { type: 'string', description: 'e.g. Zero-rated export of goods under LUT, IGST not charged' },
    declaration: { type: 'string', description: 'The exact declaration line to print on a GST export invoice under LUT' },
    checks: { type: 'array', items: { type: 'string' }, description: '2-4 things the seller should keep for the e-BRC/e-FIRA match, short' },
  },
  required: ['purpose_code', 'purpose_code_label', 'purpose_reason', 'hs_code', 'hs_check', 'goods_description', 'gst_treatment', 'declaration', 'checks'],
};

function trackingNumber(order: Order) {
  // India Post EMS style (EE + 9 digits + IN). The booking itself is simulated in the sandbox.
  const digits = (parseInt(order.id.replace(/[^0-9]/g, '').slice(0, 9) || '0', 10) + 100000000).toString().slice(0, 8);
  const sum = digits.split('').reduce((s, d, i) => s + Number(d) * [8, 6, 4, 2, 3, 5, 9, 7][i], 0);
  let check = 11 - (sum % 11);
  if (check === 10) check = 0;
  if (check === 11) check = 5;
  return `EE${digits}${check}IN`;
}

export async function runAutopilot(orderId: string, settle: { gross?: string; fee?: string; net?: string; protection?: string }) {
  let order = orders.get(orderId)!;
  const product = products.get(order.product_id)!;
  const seller = sellers.get(order.seller_id)!;
  const crew = makers.forSeller(seller.id);
  const { rate } = await inrPerUsd();

  // 1 -------------------------------------------------------------- settle
  emit(order, 'settle', 'done', {
    gross: settle.gross,
    fee: settle.fee,
    net: settle.net,
    protection: settle.protection,
    net_inr: settle.net ? Math.round(Number(settle.net) * rate) : undefined,
  });

  // 2 -------------------------------------------------------------- paperwork
  emit(order, 'paperwork', 'running');
  let paper: any;
  try {
    const { data } = await generateJSON<any>({
      system:
        'You are an Indian export compliance assistant for small exporters who sell goods abroad and get paid through PayPal. Be precise and conservative. RBI purpose codes: P0101 export bills negotiated, P0102 realisation of export bills sent on collection, P0103 advance receipts against export contracts (payment received before shipment). A GST export of goods under a Letter of Undertaking is zero-rated with no IGST.',
      parts: [
        {
          text: JSON.stringify({
            situation: 'Online sale paid in full through PayPal before the goods are shipped by post.',
            product: { title: product.title, subtitle: product.subtitle, materials: product.materials, category: product.category, hs_guess: product.hs_code, hs_reason: product.hs_reason },
            exporter: { gstin: seller.gstin, iec: seller.iec, lut_arn: seller.lut_arn, state: seller.state },
            destination_country: order.ship_to?.country ?? 'US',
            invoice_value_usd: order.amount_usd,
          }),
        },
      ],
      schema: PAPERWORK_SCHEMA,
      thinking: 'LOW',
    });
    paper = data;
  } catch (err: any) {
    paper = {
      purpose_code: 'P0103',
      purpose_code_label: 'Advance receipts against export contracts (export of goods)',
      purpose_reason: 'The buyer paid in full before the goods were shipped.',
      hs_code: product.hs_code,
      hs_check: 'Kept the listing HS code (compliance model unavailable).',
      goods_description: product.subtitle,
      gst_treatment: 'Zero-rated export of goods under LUT, IGST not charged',
      declaration: 'SUPPLY MEANT FOR EXPORT UNDER LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX',
      checks: ['Keep the PayPal transaction ID for the e-FIRA match'],
    };
  }
  const exportDoc = {
    invoice_no: `EXP/${new Date().getFullYear()}/${order.number}`,
    date: new Date().toISOString().slice(0, 10),
    exporter: { name: seller.business, place: `${seller.place}, ${seller.state}, India`, gstin: seller.gstin, iec: seller.iec, lut_arn: seller.lut_arn },
    consignee: order.ship_to,
    buyer: { name: order.buyer_name, email: order.buyer_email },
    item: {
      description: paper.goods_description,
      hs_code: paper.hs_code,
      quantity: order.quantity,
      unit_usd: product.price_usd,
      shipping_usd: order.shipping_usd,
      total_usd: order.amount_usd,
    },
    fx: { inr_per_usd: Math.round(rate * 100) / 100, total_inr: Math.round(order.amount_usd * rate) },
    paypal: { order_id: order.paypal_order_id, capture_id: order.capture_id },
    purpose_code: paper.purpose_code,
    purpose_code_label: paper.purpose_code_label,
    purpose_reason: paper.purpose_reason,
    hs_check: paper.hs_check,
    gst_treatment: paper.gst_treatment,
    declaration: paper.declaration,
    checks: paper.checks,
  };
  orders.update(order.id, { export_doc: exportDoc });
  activity.add({ seller_id: seller.id, order_id: order.id, kind: 'paperwork.ready', title: `Export invoice ${exportDoc.invoice_no} ready · purpose code ${paper.purpose_code}`, detail: exportDoc });
  emit(order, 'paperwork', 'done', { invoice_no: exportDoc.invoice_no, purpose_code: paper.purpose_code, hs_code: paper.hs_code, url: `/api/orders/${order.id}/export-invoice` });

  // 3 -------------------------------------------------------------- ship + tracking
  emit(order, 'ship', 'running');
  const tn = trackingNumber(order);
  try {
    const res = await addTracking({
      paypalOrderId: order.paypal_order_id!,
      captureId: order.capture_id!,
      trackingNumber: tn,
      carrier: 'INDIA_POST',
      carrierNameOther: 'India Post (Dak Ghar Niryat Kendra)',
      actor: 'seller-agent',
    });
    const tracking = { number: tn, carrier: 'India Post EMS', booked_via: 'Dak Ghar Niryat Kendra (simulated booking)', paypal_status: 'ADDED', paypal_order_status: res.data?.status };
    orders.update(order.id, { tracking, status: 'fulfilled' });
    activity.add({ seller_id: seller.id, order_id: order.id, kind: 'tracking.added', title: `Tracking ${tn} attached to the PayPal capture, buyer notified`, detail: tracking });
    emit(order, 'ship', 'done', tracking);
  } catch (err: any) {
    orders.update(order.id, { tracking: { number: tn, carrier: 'India Post EMS', error: err.message } });
    emit(order, 'ship', 'error', { error: err.message, debugId: err.debugId });
  }

  // 4 -------------------------------------------------------------- the makers' split
  // A marketplace account outside India pays each maker directly with PayPal Payouts.
  // An Indian PayPal account cannot send payouts (it receives into an Indian bank), so the
  // desk prepares each maker's share as a UPI request the cooperative pays in one tap:
  // PayPal brings the dollars in from abroad, UPI carries the rupees the last mile.
  order = orders.get(order.id)!;
  const net = Number(settle.net ?? order.amount_usd * 0.92);
  const itemNet = Math.max(0, net - order.shipping_usd);
  const pool = Math.round(itemNet * 0.7 * 100) / 100;
  if (!crew.length || pool < 1) {
    emit(order, 'payout', 'skipped', { reason: crew.length ? 'Amount too small to split' : 'Solo maker, nothing to split' });
  } else {
    emit(order, 'payout', 'running', { pool_usd: pool });
    const totalShare = crew.reduce((sum, m) => sum + m.share_pct, 0) || 1;
    const shares = crew.map((m, i) => {
      const usdAmt = Math.max(0.01, Math.floor(((pool * m.share_pct) / totalShare) * 100) / 100);
      return { maker: m, usd: usdAmt, inr: Math.round(usdAmt * rate), itemId: `${order.number}-${i + 1}` };
    });
    let done = false;
    if (payoutMode() === 'paypal') {
      try {
        const res = await createPayout({
          batchId: `HAAT-${order.number}`,
          subject: `${seller.business}: your share is here`,
          message: `Payment for ${product.title} (${order.number}).`,
          items: shares.map((x) => ({
            receiver: x.maker.paypal_email,
            amountUsd: x.usd,
            note: `Your share for ${order.number}: ${product.title}. From ${seller.business}.`,
            itemId: x.itemId,
          })),
          actor: 'seller-agent',
        });
        const payout = {
          method: 'paypal',
          batch_id: res.data?.batch_header?.payout_batch_id,
          status: res.data?.batch_header?.batch_status,
          pool_usd: pool,
          pool_inr: Math.round(pool * rate),
          at: new Date().toISOString(),
          items: shares.map((x) => ({ name: x.maker.name, role: x.maker.role, usd: x.usd, inr: x.inr, email: x.maker.paypal_email })),
        };
        orders.update(order.id, { payout });
        activity.add({
          seller_id: seller.id,
          order_id: order.id,
          kind: 'payout.sent',
          title: `Paid ${shares.length} makers $${pool.toFixed(2)} (about ₹${payout.pool_inr.toLocaleString('en-IN')}) through PayPal Payouts`,
          detail: payout,
        });
        emit(order, 'payout', 'done', payout);
        done = true;
      } catch (err: any) {
        if (err.issue === 'PAYOUT_NOT_AVAILABLE') {
          rememberIndianAccount();
        } else {
          orders.update(order.id, { payout: { error: err.message, pool_usd: pool } });
          emit(order, 'payout', 'error', { error: err.message, debugId: err.debugId, hint: 'Enable Payouts on the sandbox app (Apps & Credentials > app > Features).' });
          done = true;
        }
      }
    }
    if (!done) {
      const payout = {
        method: 'upi',
        status: 'READY',
        reason: 'PayPal accounts registered in India receive into an Indian bank and cannot send payouts, so each share goes out by UPI from the cooperative.',
        pool_usd: pool,
        pool_inr: shares.reduce((sum, x) => sum + x.inr, 0),
        at: new Date().toISOString(),
        items: shares.map((x) => ({
          name: x.maker.name,
          role: x.maker.role,
          usd: x.usd,
          inr: x.inr,
          upi_id: x.maker.upi_id,
          link: upiLink(x.maker.upi_id, x.maker.name, x.inr, `${order.number} share`),
          paid_at: null as string | null,
        })),
      };
      orders.update(order.id, { payout });
      activity.add({
        seller_id: seller.id,
        order_id: order.id,
        kind: 'payout.ready',
        title: `Split ₹${payout.pool_inr.toLocaleString('en-IN')} across ${shares.length} makers, UPI requests ready`,
        detail: payout,
      });
      emit(order, 'payout', 'done', payout);
    }
  }

  // 5 -------------------------------------------------------------- notify seller
  emit(order, 'notify', 'running');
  order = orders.get(order.id)!;
  try {
    const { data } = await generateJSON<{ native: string; english: string }>({
      system: `Write a short WhatsApp-style update to an Indian craftsperson in ${seller.language_name} (native script). Warm, plain, 3-4 short sentences. Mention: the piece sold and to which country, how much they receive in rupees, that tracking is added, and each maker's share by name. If payout_method is upi, say the shares are ready to send by UPI with one tap below the message; if paypal, say they were already paid. No emojis except at most one.`,
      parts: [
        {
          text: JSON.stringify({
            seller: seller.name,
            piece: product.title,
            country: order.ship_to?.country,
            buyer_first_name: order.buyer_name?.split(' ')[0],
            channel: order.channel === 'storefront' ? 'shop' : 'an AI shopping assistant',
            take_home_inr: settle.net ? Math.round(Number(settle.net) * rate) : undefined,
            tracking: order.tracking?.number,
            makers: order.payout?.items?.map((i: any) => `${i.name} ₹${i.inr}`),
            payout_method: order.payout?.method,
          }),
        },
      ],
      schema: { type: 'object', properties: { native: { type: 'string' }, english: { type: 'string' } }, required: ['native', 'english'] },
      thinking: 'MINIMAL',
    });
    const id = `seller:${seller.id}`;
    const t = threads.get(id);
    const msgId = randomUUID();
    const messages = [...(t?.messages ?? []), { id: msgId, role: 'agent', kind: 'sale', text: data.native, english: data.english, orderId: order.id, split: order.payout?.method === 'upi' ? order.payout : undefined, at: new Date().toISOString() }];
    threads.upsert(id, 'seller', seller.id, t?.history ?? [], messages);
    bus.emitEvent('seller.message', messages[messages.length - 1], id);
    emit(order, 'notify', 'done', data);
    // Makers who prefer listening get the same news as a voice note.
    voiceFor(data.native)
      .then((audio) => {
        const now = threads.get(id);
        if (now) threads.upsert(id, 'seller', seller.id, now.history, now.messages.map((m: any) => (m.id === msgId ? { ...m, audio } : m)));
        bus.emitEvent('seller.message.audio', { id: msgId, audio }, id);
      })
      .catch((e) => console.warn('voice note failed', e.message));
  } catch (err: any) {
    emit(order, 'notify', 'error', { error: err.message });
  }
  bus.emitEvent('autopilot.done', { orderId: order.id }, `seller:${seller.id}`);
  bus.emitEvent('autopilot.done', { orderId: order.id }, `order:${order.id}`);
}
