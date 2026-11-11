import { useEffect, useRef, useState } from 'react';

// ------------------------------------------------------------------ types

export interface Pricing {
  cost_inr: number;
  fx_inr_per_usd: number;
  shipping_usd: number;
  paypal_fee_usd: number;
  fx_spread_usd: number;
  gst_on_fees_usd: number;
  margin_usd: number;
  price_usd: number;
  seller_take_home_inr: number;
  notes: string[];
}
export interface Seller {
  id: string;
  slug: string;
  name: string;
  business: string;
  craft: string;
  place: string;
  state: string;
  language: string;
  language_name: string;
  bio: string;
  gstin: string | null;
  iec: string | null;
  lut_arn: string | null;
}
export interface Maker {
  id: string;
  name: string;
  role: string;
  share_pct: number;
  paypal_email: string;
  upi_id?: string;
}
export interface Product {
  id: string;
  slug: string;
  seller_id: string;
  status: 'draft' | 'live';
  title: string;
  subtitle: string;
  story: string;
  category: string;
  materials: string[];
  dimensions: string | null;
  weight_g: number;
  care: string | null;
  tags: string[];
  hs_code: string | null;
  hs_reason: string | null;
  cost_inr: number;
  price_usd: number;
  pricing: Pricing;
  images: string[];
  stock: number;
  source_language: string | null;
  source_transcript: string | null;
  paypal_product_id: string | null;
  created_at: string;
  seller?: Seller;
  makers?: Maker[];
}
export interface Order {
  id: string;
  number: string;
  product_id: string;
  seller_id: string;
  quantity: number;
  amount_usd: number;
  shipping_usd: number;
  channel: 'storefront' | 'buyer-agent' | 'mcp';
  status: string;
  paypal_order_id: string | null;
  capture_id: string | null;
  buyer_name: string | null;
  buyer_email: string | null;
  ship_to: any;
  agent_note: string | null;
  export_doc: any;
  tracking: any;
  payout: any;
  settlement: any;
  created_at: string;
  paid_at: string | null;
  product?: Product;
  seller?: Seller;
}
export interface Activity {
  id: string;
  at: string;
  seller_id: string | null;
  order_id: string | null;
  kind: string;
  title: string;
  detail: any;
}
export interface LedgerEntry {
  id: string;
  at: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  ok: boolean;
  label?: string;
  actor?: string;
  debugId?: string;
  summary?: string;
}
export interface AppEvent {
  type: string;
  at: string;
  channel?: string;
  data: any;
}
export type AgentEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool_call'; id: string; name: string; source?: string; args: unknown }
  | { kind: 'tool_result'; id: string; name: string; ok: boolean; result: any; ms: number }
  | { kind: 'done'; text: string; model: string }
  | { kind: 'heard'; original: string; english: string };

export interface Health {
  ok: boolean;
  paypal: { configured: boolean; env: string; clientId: string | null; toolkitTools: string[] };
  ai: { configured: boolean; models: string[] };
  publicUrl: string;
  webhook: boolean;
}

// ------------------------------------------------------------------ fetch

export async function api<T = any>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { ...(init?.json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

/** POST and read an NDJSON stream line by line. */
export async function stream(path: string, body: unknown, onLine: (obj: any) => void) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.body) throw new Error('No stream');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onLine(JSON.parse(line));
    }
  }
  if (buf.trim()) onLine(JSON.parse(buf));
}

export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    api<T>(path)
      .then((d) => live && (setData(d), setError(null)))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [path, n, ...deps]);
  return { data, error, reload: () => setN((x) => x + 1), setData };
}

/** Subscribe to server events. `channels` null = everything. */
export function useEvents(channels: string[] | null, onEvent: (e: AppEvent) => void, replay = false) {
  const ref = useRef(onEvent);
  ref.current = onEvent;
  const key = channels ? channels.join(',') : '*';
  useEffect(() => {
    const qs = new URLSearchParams();
    if (channels) qs.set('channels', channels.join(','));
    if (!replay) qs.set('replay', '0');
    const es = new EventSource(`/api/events?${qs}`);
    const handler = (m: MessageEvent) => {
      try {
        ref.current(JSON.parse(m.data));
      } catch {
        /* ignore */
      }
    };
    const types = ['ledger', 'studio.step', 'listing.published', 'order.created', 'order.paid', 'autopilot.step', 'autopilot.done', 'seller.message', 'seller.message.audio', 'split.updated', 'webhook', 'mcp.call'];
    types.forEach((t) => es.addEventListener(t, handler));
    return () => es.close();
  }, [key, replay]);
}

let healthPromise: Promise<Health> | null = null;
export function useHealth() {
  const [h, setH] = useState<Health | null>(null);
  useEffect(() => {
    healthPromise ??= api<Health>('/api/health');
    healthPromise.then(setH).catch(() => setH(null));
  }, []);
  return h;
}

// ------------------------------------------------------------------ PayPal JS SDK

declare global {
  interface Window {
    paypal?: any;
  }
}
let sdkPromise: Promise<any> | null = null;
export function loadPayPal(clientId: string) {
  if (window.paypal) return Promise.resolve(window.paypal);
  sdkPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=buttons`;
    s.dataset.sdkIntegrationSource = 'developer-studio';
    s.onload = () => resolve(window.paypal);
    s.onerror = () => reject(new Error('Could not load PayPal'));
    document.head.appendChild(s);
  });
  return sdkPromise;
}

// ------------------------------------------------------------------ format

export const usd = (n: number | string | undefined | null) =>
  n === undefined || n === null || n === '' ? '' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const inr = (n: number | string | undefined | null) =>
  n === undefined || n === null || n === '' ? '' : `₹${Math.round(Number(n)).toLocaleString('en-IN')}`;
export const ago = (iso: string) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
export const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const scriptClass = (lang?: string | null) => (lang === 'ta' || lang === 'Tamil' ? 'taml' : lang === 'hi' || lang === 'Hindi' ? 'deva' : '');
export const countryName = (code?: string) => {
  if (!code) return '';
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
};

export async function fileToB64(file: Blob): Promise<{ data: string; mime: string }> {
  const buf = await file.arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { data: btoa(bin), mime: file.type || 'application/octet-stream' };
}

/** Downscale a photo before upload (phones produce 12 MP images). */
export async function shrinkImage(file: File, max = 1600): Promise<{ data: string; mime: string; preview: string }> {
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = url;
  });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL('image/jpeg', 0.86);
  URL.revokeObjectURL(url);
  return { data: dataUrl.split(',')[1], mime: 'image/jpeg', preview: dataUrl };
}
