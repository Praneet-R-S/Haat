import { useEffect, useState } from 'react';
import { api, clock, useApi, useEvents, useHealth, type Activity, type LedgerEntry } from '../lib';
import { Dots, Shell } from '../ui';

const ACTOR: Record<string, string> = {
  'seller-agent': 'seller agent',
  'buyer-agent': 'buyer agent',
  'mcp-agent': 'outside agent',
  'dispute-desk': 'dispute desk',
  storefront: 'shop',
  system: 'system',
  seller: 'seller',
  webhook: 'webhook',
  ops: 'ops',
};

export function LedgerFeed({ className = '', limit = 60 }: { className?: string; limit?: number }) {
  const [rows, setRows] = useState<(LedgerEntry & { fresh?: boolean })[]>([]);
  useEffect(() => {
    api<LedgerEntry[]>('/api/ledger').then((r) => setRows(r.slice(0, limit)));
  }, []);
  useEvents(null, (e) => {
    if (e.type === 'ledger') setRows((r) => [{ ...e.data, fresh: true }, ...r].slice(0, limit));
  });
  const calls = rows.filter((r) => r.method !== 'TOOL').length;
  const kit = rows.filter((r) => r.method === 'TOOL').length;
  return (
    <div className={`flex flex-col overflow-hidden rounded-[14px] bg-night text-[#e9e2d4] ${className}`}>
      <div className="flex items-center gap-3 border-b border-night-line px-4 py-3">
        <span className="size-2 rounded-full bg-[#7fb38a] pulse-dot" aria-hidden />
        <p className="font-medium">PayPal sandbox ledger</p>
        <p className="ml-auto text-[0.75rem] text-[#a39a8b] num">{calls} REST · {kit} Agent Toolkit</p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 && <p className="p-4 text-sm text-[#a39a8b]">Waiting for the first PayPal call. Publish a listing or buy something.</p>}
        <ul className="divide-y divide-night-line">
          {rows.map((r) => (
            <li key={r.id} className={`px-4 py-2.5 ${r.fresh ? 'ledger-in' : ''}`}>
              <div className="flex items-center gap-2 text-[0.78rem] num">
                <span className={`rounded px-1.5 py-px text-[0.68rem] ${r.method === 'TOOL' ? 'bg-[#2c3b52] text-[#b9cbe6]' : 'bg-night-2 text-[#d8cfbf]'}`}>{r.method === 'TOOL' ? 'KIT' : r.method}</span>
                <span className="truncate text-[#efe7d8]">{r.path}</span>
                <span className={`ml-auto shrink-0 ${r.ok ? 'text-[#8fc79a]' : 'text-[#f0a08f]'}`}>{r.status || 'ERR'}</span>
                <span className="shrink-0 text-[#8a8173] w-14 text-right">{r.ms}ms</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[0.74rem] text-[#a39a8b]">
                <span className="truncate">{r.label}</span>
                <span className="ml-auto shrink-0">{ACTOR[r.actor ?? ''] ?? r.actor}</span>
                <span className="shrink-0 num">{clock(r.at)}</span>
              </div>
              {r.debugId && <div className="text-[0.68rem] text-[#7d7466] num">debug_id {r.debugId}</div>}
              {r.summary && <div className="text-[0.72rem] text-[#f0a08f]">{r.summary}</div>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function ActivityFeed({ className = '' }: { className?: string }) {
  const { data, reload } = useApi<Activity[]>('/api/activity');
  useEvents(null, (e) => {
    if (['order.paid', 'autopilot.step', 'listing.published', 'autopilot.done'].includes(e.type)) reload();
  });
  return (
    <ul className={`space-y-3 ${className}`}>
      {(data ?? []).slice(0, 25).map((a) => (
        <li key={a.id} className="grid grid-cols-[64px_1fr] gap-3 text-sm">
          <span className="num text-[0.75rem] text-ink-3 pt-0.5">{clock(a.at)}</span>
          <span className="text-ink-2">{a.title}</span>
        </li>
      ))}
    </ul>
  );
}

function Disputes() {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [list, setList] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [acting, setActing] = useState<string | null>(null);
  async function load() {
    setState('loading');
    try {
      setList(await api('/api/disputes'));
      setState('done');
    } catch (e: any) {
      setErr(e.message);
      setState('error');
    }
  }
  async function respond(d: any, action: string) {
    setActing(d.id);
    try {
      await api(`/api/disputes/${d.id}/respond`, { method: 'POST', json: { action, note: d.advice?.evidence_note ?? '' } });
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setActing(null);
    }
  }
  return (
    <div>
      <p className="text-sm text-ink-2 max-w-2xl">
        Reads open disputes from PayPal, matches each to a Haat order, and drafts a response from evidence Haat already holds: the tracking number on the capture and the export invoice. The seller decides; nothing is sent without a click.
      </p>
      <button className="btn btn-quiet mt-4" onClick={load} disabled={state === 'loading'}>
        {state === 'loading' ? <>Reading disputes <Dots /></> : 'Check PayPal for disputes'}
      </button>
      {err && <p className="mt-3 text-sm text-madder">{err}</p>}
      {state === 'done' && list.length === 0 && (
        <p className="mt-4 text-sm text-ink-3">No disputes on this sandbox account. To try it, log in to sandbox.paypal.com as the buyer, open a paid Haat order and report a problem.</p>
      )}
      <div className="mt-4 space-y-3">
        {list.map((d) => (
          <div key={d.id} className="card p-4 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <p className="font-medium">{String(d.reason ?? '').replace(/_/g, ' ').toLowerCase()} · <span className="num">{d.amount?.value} {d.amount?.currency_code}</span></p>
              <span className="chip num">{d.id} · {d.status}</span>
            </div>
            {d.order && <p className="mt-1 text-ink-2">Order <span className="num">{d.order.number}</span> · {d.order.piece} · tracking <span className="num">{d.order.tracking ?? 'none'}</span></p>}
            {d.advice && (
              <div className="mt-3 rounded-lg bg-paper p-3">
                <p><strong className="font-medium">Advice ({d.advice.confidence}):</strong> {d.advice.recommendation === 'refund' ? 'Refund' : 'Send proof of fulfilment'}. {d.advice.reason}</p>
                <p className="mt-1.5 text-ink-2 text-[0.82rem]">{d.advice.evidence_note}</p>
                <div className="mt-3 flex gap-2">
                  <button className="btn btn-primary min-h-9" disabled={!!acting || !d.order?.tracking} onClick={() => respond(d, 'submit_evidence')}>Send evidence</button>
                  <button className="btn btn-quiet min-h-9" disabled={!!acting} onClick={() => respond(d, 'refund')}>Accept and refund</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function McpInfo() {
  const h = useHealth();
  const url = `${h?.publicUrl ?? location.origin}/mcp`;
  const cfg = JSON.stringify({ mcpServers: { haat: { type: 'http', url } } }, null, 2);
  return (
    <div className="text-sm text-ink-2 max-w-2xl">
      <p>Any MCP-capable agent can shop Haat. The server speaks Streamable HTTP (stateless) and exposes four tools: <code className="num">search_catalog</code>, <code className="num">product_details</code>, <code className="num">request_checkout</code> (creates a PayPal order and returns the approval link) and <code className="num">order_status</code>.</p>
      <pre className="mt-4 rounded-lg bg-night text-[#e9e2d4] p-4 text-[0.8rem] overflow-x-auto num">{cfg}</pre>
      <p className="mt-3">When the agent shares the approval link, the human approves in PayPal, PayPal returns them to Haat, and the capture plus the seller&rsquo;s autopilot run exactly as they do in the shop.</p>
    </div>
  );
}

export function LedgerPage() {
  const [tab, setTab] = useState<'activity' | 'disputes' | 'mcp'>(location.hash === '#mcp' ? 'mcp' : 'activity');
  return (
    <Shell wide>
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 pt-8 pb-16 grid gap-8 lg:grid-cols-[1fr_520px]">
        <div>
          <p className="label">Operations</p>
          <h1 className="display text-[2rem] leading-tight mt-1">Everything the agents did, and every PayPal call they made.</h1>
          <div className="mt-6 flex gap-1 border-b border-line" role="tablist">
            {([['activity', 'Agent activity'], ['disputes', 'Dispute desk'], ['mcp', 'MCP for outside agents']] as const).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`px-3 py-2 -mb-px border-b-2 text-[0.92rem] ${tab === k ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:text-ink'}`}>
                {l}
              </button>
            ))}
          </div>
          <div className="pt-6">
            {tab === 'activity' && <ActivityFeed />}
            {tab === 'disputes' && <Disputes />}
            {tab === 'mcp' && <McpInfo />}
          </div>
        </div>
        <LedgerFeed className="h-[min(820px,calc(100dvh-8rem))] lg:sticky lg:top-20" limit={120} />
      </div>
    </Shell>
  );
}
