import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, ago, countryName, fileToB64, inr, scriptClass, shrinkImage, stream, usd, useEvents, type Activity, type Maker, type Order, type Product, type Seller } from '../lib';
import { Dots, Img, Shell, StatusBadge, ToolChip } from '../ui';
import { Autopilot } from './Order';
import { SellerPhone } from './SellerPhone';
export { SellerPhone };

type Msg = any;

type SellerFull = Seller & { makers: Maker[]; products: Product[]; orders: Order[]; invoices: any[]; activity: Activity[]; thread: Msg[] };

// ------------------------------------------------------------------ desk

export function SellerDesk({ slug }: { slug: string }) {
  const [s, setS] = useState<SellerFull | null>(null);
  const [tab, setTab] = useState<'orders' | 'listings' | 'invoices' | 'makers'>('orders');
  const load = () => api<SellerFull>(`/api/sellers/${slug}`).then(setS);
  useEffect(() => {
    load();
  }, [slug]);
  useEvents(s ? [`seller:${s.id}`] : null, (e) => {
    if (['order.paid', 'order.created', 'listing.published', 'autopilot.done'].includes(e.type)) load();
  });
  if (!s) return null;
  const paid = s.orders.filter((o) => o.status !== 'created');
  const earned = paid.reduce((sum, o) => sum + (o.export_doc?.fx?.total_inr ?? 0), 0);
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Seller studio</p>
          <h1 className="display text-[2rem] leading-tight mt-1">{s.business}</h1>
          <p className="text-ink-2 text-sm mt-1">{s.name} · {s.place}, {s.state} · speaks {s.language_name}</p>
        </div>
        <dl className="flex gap-6 text-sm">
          <div><dt className="label">Live pieces</dt><dd className="num text-lg">{s.products.filter((p) => p.status === 'live').length}</dd></div>
          <div><dt className="label">Paid orders</dt><dd className="num text-lg">{paid.length}</dd></div>
          <div><dt className="label">Invoiced abroad</dt><dd className="num text-lg">{inr(earned)}</dd></div>
        </dl>
      </div>
      <div className="mt-6 flex gap-1 border-b border-line" role="tablist">
        {(['orders', 'listings', 'invoices', 'makers'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`px-3 py-2 -mb-px border-b-2 capitalize text-[0.92rem] ${tab === t ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:text-ink'}`}>
            {t}
          </button>
        ))}
      </div>
      <div className="pt-5">
        {tab === 'orders' && (
          <div className="space-y-4">
            {s.orders.length === 0 && <p className="text-ink-3 text-sm">No orders yet. Buy something in the shop or ask the shopping agent.</p>}
            {s.orders.map((o) => (
              <div key={o.id} className="card p-4 rise">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Img src={o.product?.images[0]} alt="" className="size-11 rounded-md shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium truncate">{o.product?.title}</p>
                      <p className="text-xs text-ink-3">
                        <span className="num">{o.number}</span> · {usd(o.amount_usd)} · {o.ship_to ? countryName(o.ship_to.country) : 'awaiting payment'} · {o.channel === 'storefront' ? 'shop' : o.channel === 'mcp' ? 'outside agent' : 'shopping agent'} · {ago(o.created_at)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={o.status} />
                    <Link to={`/orders/${o.id}`} className="text-sm text-indigo">Open</Link>
                  </div>
                </div>
                {o.status !== 'created' && (
                  <div className="mt-4 border-t border-line pt-4">
                    <Autopilot orderId={o.id} compact initial={[]} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {tab === 'listings' && (
          <div className="grid gap-3 sm:grid-cols-2">
            {s.products.map((p) => (
              <Link key={p.id} to={`/p/${p.slug}`} className="card p-3 flex gap-3 no-underline text-ink">
                <Img src={p.images[0]} alt="" className="size-16 rounded-md shrink-0" />
                <div className="min-w-0 text-sm">
                  <p className="font-medium leading-snug">{p.title}</p>
                  <p className="text-ink-3 mt-1"><span className="num">{usd(p.price_usd)}</span> · you get <span className="num">{inr(p.pricing.seller_take_home_inr)}</span> · {p.stock} left</p>
                  <div className="mt-1.5 flex gap-1.5"><StatusBadge status={p.status} />{p.paypal_product_id && <span className="chip bg-indigo-soft text-indigo">PayPal Catalog</span>}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
        {tab === 'invoices' && (
          <div className="space-y-2 text-sm">
            {s.invoices.length === 0 && <p className="text-ink-3">No wholesale invoices yet. In the chat, ask: &ldquo;Send an invoice to a shop in Berlin for 20 dupattas&rdquo;.</p>}
            {s.invoices.map((i) => (
              <div key={i.id} className="card p-3 flex flex-wrap justify-between gap-3">
                <div>
                  <p className="font-medium">{i.buyer_name ?? i.buyer_email}</p>
                  <p className="text-ink-3 text-xs">{i.items?.map((x: any) => `${x.quantity} × ${x.title}`).join(', ')}</p>
                </div>
                <div className="text-right">
                  <p className="num">{usd(i.amount_usd)}</p>
                  <p className="text-xs text-ink-3 num">{i.paypal_invoice_id} · {i.status}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        {tab === 'makers' && (
          <div className="text-sm">
            {s.makers.length === 0 ? (
              <p className="text-ink-3">{s.name} works alone, so sales are not split.</p>
            ) : (
              <>
                <p className="text-ink-2 mb-3">After each sale, 70% of the item&rsquo;s net goes to the makers below: by UPI from the cooperative on an Indian PayPal account, or by PayPal Payouts from an account outside India. The rest stays with the cooperative for yarn, dye and rent.</p>
                <table className="w-full">
                  <thead><tr className="text-left"><th className="label py-2">Maker</th><th className="label">Role</th><th className="label text-right">Share</th></tr></thead>
                  <tbody>
                    {s.makers.map((m) => (
                      <tr key={m.id} className="border-t border-line"><td className="py-2">{m.name}</td><td className="text-ink-2">{m.role}</td><td className="num text-right">{m.share_pct}%</td></tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function SellerPage() {
  const { slug = 'bagru-chhipa-prints' } = useParams();
  return (
    <Shell wide>
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 pt-8 pb-16 grid gap-10 lg:grid-cols-[400px_1fr]">
        <div>
          <SellerSwitch current={slug} />
          <SellerPhone key={slug} slug={slug} className="h-[min(760px,calc(100dvh-9rem))] mt-4" />
        </div>
        <SellerDesk key={slug} slug={slug} />
      </div>
    </Shell>
  );
}

function SellerSwitch({ current }: { current: string }) {
  const [list, setList] = useState<Seller[]>([]);
  useEffect(() => {
    api<Seller[]>('/api/sellers').then(setList);
  }, []);
  return (
    <div className="flex gap-1.5 flex-wrap">
      {list.map((s) => (
        <Link key={s.id} to={`/seller/${s.slug}`} className={`chip no-underline text-[0.78rem] px-2.5 py-1 ${s.slug === current ? 'bg-ink text-card' : 'hover:bg-line'}`}>
          {s.name}
        </Link>
      ))}
    </div>
  );
}
