import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api, useEvents, type Order } from '../lib';
import { Shell, Wordmark } from '../ui';
import { SellerPhone, demo } from './SellerPhone';
import { BuyerAgent } from './Agent';
import { LedgerFeed } from './Ledger';
import { MoneyFlow, flowFromOrder } from '../MoneyFlow';

const CHAPTERS = [
  { key: 'sent', label: 'Voice note sent' },
  { key: 'drafted', label: 'Listing written' },
  { key: 'published', label: 'On the PayPal Catalog' },
  { key: 'chosen', label: 'An agent chose it' },
  { key: 'paid', label: 'Approved in PayPal' },
  { key: 'done', label: 'Split to makers' },
] as const;
type ChapterKey = (typeof CHAPTERS)[number]['key'];

const BUYER_ASK = 'Something new from Bagru: hand block-printed indigo cotton fabric I can sew into a summer dress. Under $45 delivered. If one fits, go ahead and set up the checkout.';

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function useStage() {
  const [t, setT] = useState<Partial<Record<ChapterKey, number>>>({});
  const [orderId, setOrderId] = useState<string | null>(null);
  const mark = (k: ChapterKey) => setT((x) => (x[k] ? x : { ...x, [k]: Date.now(), ...(k !== 'sent' && !x.sent ? { sent: Date.now() } : {}) }));
  useEffect(() => {
    const on = (e: Event) => {
      const st = (e as CustomEvent).detail?.stage as ChapterKey | undefined;
      if (st && CHAPTERS.some((c) => c.key === st)) mark(st);
    };
    window.addEventListener('haat:story', on);
    return () => window.removeEventListener('haat:story', on);
  }, []);
  useEvents(null, (e) => {
    if (e.type === 'listing.published') mark('published');
    if (e.type === 'order.created') mark('chosen');
    if (e.type === 'order.paid') {
      mark('paid');
      setOrderId(e.data?.order?.id ?? null);
    }
    if (e.type === 'autopilot.done') {
      mark('done');
      setOrderId((id) => id ?? e.data?.orderId ?? null);
    }
  });
  return { t, orderId, reset: () => (setT({}), setOrderId(null)) };
}

function Stopwatch({ start, end }: { start?: number; end?: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!start || end) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [start, end]);
  return <span className="num tabular-nums">{start ? mmss((end ?? Date.now()) - start) : '00:00'}</span>;
}

function Thread({ t }: { t: Partial<Record<ChapterKey, number>> }) {
  const done = CHAPTERS.filter((c) => t[c.key]).length;
  const last = done ? done - 1 : -1;
  return (
    <ol className="relative grid grid-cols-6 min-w-[560px]" aria-label="Progress of the demo">
      <span className="absolute left-[8.33%] right-[8.33%] top-[9px] h-[2px] rounded-full bg-line-2" aria-hidden />
      <span
        className="absolute left-[8.33%] top-[9px] h-[2px] rounded-full bg-indigo transition-[width] duration-700 ease-out"
        style={{ width: last <= 0 ? '0%' : `${(last / 5) * 83.34}%` }}
        aria-hidden
      />
      {CHAPTERS.map((c, i) => {
        const at = t[c.key];
        const isNext = !at && i === done;
        return (
          <li key={c.key} className="relative flex flex-col items-center text-center">
            <span
              className={`relative z-10 grid size-5 place-items-center rounded-full border-2 transition-colors duration-500 ${
                at ? 'border-indigo bg-indigo text-card' : isNext ? 'border-turmeric bg-card' : 'border-line-2 bg-paper'
              }`}
            >
              {at ? <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M1.5 5.5l2.5 2.5 4.5-6" /></svg> : isNext ? <span className="size-1.5 rounded-full bg-turmeric pulse-dot" /> : null}
            </span>
            <span className={`mt-1.5 text-[0.74rem] leading-tight ${at ? 'text-ink' : 'text-ink-3'}`}>{c.label}</span>
            <span className="num text-[0.68rem] text-ink-3 h-4">{at && t.sent ? `+${mmss(at - t.sent)}` : ''}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Three surfaces at once: the maker in Bagru, a buyer's agent abroad, and PayPal in between. */
export function LivePage() {
  const { t, orderId, reset } = useStage();
  const [order, setOrder] = useState<Order | null>(null);
  const [sheet, setSheet] = useState(false);
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (!t.done || !orderId) return;
    api<Order>(`/api/orders/${orderId}`).then((o) => {
      setOrder(o);
      if (shown.current !== orderId) {
        shown.current = orderId;
        setTimeout(() => setSheet(true), 900);
      }
    });
  }, [t.done, orderId]);

  async function resetDemo() {
    if (!confirm('Reset the sandbox demo? Orders, drafts and chats are cleared and the sample catalogue reloads.')) return;
    await api('/api/demo/reset', { method: 'POST', json: {} }).catch(() => {});
    location.reload();
  }

  const next = !t.sent ? 'start' : t.published && !t.chosen ? 'ask' : null;
  const flow = order ? flowFromOrder(order) : null;

  return (
    <div className="h-dvh flex flex-col bg-paper">
      <header className="shrink-0 border-b border-line">
        <div className="flex items-center gap-5 px-5 h-12">
          <Wordmark className="text-[1.3rem]" />
          <p className="text-sm text-ink-2 hidden xl:block">A maker in Bagru, a buyer&rsquo;s agent abroad, and PayPal in between. Live, on the PayPal sandbox.</p>
          <div className="ml-auto flex items-center gap-4 text-sm">
            <button onClick={resetDemo} className="text-ink-3 hover:text-ink">Reset</button>
            <Link to="/shop" className="text-ink-2">Exit</Link>
          </div>
        </div>
        <div className="flex items-center gap-6 px-5 pb-3 pt-1 overflow-x-auto">
          <div className="shrink-0 min-w-[150px]">
            <p className="label text-[0.62rem]">Voice note to makers&rsquo; split</p>
            <p className={`text-[1.65rem] leading-none mt-1 ${t.done ? 'text-indigo' : 'text-ink'}`}>
              <Stopwatch start={t.sent} end={t.done} />
            </p>
          </div>
          <div className="flex-1">
            <Thread t={t} />
          </div>
          <div className="shrink-0 w-[230px] flex justify-end">
            {next === 'start' && (
              <button className="btn btn-primary" onClick={() => demo('seller-sample')}>
                Send Rafiq&rsquo;s voice note
              </button>
            )}
            {next === 'ask' && (
              <button className="btn btn-primary" onClick={() => demo('buyer-ask', BUYER_ASK)}>
                Ask the buyer&rsquo;s agent
              </button>
            )}
            {t.drafted && !t.published && <p className="text-sm text-ink-2 text-right">Tap <strong className="font-medium">Publish</strong> on the phone</p>}
            {t.chosen && !t.paid && <p className="text-sm text-ink-2 text-right">Approve the purchase in PayPal</p>}
            {t.paid && !t.done && <p className="text-sm text-ink-2 text-right">The export desk is working</p>}
            {t.done && flow && (
              <button className="btn btn-quiet" onClick={() => setSheet(true)}>
                Where the money went
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="relative flex-1 min-h-0 grid gap-5 p-5 grid-cols-1 lg:grid-cols-[minmax(330px,380px)_1fr_minmax(340px,420px)]">
        <section className="min-h-[640px] lg:min-h-0 flex flex-col" aria-label="Seller">
          <p className="label mb-2">Rafiq&rsquo;s phone · Bagru, Rajasthan</p>
          <SellerPhone slug="bagru-chhipa-prints" className="flex-1 min-h-0 mx-2 mb-2" />
        </section>
        <section className="min-h-[600px] lg:min-h-0 flex flex-col" aria-label="Buyer">
          <p className="label mb-2">A buyer&rsquo;s shopping agent · abroad</p>
          <BuyerAgent compact className="flex-1 min-h-0" />
        </section>
        <section className="min-h-[500px] lg:min-h-0 flex flex-col" aria-label="PayPal ledger">
          <p className="label mb-2">PayPal, in between</p>
          <LedgerFeed className="flex-1 min-h-0" limit={80} />
        </section>

        {sheet && flow && order && (
          <div className="absolute inset-x-5 bottom-5 top-5 lg:left-[calc(380px+2.5rem)] z-20 flex flex-col overflow-hidden rounded-[16px] bg-card shadow-[0_30px_80px_-20px_rgba(30,20,10,.45)] sheet-in" role="dialog" aria-label="Where the money went">
            <div className="flex items-start justify-between gap-6 border-b border-line px-7 py-5">
              <div>
                <p className="label">
                  Order <span className="num">{order.number}</span> · {mmss((t.done ?? 0) - (t.sent ?? 0))} from voice note to makers&rsquo; split
                </p>
                <p className="display mt-1 text-[1.5rem] leading-tight">Every dollar, traced to the hands that made it.</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Link to={`/orders/${order.id}`} className="text-sm text-indigo">Open the order</Link>
                <a href={`/api/orders/${order.id}/export-invoice`} target="_blank" rel="noreferrer" className="text-sm text-indigo">Export invoice</a>
                <button className="btn btn-quiet min-h-9" onClick={() => setSheet(false)} aria-label="Close">Close</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-7 py-6">
              <MoneyFlow data={flow} title={`Where the buyer's ${'$' + Number(flow.gross).toFixed(2)} went`} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ app home

export function HomePage() {
  const steps = [
    { to: '/seller/bagru-chhipa-prints', title: 'A maker speaks', body: 'A photo and a voice note in Hindi or Tamil become an English listing, priced so the rupees survive the trip, published to the PayPal Catalog.' },
    { to: '/agent', title: 'An agent buys', body: 'A buyer abroad, or their AI shopping agent, finds the piece. The agent works inside a spending limit and the human approves every payment in PayPal.' },
    { to: '/ledger', title: 'The desk does the rest', body: 'GST export invoice under LUT, purpose code, tracking on the PayPal capture, and each maker’s share sent: by UPI from an Indian account, by PayPal Payouts from one outside India.' },
    { to: '/shop', title: 'Every dollar traced', body: 'Each order shows where the buyer’s money went: the fee, the shipping, and the rupees that reached each maker, by name.' },
  ];
  return (
    <Shell>
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-10 sm:pt-14 pb-16 grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:items-center">
        <div className="rise">
          <h1 className="display text-[2.6rem] sm:text-[3.6rem] leading-[0.98]">
            The export desk India&rsquo;s makers never had.
            <span className="block italic text-indigo">Run by agents. Settled by PayPal.</span>
          </h1>
          <p className="mt-6 max-w-lg text-ink-2 text-[1.02rem] leading-relaxed">
            Haat turns a craftsperson&rsquo;s voice note into a sale abroad, then handles the paperwork, the shipping proof and the split between the people who made it.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/live" className="btn btn-primary no-underline min-h-12 px-6 text-[1rem]">Watch the whole loop, live</Link>
            <Link to="/seller/bagru-chhipa-prints" className="btn btn-quiet no-underline min-h-12 px-5">Try the seller studio</Link>
          </div>
          <p className="mt-4 text-xs text-ink-3">Real PayPal sandbox calls. Sample maker profiles. Stock photography.</p>
        </div>
        <div className="relative mx-auto w-full max-w-[460px] rise" style={{ animationDelay: '120ms' }}>
          <div className="aspect-[4/5] overflow-hidden rounded-t-[999px] rounded-b-[14px] bg-sunk shadow-[var(--shadow-lift)]">
            <img src="/seed/hero-artisan.jpg" alt="A weaver at a wooden loom (stock photograph)" className="h-full w-full object-cover" />
          </div>
          <div className="absolute -bottom-6 -left-6 w-[52%] overflow-hidden rounded-[10px] border-4 border-paper shadow-[var(--shadow-lift)] sm:-left-10">
            <img src="/seed/block-stamp.jpg" alt="Carved wooden printing blocks (stock photograph)" className="aspect-[4/3] w-full object-cover" />
          </div>
        </div>
      </section>

      <section className="border-t border-line bg-card/50">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-14">
          <ol className="relative grid gap-10 md:grid-cols-4 md:gap-6">
            <span className="absolute left-[11px] top-3 bottom-3 w-[2px] bg-indigo/25 md:left-3 md:right-3 md:top-[11px] md:bottom-auto md:h-[2px] md:w-auto" aria-hidden />
            {steps.map((s) => (
              <li key={s.to} className="relative pl-10 md:pl-0 md:pt-10">
                <span className="absolute left-0 top-0 grid size-6 place-items-center rounded-full border-2 border-indigo bg-paper" aria-hidden>
                  <span className="size-2 rounded-full bg-indigo" />
                </span>
                <Link to={s.to} className="group no-underline text-ink">
                  <h2 className="display text-[1.35rem] leading-tight group-hover:text-indigo transition-colors">{s.title}</h2>
                  <p className="mt-2 text-[0.92rem] leading-relaxed text-ink-2">{s.body}</p>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </Shell>
  );
}
