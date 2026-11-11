// "Where the money went": one payment drawn as threads. The buyer's dollars come in on the
// left, peel off into costs (shipping, PayPal's fee, GST on the fee, conversion) and the rest
// runs on to the cooperative, where it splits into one strand per maker, named, in rupees.

import { useEffect, useRef, useState } from 'react';
import { inr, usd, type Order, type Product, type Maker } from './lib';

export interface FlowData {
  mode: 'actual' | 'estimate';
  gross: number;
  shipping: number;
  paypalFee: number;
  gst: number;
  spread: number;
  fx: number;
  makers: { name: string; role?: string; usd: number }[];
  keepUsd: number;
  keepLabel: string;
  buyerLabel: string;
  payoutMethod?: 'upi' | 'paypal';
}

const GST = 0.18;
const SPREAD = 0.035;

export function flowFromOrder(o: Order): FlowData | null {
  if (!o.capture_id) return null;
  const fx = o.export_doc?.fx?.inr_per_usd ?? (o.payout?.pool_inr && o.payout?.pool_usd ? o.payout.pool_inr / o.payout.pool_usd : 88);
  const gross = Number(o.settlement?.gross ?? o.amount_usd);
  const fee = Number(o.settlement?.paypal_fee ?? gross * 0.044 + 0.3);
  const net = Number(o.settlement?.net ?? gross - fee);
  const shipping = o.shipping_usd;
  const gst = Math.round(fee * GST * 100) / 100;
  const afterCosts = Math.max(0, net - shipping - gst);
  const spread = Math.round(afterCosts * SPREAD * 100) / 100;
  const makerSide = Math.max(0, afterCosts - spread);
  const makers = (o.payout?.items ?? []).map((i: any) => ({ name: i.name, role: i.role, usd: Number(i.usd) }));
  const paid = makers.reduce((s: number, m: { usd: number }) => s + m.usd, 0);
  return {
    mode: 'actual',
    gross,
    shipping,
    paypalFee: fee,
    gst,
    spread,
    fx: Number.isFinite(fx) ? fx : 88,
    makers,
    keepUsd: Math.max(0, makerSide - paid),
    keepLabel: makers.length ? 'The cooperative keeps' : `${o.seller?.name ?? 'The maker'}`,
    buyerLabel: o.ship_to?.city ? `A buyer in ${o.ship_to.city}` : 'The buyer',
    payoutMethod: o.payout?.method,
  };
}

export function flowFromProduct(p: Product, makers: Maker[] = []): FlowData {
  const x = p.pricing;
  const gross = x.price_usd + x.shipping_usd;
  const fee = gross * 0.044 + 0.3;
  const gst = fee * GST;
  const afterCosts = gross - fee - gst - x.shipping_usd;
  const spread = afterCosts * SPREAD;
  const makerSide = afterCosts - spread;
  const pool = makers.length ? makerSide * 0.7 : 0;
  const total = makers.reduce((s, m) => s + m.share_pct, 0) || 1;
  return {
    mode: 'estimate',
    gross,
    shipping: x.shipping_usd,
    paypalFee: fee,
    gst,
    spread,
    fx: x.fx_inr_per_usd,
    makers: makers.map((m) => ({ name: m.name, role: m.role, usd: (pool * m.share_pct) / total })),
    keepUsd: makerSide - pool,
    keepLabel: makers.length ? 'The cooperative keeps' : p.seller?.name ?? 'The maker',
    buyerLabel: 'You',
  };
}

function useCountUp(target: number, run: boolean, ms = 1400, delay = 0) {
  const [v, setV] = useState(run ? 0 : target);
  useEffect(() => {
    if (!run || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setV(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now() + delay;
    const tick = (t: number) => {
      const k = Math.min(1, Math.max(0, (t - t0) / ms));
      setV(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run]);
  return v;
}

function ribbon(x0: number, y0a: number, y0b: number, x1: number, y1a: number, y1b: number) {
  const xm = (x0 + x1) / 2;
  return `M${x0},${y0a} C${xm},${y0a} ${xm},${y1a} ${x1},${y1a} L${x1},${y1b} C${xm},${y1b} ${xm},${y0b} ${x0},${y0b} Z`;
}

function useInView<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (setSeen(true), io.disconnect()), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, seen };
}

const COST_STYLE = {
  shipping: { fill: '#cbc1b0', label: 'India Post air shipping' },
  fee: { fill: '#8a9bb3', label: 'PayPal fee' },
  gst: { fill: '#b7c2d1', label: 'GST on the fee' },
  spread: { fill: '#e2c27f', label: 'Currency conversion' },
};

export function MoneyFlow({ data, title, note, compact = false }: { data: FlowData; title?: string; note?: string; compact?: boolean }) {
  const { ref, seen } = useInView<HTMLDivElement>();
  const total = useCountUp(data.gross, seen, 1200);
  const makerTotalUsd = data.makers.reduce((s, m) => s + m.usd, 0) + data.keepUsd;

  // ---------------------------------------------------------------- layout (SVG units)
  const W = 1000;
  const H = compact ? 230 : 300;
  const top = 34;
  const gap = 7;
  const x0 = 0;
  const x1 = 420;
  const x2 = 720;
  const bar = 12;
  const scale = (H - 3 * gap) / data.gross;

  const costs = (['shipping', 'fee', 'gst', 'spread'] as const).map((k) => ({
    key: k,
    usd: k === 'shipping' ? data.shipping : k === 'fee' ? data.paypalFee : k === 'gst' ? data.gst : data.spread,
  }));
  const makerSide = Math.max(0.01, data.gross - costs.reduce((s, c) => s + c.usd, 0));

  // source segments (left bar, no gaps)
  let sy = top;
  const src = [{ key: 'maker', usd: makerSide }, ...costs.map((c) => ({ ...c }))].map((s) => {
    const h = s.usd * scale;
    const seg = { ...s, y0: sy, y1: sy + h };
    sy += h;
    return seg;
  });
  // middle targets with gaps
  let my = top;
  const mid = src.map((s, i) => {
    const h = s.y1 - s.y0;
    const node = { ...s, ty0: my, ty1: my + h };
    my += h + (i < src.length - 1 ? gap : 0);
    return node;
  });
  const makerNode = mid[0];
  // cost labels: keep at least 18 units apart so small amounts never collide
  const costLabels: { key: string; y: number; usd: number }[] = [];
  for (const m of mid.slice(1)) {
    const want = (m.ty0 + m.ty1) / 2 + 4;
    const prev = costLabels[costLabels.length - 1];
    costLabels.push({ key: m.key, usd: m.usd, y: prev ? Math.max(want, prev.y + 18) : want });
  }
  // right column: maker strands + keep
  const strands = [...data.makers.map((m) => ({ name: m.name, role: m.role, usd: m.usd, keep: false })), { name: data.keepLabel, role: '', usd: data.keepUsd, keep: true }].filter(
    (s) => s.usd > 0.004,
  );
  const sumStrands = strands.reduce((s, x) => s + x.usd, 0) || 1;
  const strandScale = (makerNode.ty1 - makerNode.ty0) / sumStrands;
  const rightGap = 14;
  const rightTotal = makerNode.ty1 - makerNode.ty0 + rightGap * (strands.length - 1);
  let ry = Math.max(top, (makerNode.ty0 + makerNode.ty1) / 2 - rightTotal / 2);
  let ly = makerNode.ty0;
  const right = strands.map((s) => {
    const h = s.usd * strandScale;
    const node = { ...s, ly0: ly, ly1: ly + h, ry0: ry, ry1: ry + h };
    ly += h;
    ry += h + rightGap;
    return node;
  });
  // maker labels need two lines each: keep their centres at least 38 units apart
  const labelY: number[] = [];
  for (const r of right) {
    const want = (r.ry0 + r.ry1) / 2;
    const prev = labelY[labelY.length - 1];
    labelY.push(prev !== undefined ? Math.max(want, prev + 38) : want);
  }
  const svgH = Math.max(top + H, ry, (labelY[labelY.length - 1] ?? 0) + 24, (costLabels[costLabels.length - 1]?.y ?? 0) + 10) + 12;

  const anim = (i: number) => ({
    clipPath: seen ? 'inset(0 0 0 0)' : 'inset(0 100% 0 0)',
    transition: `clip-path 900ms cubic-bezier(.3,.7,.2,1) ${180 + i * 140}ms`,
  });

  return (
    <div ref={ref} className="money-flow">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3 className={`display ${compact ? 'text-[1.25rem]' : 'text-[1.7rem]'} leading-tight`}>
          {title ?? (data.mode === 'estimate' ? 'Where your money goes' : 'Where the money went')}
        </h3>
        <p className="text-sm text-ink-3">
          {data.mode === 'estimate' ? 'Estimate before you buy' : data.payoutMethod === 'upi' ? 'From the PayPal capture and the UPI split' : 'From the PayPal capture and the Payouts batch'}
        </p>
      </div>

      {/* Wide screens: the threads */}
      <svg viewBox={`0 0 ${W} ${svgH}`} className="mt-4 hidden w-full sm:block" role="img" aria-label={`${usd(data.gross)} split into costs and the makers' shares`}>
        <defs>
          <linearGradient id="mf-maker" x1="0" x2="1">
            <stop offset="0" stopColor="#2e5584" stopOpacity="0.55" />
            <stop offset="1" stopColor="#1f3a5f" stopOpacity="0.9" />
          </linearGradient>
        </defs>
        {/* left: the buyer's payment */}
        <rect x={x0} y={top} width={bar} height={src[src.length - 1].y1 - top} rx="2" fill="#1b1814" />
        {mid.map((m, i) => (
          <path
            key={m.key}
            d={ribbon(x0 + bar, m.y0, m.y1, x1, m.ty0, m.ty1)}
            fill={m.key === 'maker' ? 'url(#mf-maker)' : COST_STYLE[m.key as keyof typeof COST_STYLE].fill}
            fillOpacity={m.key === 'maker' ? 1 : 0.75}
            style={anim(i)}
          />
        ))}
        {mid.map((m) => (
          <rect key={`n-${m.key}`} x={x1} y={m.ty0} width={bar} height={Math.max(1.5, m.ty1 - m.ty0)} rx="1.5" fill={m.key === 'maker' ? '#1f3a5f' : '#857c6f'} />
        ))}
        {/* cost labels */}
        {costLabels.map((m, i) => (
          <g key={`l-${m.key}`} style={{ opacity: seen ? 1 : 0, transition: `opacity 500ms ${700 + i * 140}ms` }}>
            <text x={x1 + bar + 10} y={m.y} className="mf-label">
              {COST_STYLE[m.key as keyof typeof COST_STYLE].label}
              <tspan className="mf-num" dx="8">{usd(m.usd)}</tspan>
            </text>
          </g>
        ))}
        {/* the cooperative's share, written on its own thread */}
        <text x={x1 - 14} y={(makerNode.ty0 + makerNode.ty1) / 2 + 5} textAnchor="end" className="mf-on" style={{ opacity: seen ? 1 : 0, transition: 'opacity 600ms 900ms' }}>
          {data.makers.length ? 'To the cooperative' : 'To the maker'} <tspan className="mf-num-on">{inr(makerTotalUsd * data.fx)}</tspan>
        </text>
        {/* right: the makers */}
        {right.map((r, i) => (
          <path
            key={`s-${i}`}
            d={ribbon(x1 + bar, r.ly0, r.ly1, x2, r.ry0, r.ry1)}
            fill={r.keep ? '#dfe5ec' : '#1f3a5f'}
            fillOpacity={r.keep ? 1 : 0.85 - i * 0.08}
            style={anim(mid.length + i)}
          />
        ))}
        {right.map((r, i) => (
          <g key={`r-${i}`} style={{ opacity: seen ? 1 : 0, transition: `opacity 600ms ${1300 + i * 160}ms` }}>
            <rect x={x2} y={r.ry0} width={bar} height={Math.max(2, r.ry1 - r.ry0)} rx="1.5" fill={r.keep ? '#8a9bb3' : '#1f3a5f'} />
            <text x={x2 + bar + 10} y={labelY[i] - 2} className={r.keep ? 'mf-label' : 'mf-name'}>
              {r.name}
            </text>
            {!r.keep && (
              <text x={x2 + bar + 10} y={labelY[i] + 15} className="mf-num">
                {inr(r.usd * data.fx)} <tspan className="mf-dim">· {usd(r.usd)}</tspan>
              </text>
            )}
            {r.keep && (
              <text x={x2 + bar + 10} y={labelY[i] + 15} className="mf-num">
                {inr(r.usd * data.fx)}
              </text>
            )}
          </g>
        ))}
        {/* headline numbers */}
        <text x={x0} y={top - 12} className="mf-label">{data.buyerLabel} {data.mode === 'estimate' ? 'pay' : 'paid'}</text>
        {right.length > 0 && <text x={x2} y={Math.min(right[0].ry0, top) - 12} className="mf-label">{data.makers.length ? (data.payoutMethod === 'upi' ? 'Each maker\u2019s share, by UPI' : data.payoutMethod === 'paypal' ? 'Paid to each maker by PayPal Payouts' : 'Each maker\u2019s share') : ''}</text>}
      </svg>

      {/* Phones: the same flow as a ledger */}
      <div className="mt-4 sm:hidden text-sm">
        <div className="flex items-baseline justify-between border-b border-line pb-2">
          <span>{data.buyerLabel} {data.mode === 'estimate' ? 'pay' : 'paid'}</span>
          <span className="num text-lg">{usd(total)}</span>
        </div>
        {costs.map((c) => (
          <div key={c.key} className="flex justify-between py-1.5 text-ink-2">
            <span>{COST_STYLE[c.key].label}</span>
            <span className="num">− {usd(c.usd)}</span>
          </div>
        ))}
        <div className="mt-1 border-t border-line pt-2">
          {right.map((r, i) => (
            <div key={i} className="flex justify-between py-1.5">
              <span className={r.keep ? 'text-ink-2' : 'font-medium'}>{r.name}</span>
              <span className="num text-indigo">{inr(r.usd * data.fx)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-baseline gap-x-8 gap-y-2">
        <p className="num text-[2.1rem] leading-none text-ink">{usd(total)}</p>
        <p className="text-sm text-ink-2 max-w-xl">
          {note ??
            (data.mode === 'estimate'
              ? `About ${inr(makerTotalUsd * data.fx)} of it reaches ${data.makers.length ? `${data.makers.length} makers and their cooperative` : 'the maker'}. Fees are estimates: PayPal 4.4% + $0.30, 18% GST on that fee, about 3.5% on conversion.`
              : data.payoutMethod === 'upi'
                ? `${inr(makerTotalUsd * data.fx)} of it is for the people who made it. PayPal brought the dollars into the cooperative\u2019s Indian bank account; each maker\u2019s share goes out by UPI. The PayPal fee is the real one from the capture; GST and conversion are estimates.`
                : `${inr(makerTotalUsd * data.fx)} of it went to the people who made it. The PayPal fee is the real one from the capture; GST and conversion are estimates.`)}
        </p>
      </div>
    </div>
  );
}
