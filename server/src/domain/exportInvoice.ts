// Printable GST export invoice (export of goods under LUT). Plain HTML, print-friendly.

import type { Order, Product, Seller } from '../db/index.ts';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function renderExportInvoice(order: Order, product: Product, seller: Seller): string {
  const d = order.export_doc;
  if (!d) return '<p>Export paperwork is still being prepared.</p>';
  const to = d.consignee ?? {};
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Export invoice ${esc(d.invoice_no)}</title>
<style>
  :root{--ink:#1d1a16;--soft:#6b6358;--line:#d9d2c6;--paper:#fbf8f2;--mark:#8a3b12}
  *{box-sizing:border-box} body{margin:0;background:#e9e4da;font:14px/1.5 "IBM Plex Sans",system-ui,sans-serif;color:var(--ink)}
  .sheet{max-width:820px;margin:32px auto;background:var(--paper);padding:48px 52px;box-shadow:0 1px 2px rgba(0,0,0,.08),0 12px 40px rgba(60,40,20,.12)}
  h1{font:600 22px/1.2 "IBM Plex Serif",Georgia,serif;margin:0 0 4px} .muted{color:var(--soft)}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin:28px 0}
  .label{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--soft);margin-bottom:4px}
  table{width:100%;border-collapse:collapse;margin:8px 0 20px} th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:top}
  th{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--soft);font-weight:500} td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
  .decl{border:1.5px solid var(--mark);color:var(--mark);padding:12px 14px;font-weight:600;letter-spacing:.02em;margin:20px 0}
  .row{display:flex;justify-content:space-between;gap:16px;border-top:1px solid var(--line);padding-top:14px;margin-top:14px}
  ul{margin:6px 0 0 18px;padding:0} code{font:12px "IBM Plex Mono",ui-monospace,monospace}
  .print{position:fixed;right:20px;bottom:20px;padding:10px 16px;border:0;background:var(--ink);color:#fff;border-radius:6px;cursor:pointer;font:inherit}
  @media print{body{background:#fff}.sheet{box-shadow:none;margin:0}.print{display:none}}
  @media (max-width:640px){.sheet{padding:24px 18px;margin:0}.grid{grid-template-columns:1fr}}
</style></head><body><main class="sheet">
<h1>Tax invoice: export of goods</h1>
<div class="muted">Invoice ${esc(d.invoice_no)} · ${esc(d.date)} · Order ${esc(order.number)}</div>
<div class="grid">
  <div><div class="label">Exporter</div><strong>${esc(d.exporter.name)}</strong><br>${esc(d.exporter.place)}<br>
    GSTIN <code>${esc(d.exporter.gstin ?? 'not set')}</code><br>IEC <code>${esc(d.exporter.iec ?? 'not set')}</code><br>LUT ARN <code>${esc(d.exporter.lut_arn ?? 'not set')}</code></div>
  <div><div class="label">Consignee</div><strong>${esc(to.name ?? d.buyer?.name ?? '')}</strong><br>${esc(to.line1 ?? '')}${to.line2 ? '<br>' + esc(to.line2) : ''}<br>
    ${esc([to.city, to.state, to.postal].filter(Boolean).join(', '))}<br>${esc(to.country ?? '')}</div>
</div>
<table><thead><tr><th>Description of goods</th><th>HS code</th><th class="n">Qty</th><th class="n">Unit (USD)</th><th class="n">Amount (USD)</th></tr></thead>
<tbody><tr><td>${esc(d.item.description)}<div class="muted">${esc(product.title)}</div></td><td><code>${esc(d.item.hs_code)}</code></td><td class="n">${esc(d.item.quantity)}</td>
<td class="n">${Number(d.item.unit_usd).toFixed(2)}</td><td class="n">${(Number(d.item.unit_usd) * Number(d.item.quantity)).toFixed(2)}</td></tr>
<tr><td colspan="4">International freight (India Post EMS)</td><td class="n">${Number(d.item.shipping_usd).toFixed(2)}</td></tr>
<tr><td colspan="4"><strong>Total invoice value</strong> (≈ ₹${Number(d.fx.total_inr).toLocaleString('en-IN')} at ${esc(d.fx.inr_per_usd)} INR/USD)</td><td class="n"><strong>${Number(d.item.total_usd).toFixed(2)}</strong></td></tr>
<tr><td colspan="4">IGST</td><td class="n">0.00</td></tr></tbody></table>
<div class="decl">${esc(d.declaration)}</div>
<div class="grid">
  <div><div class="label">GST treatment</div>${esc(d.gst_treatment)}<div class="label" style="margin-top:14px">HS check</div>${esc(d.hs_check)}</div>
  <div><div class="label">Inward remittance</div>Received via PayPal<br>Order <code>${esc(d.paypal.order_id)}</code><br>Capture <code>${esc(d.paypal.capture_id)}</code>
    <div class="label" style="margin-top:14px">RBI purpose code</div><strong>${esc(d.purpose_code)}</strong> ${esc(d.purpose_code_label)}<div class="muted">${esc(d.purpose_reason)}</div></div>
</div>
<div class="label">Keep for the e-FIRA / e-BRC match</div><ul>${(d.checks ?? []).map((c: string) => `<li>${esc(c)}</li>`).join('')}</ul>
<div class="row muted"><span>Prepared by Haat's export desk agent for ${esc(seller.name)}. Check before filing.</span><span>Sandbox demo document</span></div>
</main><button class="print" onclick="print()">Print or save PDF</button></body></html>`;
}
