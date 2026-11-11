// The last mile: an Indian PayPal account receives the buyer's dollars into the cooperative's
// bank account; each maker's share then goes out by UPI. One row per maker: amount in rupees,
// a UPI deep link (opens GPay / PhonePe / Paytm / BHIM on a phone), a QR for desktops, and a
// "sent" mark the cooperative taps once the UPI app confirms.

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api, inr, useEvents } from './lib';

interface SplitItem {
  name: string;
  role?: string;
  inr: number;
  usd: number;
  upi_id?: string;
  link?: string;
  paid_at?: string | null;
}
export interface Split {
  method: 'upi' | 'paypal';
  pool_inr: number;
  items: SplitItem[];
  reason?: string;
}

function Qr({ text }: { text: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    QRCode.toString(text, { type: 'svg', margin: 0, color: { dark: '#1b1814', light: '#00000000' }, errorCorrectionLevel: 'M' }).then(setSvg);
  }, [text]);
  return <div className="size-24 [&>svg]:size-full" aria-label="UPI QR code" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function UpiSplit({ orderId, split: initial, sellerId, compact = false }: { orderId: string; split: Split; sellerId?: string; compact?: boolean }) {
  const [split, setSplit] = useState(initial);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  useEffect(() => setSplit(initial), [initial]);
  useEvents([sellerId ? `seller:${sellerId}` : `order:${orderId}`], (e) => {
    if (e.type === 'split.updated' && e.data.orderId === orderId) setSplit(e.data.payout);
  });
  const sent = split.items.filter((i) => i.paid_at).length;

  async function markSent(i: number) {
    setBusy(i);
    try {
      setSplit(await api<Split>(`/api/orders/${orderId}/split/${i}/paid`, { method: 'POST', json: {} }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={`rounded-xl bg-card/90 ${compact ? 'p-2.5' : 'p-4'} shadow-[inset_0_0_0_1px_var(--color-line)]`}>
      <div className="flex items-baseline justify-between gap-3">
        <p className={`font-medium ${compact ? 'text-[0.82rem]' : ''}`}>Each maker&rsquo;s share, by UPI</p>
        <p className="num text-[0.78rem] text-ink-3">
          {sent}/{split.items.length} sent · {inr(split.pool_inr)}
        </p>
      </div>
      <ul className="mt-2 divide-y divide-line">
        {split.items.map((it, i) => (
          <li key={i} className="py-2">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className={`leading-tight ${compact ? 'text-[0.82rem]' : 'text-[0.92rem]'}`}>{it.name}</p>
                <p className="num truncate text-[0.68rem] text-ink-3">{it.upi_id}</p>
              </div>
              <span className="num text-[0.9rem] text-indigo">{inr(it.inr)}</span>
              {it.paid_at ? (
                <span className="chip bg-leaf-soft text-leaf text-[0.7rem]">✓ sent</span>
              ) : (
                <div className="flex items-center gap-1">
                  <a href={it.link} className="btn btn-primary min-h-7 px-2.5 text-[0.72rem] no-underline" aria-label={`Pay ${it.name} by UPI`}>
                    UPI
                  </a>
                  <button className="btn btn-quiet min-h-7 px-2 text-[0.72rem]" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} aria-label={`Show QR for ${it.name}`}>
                    QR
                  </button>
                  <button className="btn btn-quiet min-h-7 px-2 text-[0.72rem]" disabled={busy === i} onClick={() => markSent(i)} title="Mark as sent once the UPI app confirms">
                    Sent
                  </button>
                </div>
              )}
            </div>
            {open === i && it.link && !it.paid_at && (
              <div className="mt-2 flex items-center gap-3 rise">
                <Qr text={it.link} />
                <p className="text-[0.7rem] leading-snug text-ink-3">Scan with any UPI app. Sample UPI ID on a demo handle: no UPI app will route a payment to it.</p>
              </div>
            )}
          </li>
        ))}
      </ul>
      {!compact && split.reason && <p className="mt-2 text-[0.75rem] text-ink-3">{split.reason}</p>}
    </div>
  );
}
