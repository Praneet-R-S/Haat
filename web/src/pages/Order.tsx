import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { api, countryName, inr, usd, useEvents, type Activity, type Order } from '../lib';
import { Dots, Img, Shell, StatusBadge } from '../ui';
import { MoneyFlow, flowFromOrder } from '../MoneyFlow';
import { UpiSplit } from '../UpiSplit';

type Step = { key: string; title: string };
type StepState = { key: string; status: 'running' | 'done' | 'skipped' | 'error'; detail: any; at: string };

const STEPS: Step[] = [
  { key: 'settle', title: 'Payment settled on PayPal' },
  { key: 'paperwork', title: 'Export invoice under LUT, purpose code, HS code' },
  { key: 'ship', title: 'Parcel booked, tracking added to the PayPal capture' },
  { key: 'payout', title: 'Each maker\u2019s share worked out and sent' },
  { key: 'notify', title: 'Seller told, in their own language' },
];

function stepDetail(s: StepState | undefined, orderId: string) {
  if (!s) return null;
  const d = s.detail ?? {};
  switch (s.key) {
    case 'settle':
      return (
        <span>
          Gross <span className="num">{usd(d.gross)}</span> · PayPal fee <span className="num">{usd(d.fee)}</span> · net <span className="num">{usd(d.net)}</span>
          {d.net_inr ? <> (≈ <span className="num">{inr(d.net_inr)}</span>)</> : null}
          {d.protection ? <> · seller protection: {String(d.protection).toLowerCase().replace(/_/g, ' ')}</> : null}
        </span>
      );
    case 'paperwork':
      return d.invoice_no ? (
        <span>
          <a href={`/api/orders/${orderId}/export-invoice`} target="_blank" rel="noreferrer" className="text-indigo underline underline-offset-2">
            {d.invoice_no}
          </a>{' '}
          · purpose code <span className="num">{d.purpose_code}</span> · HS <span className="num">{d.hs_code}</span>
        </span>
      ) : null;
    case 'ship':
      return d.number ? (
        <span>
          <span className="num">{d.number}</span> · {d.carrier} · added to PayPal, buyer notified
        </span>
      ) : d.error ? (
        <span className="text-madder">{d.error}</span>
      ) : null;
    case 'payout':
      if (s.status === 'skipped') return <span>{d.reason}</span>;
      if (d.error) return <span className="text-madder">{d.error} {d.hint}</span>;
      if (d.method === 'upi' && d.items)
        return (
          <span>
            {d.items.map((i: any) => `${i.name} ${inr(i.inr)}`).join(' · ')} · UPI requests ready for the cooperative
          </span>
        );
      return d.items ? (
        <span>
          {d.items.map((i: any) => `${i.name} ${inr(i.inr)}`).join(' · ')}
          {d.batch_id && (
            <>
              {' '}· batch <span className="num">{d.batch_id}</span>
            </>
          )}
        </span>
      ) : d.pool_usd ? (
        <span>Splitting {usd(d.pool_usd)}</span>
      ) : null;
    case 'notify':
      return d.native ? <span className="deva">{d.native}</span> : null;
  }
  return null;
}

export function Autopilot({ orderId, initial = [], compact = false }: { orderId: string; initial?: StepState[]; compact?: boolean }) {
  const [steps, setSteps] = useState<Record<string, StepState>>({});
  useEffect(() => {
    const m: Record<string, StepState> = {};
    for (const s of initial) m[s.key] = s;
    setSteps((prev) => ({ ...m, ...prev }));
  }, [orderId, initial.length]);
  useEvents([`order:${orderId}`], (e) => {
    if (e.type === 'autopilot.step') setSteps((prev) => ({ ...prev, [e.data.key]: e.data }));
  });
  return (
    <ol className="relative">
      {STEPS.map((st, i) => {
        const s = steps[st.key];
        const status = s?.status;
        return (
          <li key={st.key} className={`relative grid grid-cols-[22px_1fr] gap-3 ${compact ? 'pb-3' : 'pb-5'} last:pb-0`}>
            {i < STEPS.length - 1 && <span className={`absolute left-[10px] top-6 bottom-0 w-px ${status === 'done' ? 'bg-leaf/50' : 'bg-line-2'}`} />}
            <span
              className={`mt-0.5 size-[21px] rounded-full grid place-items-center text-[11px] font-semibold transition-colors ${
                status === 'done'
                  ? 'bg-leaf text-card'
                  : status === 'running'
                    ? 'bg-turmeric text-card'
                    : status === 'error'
                      ? 'bg-madder text-card'
                      : status === 'skipped'
                        ? 'bg-line-2 text-ink-2'
                        : 'bg-card text-ink-3 shadow-[inset_0_0_0_1px_var(--color-line-2)]'
              }`}
              aria-hidden
            >
              {status === 'done' ? '✓' : status === 'error' ? '!' : status === 'running' ? <span className="size-1.5 rounded-full bg-card pulse-dot" /> : i + 1}
            </span>
            <div className="min-w-0">
              <p className={`leading-snug ${status ? 'text-ink' : 'text-ink-3'} ${compact ? 'text-[0.88rem]' : ''}`}>
                {st.title} {status === 'running' && <Dots />}
              </p>
              {s && <div className={`mt-1 text-ink-2 ${compact ? 'text-[0.78rem]' : 'text-sm'} break-words`}>{stepDetail(s, orderId)}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function OrderPage() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const [o, setO] = useState<(Order & { activity: Activity[]; autopilot: StepState[] }) | null>(null);
  const load = () => api(`/api/orders/${id}`).then(setO);
  useEffect(() => {
    load();
  }, [id]);
  useEvents([`order:${id}`], (e) => e.type === 'autopilot.done' && load());
  if (!o) return <Shell><div className="p-10 text-ink-3">Loading</div></Shell>;
  const p = o.product!;
  return (
    <Shell>
      <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-10 pb-20">
        {sp.get('paid') && (
          <p className="rise mb-6 inline-flex items-center gap-2 rounded-full bg-leaf-soft text-leaf px-4 py-1.5 text-sm font-medium">
            Paid with PayPal. Thank you.
          </p>
        )}
        <div className="grid gap-10 md:grid-cols-[1fr_1.15fr]">
          <div>
            <div className="flex gap-4">
              <Img src={p.images[0]} alt={p.title} className="size-24 rounded-lg shrink-0" />
              <div>
                <p className="label">Order {o.number}</p>
                <h1 className="display text-[1.6rem] leading-tight mt-1">{p.title}</h1>
                <p className="text-ink-2 text-sm mt-1">
                  {o.seller?.business}, {o.seller?.place}
                </p>
              </div>
            </div>
            <dl className="mt-8 space-y-3 text-sm">
              <div className="flex justify-between"><dt className="text-ink-2">Status</dt><dd><StatusBadge status={o.status} /></dd></div>
              <div className="flex justify-between"><dt className="text-ink-2">Total</dt><dd className="num">{usd(o.amount_usd)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-2">Bought via</dt><dd>{o.channel === 'storefront' ? 'Haat shop' : o.channel === 'mcp' ? 'An outside AI agent (MCP)' : 'Haat shopping agent'}</dd></div>
              {o.ship_to && <div className="flex justify-between"><dt className="text-ink-2">Ships to</dt><dd>{o.ship_to.city}, {countryName(o.ship_to.country)}</dd></div>}
              {o.tracking?.number && <div className="flex justify-between"><dt className="text-ink-2">Tracking</dt><dd className="num">{o.tracking.number}</dd></div>}
              <div className="flex justify-between"><dt className="text-ink-2">PayPal order</dt><dd className="num text-xs">{o.paypal_order_id}</dd></div>
              {o.capture_id && <div className="flex justify-between"><dt className="text-ink-2">Capture</dt><dd className="num text-xs">{o.capture_id}</dd></div>}
            </dl>
            {o.agent_note && <p className="mt-6 text-sm text-ink-2 border-l-2 border-turmeric pl-3">Agent&rsquo;s reason: {o.agent_note}</p>}
          </div>
          <div className="card p-6">
            <h2 className="display text-xl mb-1">What happened after you paid</h2>
            <p className="text-sm text-ink-2 mb-6">The seller&rsquo;s export desk agent took it from here. Every step below is a real PayPal sandbox call or a document it prepared.</p>
            <Autopilot orderId={o.id} initial={o.autopilot} />
            {o.payout?.method === 'upi' && (
              <div className="mt-6">
                <UpiSplit orderId={o.id} split={o.payout} />
              </div>
            )}
          </div>
        </div>
        {flowFromOrder(o) && (
          <section className="mt-12 border-t border-line pt-10 rise">
            {o.paid_at && o.payout?.at && (
              <p className="label mb-3">
                {o.payout.method === 'upi' ? 'Makers\u2019 shares ready' : 'Makers paid'} <span className="num text-ink">{Math.max(1, Math.round((new Date(o.payout.at).getTime() - new Date(o.paid_at).getTime()) / 1000))}s</span> after the buyer approved in PayPal
              </p>
            )}
            <MoneyFlow data={flowFromOrder(o)!} />
          </section>
        )}
        <p className="mt-10 text-sm"><Link to="/shop" className="text-indigo">Keep browsing</Link></p>
      </div>
    </Shell>
  );
}
