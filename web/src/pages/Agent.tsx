import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { stream, usd } from '../lib';
import { Dots, Img, PayPalButton, Shell, ToolChip } from '../ui';

type Item =
  | { kind: 'buyer'; text: string }
  | { kind: 'agent'; text: string }
  | { kind: 'tools'; calls: { id: string; name: string; source?: string; ok?: boolean; ms?: number }[] }
  | { kind: 'results'; items: any[] }
  | { kind: 'checkout'; data: any; paid?: any }
  | { kind: 'blocked'; reason: string }
  | { kind: 'error'; text: string };

const SUGGESTIONS = [
  'A handmade gift for my mother, she likes indigo. Under $60 delivered.',
  'Something for my balcony garden, made by hand',
  'Fabric I can sew into a summer dress',
];

function sessionId() {
  try {
    let s = sessionStorage.getItem('haat-buyer-session');
    if (!s) {
      s = Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem('haat-buyer-session', s);
    }
    return s;
  } catch {
    return 'anon';
  }
}

export function BuyerAgent({ className = '', compact = false }: { className?: string; compact?: boolean }) {
  const [items, setItems] = useState<Item[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [budget, setBudget] = useState(80);
  const [country, setCountry] = useState('United States');
  const sid = useRef(sessionId());
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [items]);

  const sendRef = useRef<(m?: string) => void>(() => {});
  useEffect(() => {
    const on = (ev: Event) => {
      const { action, detail } = (ev as CustomEvent).detail ?? {};
      if (action === 'buyer-ask' && typeof detail === 'string') sendRef.current(detail);
    };
    window.addEventListener('haat:demo', on);
    return () => window.removeEventListener('haat:demo', on);
  }, []);

  async function send(msg?: string) {
    const t = (msg ?? text).trim();
    if (!t || busy) return;
    setText('');
    setBusy(true);
    setItems((x) => [...x, { kind: 'buyer', text: t }]);
    try {
      await stream('/api/buyer/message', { sessionId: sid.current, text: t, mandate: { budgetUsd: budget, shipCountry: country } }, (line) => {
        if (line.type === 'event') {
          const e = line.event;
          if (e.kind === 'tool_call')
            setItems((x) => {
              const last = x[x.length - 1];
              const call = { id: e.id, name: e.name, source: e.source };
              return last?.kind === 'tools' ? [...x.slice(0, -1), { kind: 'tools', calls: [...last.calls, call] }] : [...x, { kind: 'tools', calls: [call] }];
            });
          if (e.kind === 'tool_result') {
            setItems((x) =>
              x.map((it) => (it.kind === 'tools' ? { ...it, calls: it.calls.map((c) => (c.id === e.id ? { ...c, ok: e.ok, ms: e.ms } : c)) } : it)),
            );
            if (e.name === 'search_catalog' && e.ok && Array.isArray(e.result) && e.result.length) setItems((x) => [...x, { kind: 'results', items: e.result.slice(0, 3) }]);
            if (e.name === 'request_checkout' && e.ok) {
              if (e.result?.blocked) setItems((x) => [...x, { kind: 'blocked', reason: e.result.reason }]);
              else if (e.result?.paypal_order_id) setItems((x) => [...x, { kind: 'checkout', data: e.result }]);
            }
          }
          if (e.kind === 'text') setItems((x) => [...x, { kind: 'agent', text: e.text }]);
        }
        if (line.type === 'error') setItems((x) => [...x, { kind: 'error', text: line.error }]);
      });
    } catch (e: any) {
      setItems((x) => [...x, { kind: 'error', text: e.message }]);
    } finally {
      setBusy(false);
    }
  }

  sendRef.current = send;

  function markPaid(orderNo: string, order: any) {
    setItems((x) => x.map((it) => (it.kind === 'checkout' && it.data.order_number === orderNo ? { ...it, paid: order } : it)));
  }

  return (
    <div className={`flex flex-col overflow-hidden rounded-[14px] bg-card shadow-[var(--shadow-lift)] ${className}`}>
      <div className="border-b border-line px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="font-medium leading-tight">Your shopping agent</p>
          <p className="text-[0.75rem] text-ink-3">Spends only inside your mandate. You approve every payment in PayPal.</p>
        </div>
        <div className="ml-auto flex items-center gap-3 text-[0.8rem]">
          <label className="flex items-center gap-2">
            <span className="text-ink-3">Up to</span>
            <input type="range" min={20} max={300} step={5} value={budget} onChange={(e) => setBudget(Number(e.target.value))} aria-label="Budget per purchase" className="w-20 accent-[var(--color-indigo)]" />
            <span className="num w-12">{usd(budget).replace('.00', '')}</span>
          </label>
          {!compact && (
            <select value={country} onChange={(e) => setCountry(e.target.value)} className="field min-h-8 py-1 w-auto text-[0.8rem]" aria-label="Ship to">
              {['United States', 'United Kingdom', 'Germany', 'Canada', 'Australia', 'Singapore'].map((c) => <option key={c}>{c}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" aria-live="polite">
        {items.length === 0 && (
          <div className="py-6">
            <p className="display text-[1.35rem] leading-snug max-w-sm">Tell it what you&rsquo;re looking for. It shops makers in India, not warehouses.</p>
            <div className="mt-4 flex flex-col items-start gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="text-left text-[0.88rem] rounded-lg px-3 py-2 bg-sunk hover:bg-line transition-colors">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {items.map((it, i) => {
          if (it.kind === 'buyer')
            return (
              <div key={i} className="flex justify-end rise">
                <p className="max-w-[80%] rounded-2xl rounded-br-md bg-indigo text-card px-3.5 py-2 text-[0.92rem]">{it.text}</p>
              </div>
            );
          if (it.kind === 'agent')
            return (
              <p key={i} className="max-w-[92%] text-[0.94rem] leading-relaxed rise whitespace-pre-wrap">
                {it.text.split(/\*\*(.+?)\*\*/g).map((part, j) => (j % 2 ? <strong key={j} className="font-medium">{part}</strong> : part.replace(/^\s*[*-] /gm, '· ')))}
              </p>
            );
          if (it.kind === 'tools')
            return (
              <div key={i} className="flex flex-wrap gap-1.5">
                {it.calls.map((c) => <ToolChip key={c.id} {...c} />)}
              </div>
            );
          if (it.kind === 'results')
            return (
              <div key={i} className="grid grid-cols-3 gap-2 rise">
                {it.items.map((p: any) => (
                  <Link key={p.product_id} to={`/p/${p.slug}`} target="_blank" className="no-underline text-ink">
                    <Img src={p.image} alt={p.title} className="aspect-square w-full rounded-lg" />
                    <p className="mt-1 text-[0.74rem] leading-snug line-clamp-2">{p.title}</p>
                    <p className="num text-[0.72rem] text-ink-3">{usd(p.landed_usd)} landed</p>
                  </Link>
                ))}
              </div>
            );
          if (it.kind === 'blocked')
            return <p key={i} className="rounded-lg bg-madder-soft text-madder px-3 py-2 text-sm">Mandate check stopped this: {it.reason}</p>;
          if (it.kind === 'error') return <p key={i} className="text-sm text-madder">{it.text}</p>;
          const d = it.data;
          return (
            <div key={i} className="rounded-xl border border-line-2 bg-paper p-3.5 rise">
              <div className="flex gap-3">
                <Img src={d.product?.image} alt="" className="size-14 rounded-md shrink-0" />
                <div className="min-w-0 text-sm">
                  <p className="label text-[0.64rem]">Approve purchase · {d.order_number}</p>
                  <p className="font-medium leading-snug mt-0.5">{d.product?.title}</p>
                  <p className="text-ink-3 text-[0.78rem]">{d.product?.maker}</p>
                </div>
                <p className="ml-auto num text-[1.05rem]">{usd(d.total_usd)}</p>
              </div>
              {d.reason && <p className="mt-2 text-[0.8rem] text-ink-2">&ldquo;{d.reason}&rdquo;</p>}
              <div className="mt-3">
                {it.paid ? (
                  <div className="rounded-lg bg-leaf-soft text-leaf px-3 py-2 text-sm flex items-center justify-between">
                    <span>Paid. The maker&rsquo;s export desk is on it.</span>
                    <Link to={`/orders/${it.paid.id}`} className="text-leaf underline">Track</Link>
                  </div>
                ) : (
                  <PayPalButton actor="buyer-agent" createOrder={async () => d.paypal_order_id} onPaid={(o) => markPaid(d.order_number, o)} />
                )}
              </div>
            </div>
          );
        })}
        {busy && <p className="text-ink-3 text-sm">Working <Dots /></p>}
        <div ref={endRef} />
      </div>

      <form className="border-t border-line p-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="What are you looking for?" className="field" aria-label="Message the shopping agent" />
        <button className="btn btn-primary shrink-0" disabled={busy || !text.trim()}>Send</button>
      </form>
    </div>
  );
}

export function AgentPage() {
  return (
    <Shell>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-8 pb-16 grid gap-10 lg:grid-cols-[1fr_340px]">
        <BuyerAgent className="h-[min(780px,calc(100dvh-8rem))]" />
        <aside className="text-sm text-ink-2 space-y-6 lg:pt-2">
          <div>
            <h2 className="display text-xl text-ink">How it stays safe</h2>
            <ul className="mt-3 space-y-2.5 list-none p-0">
              <li><strong className="text-ink font-medium">A mandate, not a blank cheque.</strong> The agent can only prepare purchases under the limit you set. Anything above it is refused before PayPal is called.</li>
              <li><strong className="text-ink font-medium">You always approve.</strong> The agent creates a real PayPal order; money moves only when you approve it in PayPal.</li>
              <li><strong className="text-ink font-medium">Every call is on the ledger.</strong> Each PayPal request, with its debug id, is visible on the Ledger page.</li>
            </ul>
          </div>
          <div>
            <h2 className="display text-xl text-ink">Bring your own agent</h2>
            <p className="mt-2">Haat is also an MCP server. Point Claude, ChatGPT or any MCP client at <code className="num text-ink">/mcp</code> and it gets the same four tools: search, details, checkout, order status.</p>
            <Link to="/ledger#mcp" className="mt-2 inline-block text-indigo">Connection details</Link>
          </div>
        </aside>
      </div>
    </Shell>
  );
}
