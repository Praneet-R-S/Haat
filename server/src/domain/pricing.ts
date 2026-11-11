// Export pricing: work backwards from what the maker needs in rupees to a USD price
// that survives PayPal's cross-border fee, the currency conversion spread, GST on
// fees and international shipping. Fee figures are estimates and configurable.

import type { Pricing } from '../db/index.ts';

export const FEES = {
  // PayPal India commercial transactions received from abroad (published rate, check current page).
  pct: Number(process.env.FEE_PCT ?? 0.044),
  fixedUsd: Number(process.env.FEE_FIXED_USD ?? 0.3),
  // Spread applied when USD is converted to INR on withdrawal (estimate).
  fxSpread: Number(process.env.FX_SPREAD ?? 0.035),
  // GST charged on the fee portion.
  gstOnFees: 0.18,
  source: 'https://www.paypal.com/in/webapps/mpp/merchant-fees',
};

let fx: { rate: number; at: number; source: string } | null = null;

export async function inrPerUsd(): Promise<{ rate: number; source: string }> {
  if (fx && Date.now() - fx.at < 6 * 3600_000) return fx;
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(4000) });
    const body: any = await res.json();
    const rate = Number(body?.rates?.INR);
    if (rate > 50 && rate < 200) {
      fx = { rate, at: Date.now(), source: 'open.er-api.com mid-market' };
      return fx;
    }
  } catch {
    // fall through to the configured fallback
  }
  fx = { rate: Number(process.env.FX_FALLBACK ?? 88.5), at: Date.now(), source: 'fallback rate (offline)' };
  return fx;
}

/** Air parcel estimate India -> US/EU for small handmade goods (India Post / aggregator ballpark). */
export function shippingUsd(weightG: number): number {
  const kg = Math.max(0.25, weightG / 1000);
  return Math.round((9 + kg * 14) * 100) / 100;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * price = (cost_inr/fx + margin) grossed up so that after fee% + fixed fee,
 * GST on fees and conversion spread the maker still receives cost + margin.
 * Shipping is charged to the buyer separately.
 */
export async function priceForExport(costInr: number, weightG: number, marginPct = 0.25): Promise<Pricing> {
  const { rate, source } = await inrPerUsd();
  const costUsd = costInr / rate;
  const targetNetUsd = costUsd * (1 + marginPct);
  const feeFactor = FEES.pct * (1 + FEES.gstOnFees);
  const fixed = FEES.fixedUsd * (1 + FEES.gstOnFees);
  // net = (price - price*feeFactor - fixed) * (1 - spread)
  const raw = (targetNetUsd / (1 - FEES.fxSpread) + fixed) / (1 - feeFactor);
  // Round up to the next .99 price point that still covers the target
  const price = Math.ceil(raw) - 0.01 >= raw ? Math.ceil(raw) - 0.01 : Math.ceil(raw) + 0.99;
  const paypalFee = price * FEES.pct + FEES.fixedUsd;
  const gst = paypalFee * FEES.gstOnFees;
  const afterFees = price - paypalFee - gst;
  const spread = afterFees * FEES.fxSpread;
  const netUsd = afterFees - spread;
  return {
    cost_inr: round(costInr, 0),
    fx_inr_per_usd: round(rate, 2),
    shipping_usd: shippingUsd(weightG),
    paypal_fee_usd: round(paypalFee),
    fx_spread_usd: round(spread),
    gst_on_fees_usd: round(gst),
    margin_usd: round(netUsd - costUsd),
    price_usd: round(price),
    seller_take_home_inr: round(netUsd * rate, 0),
    notes: [
      `FX ${round(rate, 2)} INR/USD (${source})`,
      `PayPal fee ${(FEES.pct * 100).toFixed(1)}% + $${FEES.fixedUsd.toFixed(2)}, GST 18% on fees, ~${(FEES.fxSpread * 100).toFixed(1)}% conversion spread (estimates)`,
      `Shipping charged to buyer: $${shippingUsd(weightG).toFixed(2)} for ~${weightG} g by air`,
    ],
  };
}
