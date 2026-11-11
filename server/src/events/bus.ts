// In-process event bus. Everything the UI needs to show "live" flows through here:
// PayPal API calls (ledger), agent steps (thinking, tool calls, results), and domain
// events (order paid, invoice sent, payout released). Server-Sent Events fan it out.

import { EventEmitter } from 'node:events';
import type { Response } from 'express';

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
  /** e.g. ledger, agent.step, order.paid, listing.created */
  type: string;
  at: string;
  /** Optional channel so a client can filter (a seller id, a session id, an order id). */
  channel?: string;
  data: unknown;
}

const RING_MAX = 400;

class Bus extends EventEmitter {
  private ring: AppEvent[] = [];
  private clients = new Set<{ res: Response; channels: Set<string> | null }>();

  emitEvent(type: string, data: unknown, channel?: string) {
    const evt: AppEvent = { type, at: new Date().toISOString(), channel, data };
    this.ring.push(evt);
    if (this.ring.length > RING_MAX) this.ring.splice(0, this.ring.length - RING_MAX);
    this.emit('event', evt);
    const payload = `event: ${type}\ndata: ${JSON.stringify(evt)}\n\n`;
    for (const c of this.clients) {
      if (!c.channels || !evt.channel || c.channels.has(evt.channel)) {
        c.res.write(payload);
      }
    }
  }

  ledger(entry: LedgerEntry) {
    this.emitEvent('ledger', entry);
  }

  recent(filter?: (e: AppEvent) => boolean) {
    return filter ? this.ring.filter(filter) : [...this.ring];
  }

  /** Attach an SSE client. `channels` null = everything. Replays recent events first. */
  attach(res: Response, channels: string[] | null, replay = true) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const client = { res, channels: channels ? new Set(channels) : null };
    if (replay) {
      for (const evt of this.ring) {
        if (!client.channels || !evt.channel || client.channels.has(evt.channel)) {
          res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`);
        }
      }
    }
    this.clients.add(client);
    const ping = setInterval(() => res.write(`: ping\n\n`), 20_000);
    res.on('close', () => {
      clearInterval(ping);
      this.clients.delete(client);
    });
  }
}

export const bus = new Bus();
bus.setMaxListeners(100);
