import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Link } from 'react-router';
import { loadPayPal, useHealth, api } from './lib';

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <Link to="/" className={`display text-[1.55rem] leading-none text-ink no-underline ${className}`} aria-label="Haat home">
      Haat<span className="text-turmeric">.</span>
    </Link>
  );
}

const NAV = [
  { to: '/shop', label: 'Shop' },
  { to: '/agent', label: 'Shopping agent' },
  { to: '/seller/bagru-chhipa-prints', label: 'Seller studio' },
  { to: '/ledger', label: 'Ledger' },
  { to: '/live', label: 'Live' },
];

export function Shell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const h = useHealth();
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-dvh flex flex-col">
      <header className="sticky top-0 z-30 bg-paper/92 backdrop-blur-sm border-b border-line">
        <div className={`mx-auto flex h-14 items-center gap-6 px-4 sm:px-6 ${wide ? 'max-w-[1600px]' : 'max-w-6xl'}`}>
          <Wordmark />
          <nav className="hidden md:flex items-center gap-1 text-[0.93rem]" aria-label="Main">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-md no-underline transition-colors ${isActive ? 'bg-sunk text-ink' : 'text-ink-2 hover:text-ink hover:bg-sunk/70'}`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <SandboxPill configured={h?.paypal.configured} />
            <button className="md:hidden btn btn-quiet min-h-9 px-3" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Menu">
              Menu
            </button>
          </div>
        </div>
        {open && (
          <nav className="md:hidden border-t border-line px-4 py-2 flex flex-col" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} onClick={() => setOpen(false)} className="py-2.5 text-ink no-underline">
                {n.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

function SandboxPill({ configured }: { configured?: boolean }) {
  if (configured === undefined) return null;
  return configured ? (
    <span className="chip bg-indigo-soft text-indigo" title="All payments use PayPal's sandbox: real API calls, test money">
      <span className="size-1.5 rounded-full bg-indigo" /> PayPal sandbox
    </span>
  ) : (
    <span className="chip bg-madder-soft text-madder" title="Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to .env">
      PayPal not connected
    </span>
  );
}

export function Img({ src, alt, className = '' }: { src?: string; alt: string; className?: string }) {
  const [bad, setBad] = useState(false);
  if (!src || bad) return <div className={`bg-sunk ${className}`} role="img" aria-label={alt} />;
  return <img src={src} alt={alt} className={`object-cover ${className}`} loading="lazy" onError={() => setBad(true)} />;
}

export function Dots() {
  return (
    <span className="inline-flex gap-1 align-middle" aria-label="Working">
      <span className="size-1.5 rounded-full bg-current pulse-dot" />
      <span className="size-1.5 rounded-full bg-current pulse-dot [animation-delay:150ms]" />
      <span className="size-1.5 rounded-full bg-current pulse-dot [animation-delay:300ms]" />
    </span>
  );
}

const SOURCE_STYLE: Record<string, string> = {
  'PayPal Agent Toolkit': 'bg-indigo-soft text-indigo',
  'PayPal Orders API': 'bg-indigo-soft text-indigo',
  'PayPal Catalog API': 'bg-indigo-soft text-indigo',
};

/** A compact record of one tool call an agent made. */
export function ToolChip({ name, source, ok, ms }: { name: string; source?: string; ok?: boolean; ms?: number }) {
  const paypal = source?.startsWith('PayPal');
  return (
    <span className={`chip num text-[0.72rem] ${SOURCE_STYLE[source ?? ''] ?? (paypal ? 'bg-indigo-soft text-indigo' : '')}`} title={source}>
      {ok === undefined ? <Dots /> : ok ? <span aria-hidden>✓</span> : <span className="text-madder" aria-hidden>!</span>}
      {name}
      {ms !== undefined && <span className="opacity-60">{ms}ms</span>}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    created: 'bg-sunk text-ink-2',
    paid: 'bg-turmeric-soft text-[#6d4c12]',
    fulfilled: 'bg-leaf-soft text-leaf',
    disputed: 'bg-madder-soft text-madder',
    refunded: 'bg-madder-soft text-madder',
    failed: 'bg-madder-soft text-madder',
    live: 'bg-leaf-soft text-leaf',
    draft: 'bg-sunk text-ink-2',
  };
  const label: Record<string, string> = { created: 'awaiting payment', fulfilled: 'shipped' };
  return <span className={`chip ${map[status] ?? ''}`}>{label[status] ?? status}</span>;
}

/** PayPal Smart Buttons bound to a server-created order. */
export function PayPalButton({
  createOrder,
  onPaid,
  onError,
  actor = 'storefront',
}: {
  createOrder: () => Promise<string>;
  onPaid: (order: any) => void;
  onError?: (msg: string) => void;
  actor?: string;
}) {
  const h = useHealth();
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef({ createOrder, onPaid, onError });
  cb.current = { createOrder, onPaid, onError };
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'capturing'>('loading');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!h) return;
    if (!h.paypal.configured || !h.paypal.clientId) {
      setState('error');
      setMsg('PayPal sandbox is not connected on the server yet.');
      return;
    }
    let buttons: any;
    let cancelled = false;
    loadPayPal(h.paypal.clientId)
      .then((paypal) => {
        if (cancelled || !ref.current) return;
        buttons = paypal.Buttons({
          style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'paypal', height: 44 },
          createOrder: () => cb.current.createOrder(),
          onApprove: async (data: { orderID: string }) => {
            setState('capturing');
            try {
              const order = await api(`/api/checkout/orders/${data.orderID}/capture`, { method: 'POST', json: { actor } });
              cb.current.onPaid(order);
            } catch (e: any) {
              setState('ready');
              setMsg(e.message);
              cb.current.onError?.(e.message);
            }
          },
          onError: (err: any) => {
            const m = String(err?.message ?? err).slice(0, 200);
            setMsg(m);
            cb.current.onError?.(m);
          },
        });
        buttons.render(ref.current).then(() => !cancelled && setState('ready'));
      })
      .catch((e) => {
        setState('error');
        setMsg(e.message);
      });
    return () => {
      cancelled = true;
      buttons?.close?.();
    };
  }, [h?.paypal.clientId]);

  return (
    <div>
      {state === 'loading' && <div className="h-[44px] rounded-md bg-sunk animate-pulse" />}
      {state === 'capturing' && (
        <div className="h-[44px] rounded-md bg-turmeric-soft text-[#6d4c12] flex items-center justify-center gap-2 text-sm font-medium">
          Capturing payment with PayPal <Dots />
        </div>
      )}
      <div ref={ref} className={state === 'capturing' ? 'hidden' : ''} />
      {msg && <p className="mt-2 text-sm text-madder">{msg}</p>}
    </div>
  );
}

export function Section({ title, action, children, className = '' }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <h2 className="display text-[1.3rem]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
