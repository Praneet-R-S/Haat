// Thin, typed PayPal REST client.
// Every request is recorded on the ledger bus so the UI can show live API traffic
// (method, path, status, latency, PayPal-Debug-Id) next to what the agents decided.

import { randomUUID } from 'node:crypto';
import { bus } from '../events/bus.ts';

export type PayPalEnv = 'sandbox' | 'live';

const BASES: Record<PayPalEnv, string> = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
};

export function paypalEnv(): PayPalEnv {
  return process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox';
}

export function paypalBase(): string {
  return BASES[paypalEnv()];
}

export function paypalConfigured(): boolean {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

export class PayPalError extends Error {
  status: number;
  issue?: string;
  details?: unknown;
  debugId?: string;
  constructor(message: string, status: number, body?: any, debugId?: string) {
    super(message);
    this.name = 'PayPalError';
    this.status = status;
    this.issue = body?.details?.[0]?.issue ?? body?.name ?? body?.error;
    this.details = body?.details ?? body;
    this.debugId = debugId ?? body?.debug_id;
  }
}

let cached: { token: string; expiresAt: number } | null = null;
let inflight: Promise<string> | null = null;

export async function getAccessToken(): Promise<string> {
  if (!paypalConfigured()) {
    throw new PayPalError(
      'PayPal sandbox credentials are missing. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env',
      500,
    );
  }
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;
  if (inflight) return inflight;
  inflight = (async () => {
    const started = Date.now();
    const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
    const res = await fetch(`${paypalBase()}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const body: any = await res.json().catch(() => ({}));
    bus.ledger({
      id: randomUUID(),
      at: new Date().toISOString(),
      method: 'POST',
      path: '/v1/oauth2/token',
      status: res.status,
      ms: Date.now() - started,
      ok: res.ok,
      label: 'OAuth 2.0 client credentials',
      actor: 'system',
      debugId: res.headers.get('paypal-debug-id') ?? undefined,
    });
    if (!res.ok) throw new PayPalError(body?.error_description ?? 'PayPal auth failed', res.status, body);
    cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return cached.token;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export interface PPRequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  /** PayPal-Request-Id for idempotent POSTs. Pass a stable key to make retries safe. */
  requestId?: string;
  /** Human-readable description shown on the ledger. */
  label?: string;
  /** Which agent or surface made the call (seller-agent, buyer-agent, storefront, system). */
  actor?: string;
  prefer?: 'return=representation' | 'return=minimal';
  /** Raw body (e.g. multipart form data). When set, `body` is ignored. */
  rawBody?: BodyInit;
}

export interface PPResponse<T> {
  data: T;
  status: number;
  debugId?: string;
}

export async function pp<T = any>(method: string, path: string, opts: PPRequestOptions = {}): Promise<PPResponse<T>> {
  const token = await getAccessToken();
  const url = new URL(paypalBase() + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    ...opts.headers,
  };
  if (!opts.rawBody && opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.requestId) headers['PayPal-Request-Id'] = opts.requestId;
  if (opts.prefer) headers['Prefer'] = opts.prefer;

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch (err: any) {
    bus.ledger({
      id: randomUUID(),
      at: new Date().toISOString(),
      method,
      path: url.pathname,
      status: 0,
      ms: Date.now() - started,
      ok: false,
      label: opts.label,
      actor: opts.actor ?? 'system',
      summary: `network error: ${err?.message ?? err}`,
    });
    throw new PayPalError(`Network error calling PayPal: ${err?.message ?? err}`, 0);
  }
  const debugId = res.headers.get('paypal-debug-id') ?? undefined;
  const text = await res.text();
  let data: any = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  bus.ledger({
    id: randomUUID(),
    at: new Date().toISOString(),
    method,
    path: url.pathname,
    status: res.status,
    ms: Date.now() - started,
    ok: res.ok,
    label: opts.label,
    actor: opts.actor ?? 'system',
    debugId,
    summary: res.ok ? undefined : data?.details?.[0]?.description ?? data?.message ?? data?.name,
  });
  if (!res.ok) {
    if (res.status === 401) cached = null;
    const msg = data?.details?.[0]?.description ?? data?.message ?? `PayPal ${method} ${url.pathname} failed (${res.status})`;
    throw new PayPalError(msg, res.status, data, debugId);
  }
  return { data: data as T, status: res.status, debugId };
}
