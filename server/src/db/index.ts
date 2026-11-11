// SQLite via Node's built-in node:sqlite. JSON columns are stored as TEXT and
// parsed by the row mappers below so the rest of the code works with plain objects.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export const DATA_DIR = resolve(process.env.DATA_DIR || resolve(import.meta.dirname, '../../../data'));
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(resolve(DATA_DIR, 'uploads'), { recursive: true });

const file = resolve(DATA_DIR, 'haat.db');
mkdirSync(dirname(file), { recursive: true });
export const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS sellers (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  business TEXT NOT NULL,
  craft TEXT NOT NULL,
  place TEXT NOT NULL,
  state TEXT NOT NULL,
  language TEXT NOT NULL,
  language_name TEXT NOT NULL,
  bio TEXT NOT NULL,
  portrait TEXT,
  gstin TEXT,
  iec TEXT,
  lut_arn TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS makers (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  share_pct REAL NOT NULL,
  paypal_email TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  status TEXT NOT NULL DEFAULT 'draft',
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL,
  story TEXT NOT NULL,
  category TEXT NOT NULL,
  materials TEXT NOT NULL DEFAULT '[]',
  dimensions TEXT,
  weight_g INTEGER NOT NULL DEFAULT 400,
  care TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  hs_code TEXT,
  hs_reason TEXT,
  cost_inr REAL NOT NULL,
  price_usd REAL NOT NULL,
  pricing TEXT NOT NULL DEFAULT '{}',
  images TEXT NOT NULL DEFAULT '[]',
  stock INTEGER NOT NULL DEFAULT 5,
  source_language TEXT,
  source_transcript TEXT,
  paypal_product_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  number TEXT UNIQUE NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  amount_usd REAL NOT NULL,
  shipping_usd REAL NOT NULL DEFAULT 0,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  paypal_order_id TEXT,
  capture_id TEXT,
  buyer_name TEXT,
  buyer_email TEXT,
  ship_to TEXT,
  agent_note TEXT,
  export_doc TEXT,
  tracking TEXT,
  payout TEXT,
  created_at TEXT NOT NULL,
  paid_at TEXT
);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  paypal_invoice_id TEXT,
  number TEXT,
  buyer_email TEXT NOT NULL,
  buyer_name TEXT,
  amount_usd REAL NOT NULL,
  status TEXT NOT NULL,
  items TEXT NOT NULL DEFAULT '[]',
  link TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  seller_id TEXT,
  history TEXT NOT NULL DEFAULT '[]',
  messages TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  seller_id TEXT,
  order_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`);

// Additive migrations for databases created by earlier builds.
if (!(db.prepare('PRAGMA table_info(makers)').all() as any[]).some((c) => c.name === 'upi_id')) {
  db.exec("ALTER TABLE makers ADD COLUMN upi_id TEXT NOT NULL DEFAULT ''");
}
if (!(db.prepare('PRAGMA table_info(orders)').all() as any[]).some((c) => c.name === 'settlement')) {
  db.exec('ALTER TABLE orders ADD COLUMN settlement TEXT');
}

export const now = () => new Date().toISOString();
export const uid = () => randomUUID();

const J = (s: unknown, fallback: any) => {
  if (typeof s !== 'string' || !s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};

// ------------------------------------------------------------------ types

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
  portrait: string | null;
  gstin: string | null;
  iec: string | null;
  lut_arn: string | null;
  created_at: string;
}

export interface Maker {
  id: string;
  seller_id: string;
  name: string;
  role: string;
  share_pct: number;
  paypal_email: string;
  /** Sample UPI ID (not a real account) for the UPI split. */
  upi_id: string;
}

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
  status: 'created' | 'paid' | 'fulfilled' | 'disputed' | 'refunded' | 'failed';
  paypal_order_id: string | null;
  capture_id: string | null;
  buyer_name: string | null;
  buyer_email: string | null;
  ship_to: any;
  agent_note: string | null;
  export_doc: any;
  tracking: any;
  payout: any;
  /** What PayPal actually settled on capture: gross, paypal_fee, net (USD strings) and seller protection. */
  settlement: any;
  created_at: string;
  paid_at: string | null;
}

export interface Invoice {
  id: string;
  seller_id: string;
  paypal_invoice_id: string | null;
  number: string | null;
  buyer_email: string;
  buyer_name: string | null;
  amount_usd: number;
  status: string;
  items: any[];
  link: string | null;
  created_at: string;
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

const mapProduct = (r: any): Product => ({
  ...r,
  materials: J(r.materials, []),
  tags: J(r.tags, []),
  pricing: J(r.pricing, {}),
  images: J(r.images, []),
});
const mapOrder = (r: any): Order => ({
  ...r,
  ship_to: J(r.ship_to, null),
  export_doc: J(r.export_doc, null),
  tracking: J(r.tracking, null),
  payout: J(r.payout, null),
  settlement: J(r.settlement, null),
});
const mapInvoice = (r: any): Invoice => ({ ...r, items: J(r.items, []) });
const mapActivity = (r: any): Activity => ({ ...r, detail: J(r.detail, {}) });

// ------------------------------------------------------------------ sellers

export const sellers = {
  all: (): Seller[] => db.prepare('SELECT * FROM sellers ORDER BY created_at').all() as any,
  get: (id: string): Seller | undefined => db.prepare('SELECT * FROM sellers WHERE id = ? OR slug = ?').get(id, id) as any,
  insert(s: Omit<Seller, 'created_at'>) {
    db.prepare(
      `INSERT INTO sellers (id, slug, name, business, craft, place, state, language, language_name, bio, portrait, gstin, iec, lut_arn, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(s.id, s.slug, s.name, s.business, s.craft, s.place, s.state, s.language, s.language_name, s.bio, s.portrait, s.gstin, s.iec, s.lut_arn, now());
  },
};

export const makers = {
  forSeller: (sellerId: string): Maker[] => db.prepare('SELECT * FROM makers WHERE seller_id = ? ORDER BY share_pct DESC').all(sellerId) as any,
  insert(m: Maker) {
    db.prepare('INSERT INTO makers (id, seller_id, name, role, share_pct, paypal_email, upi_id) VALUES (?,?,?,?,?,?,?)').run(
      m.id, m.seller_id, m.name, m.role, m.share_pct, m.paypal_email, m.upi_id,
    );
  },
};

// ------------------------------------------------------------------ products

export const products = {
  all: (opts: { status?: string; sellerId?: string } = {}): Product[] => {
    const where: string[] = [];
    const args: any[] = [];
    if (opts.status) (where.push('status = ?'), args.push(opts.status));
    if (opts.sellerId) (where.push('seller_id = ?'), args.push(opts.sellerId));
    const sql = `SELECT * FROM products ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`;
    return (db.prepare(sql).all(...args) as any[]).map(mapProduct);
  },
  get: (id: string): Product | undefined => {
    const r = db.prepare('SELECT * FROM products WHERE id = ? OR slug = ?').get(id, id);
    return r ? mapProduct(r) : undefined;
  },
  insert(p: Omit<Product, 'created_at'> & { created_at?: string }) {
    db.prepare(
      `INSERT INTO products (id, slug, seller_id, status, title, subtitle, story, category, materials, dimensions, weight_g, care, tags,
        hs_code, hs_reason, cost_inr, price_usd, pricing, images, stock, source_language, source_transcript, paypal_product_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      p.id, p.slug, p.seller_id, p.status, p.title, p.subtitle, p.story, p.category, JSON.stringify(p.materials), p.dimensions,
      p.weight_g, p.care, JSON.stringify(p.tags), p.hs_code, p.hs_reason, p.cost_inr, p.price_usd, JSON.stringify(p.pricing),
      JSON.stringify(p.images), p.stock, p.source_language, p.source_transcript, p.paypal_product_id, p.created_at ?? now(),
    );
  },
  update(id: string, patch: Partial<Product>) {
    const cols = Object.keys(patch).filter((k) => k !== 'id');
    if (!cols.length) return;
    const jsonCols = new Set(['materials', 'tags', 'pricing', 'images']);
    const sql = `UPDATE products SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`;
    db.prepare(sql).run(...cols.map((c) => (jsonCols.has(c) ? JSON.stringify((patch as any)[c]) : (patch as any)[c])), id);
  },
  search(q: string, maxUsd?: number): Product[] {
    const terms = q.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
    const live = products.all({ status: 'live' }).filter((p) => (maxUsd ? p.price_usd <= maxUsd : true));
    if (!terms.length) return live;
    // Title and tags count more than the story, so "indigo block print" finds the indigo piece first.
    const scored = live.map((p) => {
      const title = p.title.toLowerCase();
      const sub = p.subtitle.toLowerCase();
      const tags = [p.category, ...p.materials, ...p.tags].join(' ').toLowerCase();
      const story = p.story.toLowerCase();
      const score = terms.reduce((s, t) => s + (title.includes(t) ? 3 : 0) + (sub.includes(t) ? 1 : 0) + (tags.includes(t) ? 2 : 0) + (story.includes(t) ? 1 : 0), 0);
      return { p, score };
    });
    const hits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).map((s) => s.p);
    return hits.length ? hits : live;
  },
};

// ------------------------------------------------------------------ orders

export const orders = {
  all: (opts: { sellerId?: string } = {}): Order[] => {
    const rows = opts.sellerId
      ? db.prepare('SELECT * FROM orders WHERE seller_id = ? ORDER BY created_at DESC').all(opts.sellerId)
      : db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
    return (rows as any[]).map(mapOrder);
  },
  get: (id: string): Order | undefined => {
    const r = db.prepare('SELECT * FROM orders WHERE id = ? OR number = ? OR paypal_order_id = ?').get(id, id, id);
    return r ? mapOrder(r) : undefined;
  },
  byCapture: (captureId: string): Order | undefined => {
    const r = db.prepare('SELECT * FROM orders WHERE capture_id = ?').get(captureId);
    return r ? mapOrder(r) : undefined;
  },
  insert(o: Pick<Order, 'id' | 'number' | 'product_id' | 'seller_id' | 'quantity' | 'amount_usd' | 'shipping_usd' | 'channel' | 'status'> & Partial<Order>) {
    db.prepare(
      `INSERT INTO orders (id, number, product_id, seller_id, quantity, amount_usd, shipping_usd, channel, status, paypal_order_id, agent_note, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(o.id, o.number, o.product_id, o.seller_id, o.quantity, o.amount_usd, o.shipping_usd, o.channel, o.status, o.paypal_order_id ?? null, o.agent_note ?? null, now());
  },
  update(id: string, patch: Partial<Order>) {
    const cols = Object.keys(patch).filter((k) => k !== 'id');
    if (!cols.length) return;
    const jsonCols = new Set(['ship_to', 'export_doc', 'tracking', 'payout', 'settlement']);
    db.prepare(`UPDATE orders SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(
      ...cols.map((c) => (jsonCols.has(c) ? JSON.stringify((patch as any)[c]) : (patch as any)[c])),
      id,
    );
  },
  nextNumber(): string {
    const r = db.prepare('SELECT COUNT(*) AS c FROM orders').get() as any;
    return `HT-${String(1041 + Number(r.c)).padStart(5, '0')}`;
  },
};

// ------------------------------------------------------------------ invoices

export const invoices = {
  all: (sellerId?: string): Invoice[] =>
    ((sellerId
      ? db.prepare('SELECT * FROM invoices WHERE seller_id = ? ORDER BY created_at DESC').all(sellerId)
      : db.prepare('SELECT * FROM invoices ORDER BY created_at DESC').all()) as any[]).map(mapInvoice),
  insert(i: Omit<Invoice, 'created_at'>) {
    db.prepare(
      `INSERT INTO invoices (id, seller_id, paypal_invoice_id, number, buyer_email, buyer_name, amount_usd, status, items, link, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(i.id, i.seller_id, i.paypal_invoice_id, i.number, i.buyer_email, i.buyer_name, i.amount_usd, i.status, JSON.stringify(i.items), i.link, now());
  },
  update(id: string, patch: Partial<Invoice>) {
    const cols = Object.keys(patch).filter((k) => k !== 'id');
    if (!cols.length) return;
    db.prepare(`UPDATE invoices SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ? OR paypal_invoice_id = ?`).run(
      ...cols.map((c) => (c === 'items' ? JSON.stringify((patch as any)[c]) : (patch as any)[c])),
      id,
      id,
    );
  },
};

// ------------------------------------------------------------------ threads

export const threads = {
  get: (id: string) => {
    const r: any = db.prepare('SELECT * FROM threads WHERE id = ?').get(id);
    return r ? { ...r, history: J(r.history, []), messages: J(r.messages, []) } : undefined;
  },
  upsert(id: string, kind: string, sellerId: string | null, history: unknown[], messages: unknown[]) {
    db.prepare(
      `INSERT INTO threads (id, kind, seller_id, history, messages, created_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET history = excluded.history, messages = excluded.messages`,
    ).run(id, kind, sellerId, JSON.stringify(history), JSON.stringify(messages), now());
  },
};

// ------------------------------------------------------------------ activity

export const activity = {
  add(a: Omit<Activity, 'id' | 'at'>): Activity {
    const row: Activity = { id: uid(), at: now(), ...a };
    db.prepare('INSERT INTO activity (id, at, seller_id, order_id, kind, title, detail) VALUES (?,?,?,?,?,?,?)').run(
      row.id, row.at, row.seller_id, row.order_id, row.kind, row.title, JSON.stringify(row.detail ?? {}),
    );
    return row;
  },
  recent(opts: { sellerId?: string; orderId?: string; limit?: number } = {}): Activity[] {
    const where: string[] = [];
    const args: any[] = [];
    if (opts.sellerId) (where.push('seller_id = ?'), args.push(opts.sellerId));
    if (opts.orderId) (where.push('order_id = ?'), args.push(opts.orderId));
    const sql = `SELECT * FROM activity ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY at DESC LIMIT ?`;
    return (db.prepare(sql).all(...args, opts.limit ?? 60) as any[]).map(mapActivity);
  },
};

export const kv = {
  get: (k: string): string | undefined => (db.prepare('SELECT v FROM kv WHERE k = ?').get(k) as any)?.v,
  set: (k: string, v: string) => db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v),
};

/** Wipe demo data (orders, drafts, threads, activity) and let the seed run again. */
export function wipeDemo() {
  db.exec(`DELETE FROM activity; DELETE FROM threads; DELETE FROM invoices; DELETE FROM orders; DELETE FROM products; DELETE FROM makers; DELETE FROM sellers; DELETE FROM kv WHERE k = 'catalog_synced';`);
}
