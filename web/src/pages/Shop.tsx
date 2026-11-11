import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, inr, usd, useApi, type Product } from '../lib';
import { Img, PayPalButton, Shell } from '../ui';
import { MoneyFlow, flowFromProduct } from '../MoneyFlow';

export function ShopPage() {
  const { data } = useApi<Product[]>('/api/products');
  const [cat, setCat] = useState('All');
  const cats = ['All', ...Array.from(new Set((data ?? []).map((p) => p.category)))];
  const list = (data ?? []).filter((p) => cat === 'All' || p.category === cat);
  return (
    <Shell>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-10 pb-20">
        <div className="grid gap-6 md:grid-cols-[1.2fr_1fr] md:items-end mb-10">
          <h1 className="display text-[2.4rem] sm:text-[3.1rem] leading-[1.02]">Bought from the person who made it.</h1>
          <p className="text-ink-2 max-w-md md:justify-self-end">
            Every piece ships from the maker&rsquo;s own town. Payment goes through PayPal, and each page shows how much of it reaches the people who made the piece.
          </p>
        </div>
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1" role="tablist" aria-label="Category">
          {cats.map((c) => (
            <button
              key={c}
              role="tab"
              aria-selected={cat === c}
              onClick={() => setCat(c)}
              className={`chip text-[0.85rem] px-3 py-1.5 transition-colors ${cat === c ? 'bg-ink text-card' : 'hover:bg-line'}`}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-9">
          {list.map((p, i) => (
            <Link key={p.id} to={`/p/${p.slug}`} className="group no-underline text-ink rise" style={{ animationDelay: `${i * 40}ms` }}>
              <div className="overflow-hidden rounded-[10px] bg-sunk aspect-[4/5]">
                <Img src={p.images[0]} alt={p.title} className="h-full w-full transition-transform duration-700 group-hover:scale-[1.03]" />
              </div>
              <div className="mt-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-medium leading-snug">{p.title}</h3>
                  <p className="text-ink-3 text-sm mt-0.5 truncate">
                    {p.seller?.business}, {p.seller?.place}
                  </p>
                </div>
                <span className="num text-[0.95rem] shrink-0">{usd(p.price_usd)}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </Shell>
  );
}

export function MoneySplit({ p, qty = 1 }: { p: Product; qty?: number }) {
  const x = p.pricing;
  if (!x?.price_usd) return null;
  const parts = [
    { label: 'Reaches the maker', usd: x.price_usd - x.paypal_fee_usd - x.gst_on_fees_usd - x.fx_spread_usd, cls: 'bg-leaf' },
    { label: 'PayPal fee', usd: x.paypal_fee_usd, cls: 'bg-indigo' },
    { label: 'GST on fee', usd: x.gst_on_fees_usd, cls: 'bg-indigo-2' },
    { label: 'Currency conversion', usd: x.fx_spread_usd, cls: 'bg-turmeric' },
  ];
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full" aria-hidden>
        {parts.map((s) => (
          <div key={s.label} className={s.cls} style={{ width: `${(s.usd / x.price_usd) * 100}%` }} />
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        {parts.map((s) => (
          <div key={s.label} className="flex items-center justify-between gap-2">
            <dt className="flex items-center gap-2 text-ink-2">
              <span className={`size-2 rounded-full ${s.cls}`} />
              {s.label}
            </dt>
            <dd className="num">{usd(s.usd * qty)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm text-ink-2">
        About <strong className="num text-ink">{inr(x.seller_take_home_inr * qty)}</strong> lands in the maker&rsquo;s bank account in India. Fee figures are estimates.
      </p>
    </div>
  );
}

export function ProductPage() {
  const { slug } = useParams();
  const nav = useNavigate();
  const { data: p, error } = useApi<Product>(`/api/products/${slug}`, [slug]);
  const [qty, setQty] = useState(1);
  const [err, setErr] = useState('');
  if (error) return <Shell><p className="p-10 text-madder">{error}</p></Shell>;
  if (!p) return <Shell><div className="mx-auto max-w-6xl p-10 text-ink-3">Loading</div></Shell>;
  const s = p.seller!;
  const total = p.price_usd * qty + (p.pricing.shipping_usd ?? 0);
  return (
    <Shell>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-8 pb-20 grid gap-10 lg:grid-cols-[1.1fr_1fr]">
        <div className="lg:sticky lg:top-20 self-start">
          <div className="overflow-hidden rounded-[12px] bg-sunk aspect-[4/5]">
            <Img src={p.images[0]} alt={p.title} className="h-full w-full" />
          </div>
        </div>
        <div className="rise">
          <Link to="/shop" className="text-sm text-ink-3 no-underline hover:text-ink">← All pieces</Link>
          <h1 className="display text-[2.1rem] leading-[1.08] mt-3">{p.title}</h1>
          <p className="text-ink-2 mt-2">{p.subtitle}</p>
          <div className="mt-6 flex items-baseline gap-3">
            <span className="num text-[1.7rem]">{usd(p.price_usd)}</span>
            <span className="text-ink-3 text-sm">+ {usd(p.pricing.shipping_usd)} India Post air shipping</span>
          </div>

          <div className="card mt-6 p-5">
            <div className="flex items-center justify-between gap-4 mb-4">
              <label className="text-sm text-ink-2 flex items-center gap-3">
                Quantity
                <select className="field w-20 min-h-9 py-1" value={qty} onChange={(e) => setQty(Number(e.target.value))}>
                  {Array.from({ length: Math.min(p.stock, 5) }, (_, i) => i + 1).map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              <span className="text-sm">
                Total <span className="num">{usd(total)}</span>
              </span>
            </div>
            {p.stock > 0 ? (
              <PayPalButton
                createOrder={async () => (await api('/api/checkout/orders', { method: 'POST', json: { productId: p.id, quantity: qty } })).id}
                onPaid={(o) => nav(`/orders/${o.id}?paid=1`)}
                onError={setErr}
              />
            ) : (
              <p className="text-madder">Sold out. The maker has been told.</p>
            )}
            {err && <p className="text-sm text-madder mt-2">{err}</p>}
            <p className="text-xs text-ink-3 mt-3">Sandbox checkout: log in with a PayPal sandbox buyer account. No real money moves.</p>
          </div>

          <p className="mt-4 text-sm text-ink-2">
            <a href="#where" className="text-indigo">See exactly how much of your payment reaches {p.makers?.length ? `the ${p.makers.length} makers` : 'the maker'} in India</a>
          </p>

          <p className="mt-8 leading-relaxed text-[1.02rem]">{p.story}</p>

          <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 text-sm border-t border-line pt-6">
            {[
              ['Materials', p.materials.join(', ')],
              ['Size', p.dimensions],
              ['Care', p.care],
              ['HS code', p.hs_code],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="label">{k}</dt>
                <dd className={`mt-1 ${k === 'HS code' ? 'num' : ''}`}>{v}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-10 border-t border-line pt-6">
            <h2 className="label mb-2">Made by</h2>
            <p className="display text-xl">{s.business}</p>
            <p className="text-ink-2 text-sm mt-1">
              {s.place}, {s.state} · {s.craft}
            </p>
            <p className="mt-3 text-ink-2 leading-relaxed">{s.bio}</p>
            {!!p.makers?.length && (
              <p className="mt-3 text-sm text-ink-2">
                {p.makers.length} makers share each sale through PayPal Payouts: {p.makers.map((m) => m.name).join(', ')}.
              </p>
            )}
          </div>
        </div>
      </div>
      <section id="where" className="mx-auto max-w-6xl px-4 sm:px-6 pb-24 scroll-mt-20">
        <div className="border-t border-line pt-10">
          <MoneyFlow data={flowFromProduct(p, p.makers ?? [])} title={`Where your ${usd(p.price_usd + p.pricing.shipping_usd)} goes`} />
        </div>
      </section>
    </Shell>
  );
}
