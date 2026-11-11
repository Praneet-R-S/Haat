// Dispute desk: reads real PayPal disputes, matches them to Haat orders, and drafts a
// response from the evidence Haat already holds (tracking on the capture, export invoice).

import { generateJSON } from '../ai/gemini.ts';
import { activity, orders, products } from '../db/index.ts';
import { acceptClaim, getDispute, listDisputes, provideTrackingEvidence } from '../paypal/api.ts';

const SCHEMA = {
  type: 'object',
  properties: {
    recommendation: { type: 'string', enum: ['submit_evidence', 'refund'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reason: { type: 'string', description: 'Two sentences for the seller, plain English' },
    evidence_note: { type: 'string', description: 'The note to send to PayPal with the evidence, factual, under 600 characters' },
  },
  required: ['recommendation', 'confidence', 'reason', 'evidence_note'],
};

export async function disputesWithAdvice() {
  const res = await listDisputes('dispute-desk');
  const items: any[] = res.data?.items ?? [];
  const out: any[] = [];
  for (const d of items.slice(0, 8)) {
    let detail: any = d;
    try {
      detail = (await getDispute(d.dispute_id, 'dispute-desk')).data;
    } catch {
      /* list item is enough */
    }
    const captureId = detail?.disputed_transactions?.[0]?.seller_transaction_id;
    const order = captureId ? orders.byCapture(captureId) : undefined;
    const product = order ? products.get(order.product_id) : undefined;
    let advice: any = null;
    try {
      advice = (
        await generateJSON<any>({
          system:
            'You help a small Indian exporter answer a PayPal dispute. Recommend submitting evidence only when Haat holds real proof (tracking attached to the capture, export invoice). Otherwise recommend a refund to protect the seller account. Be honest.',
          parts: [
            {
              text: JSON.stringify({
                dispute: { reason: detail?.reason, status: detail?.status, stage: detail?.dispute_life_cycle_stage, amount: detail?.dispute_amount, messages: detail?.messages?.slice(-3) },
                haat_order: order
                  ? { number: order.number, piece: product?.title, tracking: order.tracking, export_invoice: order.export_doc?.invoice_no, ship_to: order.ship_to?.country, paid_at: order.paid_at }
                  : null,
              }),
            },
          ],
          schema: SCHEMA,
          thinking: 'LOW',
        })
      ).data;
    } catch {
      /* advice optional */
    }
    out.push({
      id: d.dispute_id,
      reason: detail?.reason ?? d.reason,
      status: detail?.status ?? d.status,
      stage: detail?.dispute_life_cycle_stage,
      amount: detail?.dispute_amount ?? d.dispute_amount,
      created: d.create_time,
      order: order ? { id: order.id, number: order.number, tracking: order.tracking?.number, piece: product?.title } : null,
      advice,
    });
  }
  return out;
}

export async function respondToDispute(disputeId: string, action: 'submit_evidence' | 'refund', note: string) {
  const d = (await getDispute(disputeId, 'dispute-desk')).data;
  const captureId = d?.disputed_transactions?.[0]?.seller_transaction_id;
  const order = captureId ? orders.byCapture(captureId) : undefined;
  if (action === 'submit_evidence') {
    if (!order?.tracking?.number) throw new Error('No tracking on file for this order, so there is no proof of fulfilment to send');
    const res = await provideTrackingEvidence({ disputeId, carrier: 'India Post', trackingNumber: order.tracking.number, notes: note, actor: 'dispute-desk' });
    activity.add({ seller_id: order.seller_id, order_id: order.id, kind: 'dispute.evidence', title: `Evidence sent for dispute ${disputeId} (tracking ${order.tracking.number})`, detail: {} });
    return res.data;
  }
  const res = await acceptClaim(disputeId, note, 'dispute-desk');
  if (order) activity.add({ seller_id: order.seller_id, order_id: order.id, kind: 'dispute.refund', title: `Claim accepted and refunded for dispute ${disputeId}`, detail: {} });
  return res.data;
}
