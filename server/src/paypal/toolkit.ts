// Adapter: PayPal's official Agent Toolkit (@paypal/agent-toolkit, AI SDK flavour)
// exposed as Gemini function declarations. The toolkit owns the PayPal calls; we
// add ledger entries so its traffic shows up next to our direct REST calls.

import { randomUUID } from 'node:crypto';
import { PayPalAgentToolkit } from '@paypal/agent-toolkit/ai-sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { bus } from '../events/bus.ts';
import { paypalConfigured, paypalEnv } from './client.ts';
import type { AgentTool } from '../ai/gemini.ts';

let kit: PayPalAgentToolkit | null = null;
let cache: Record<string, any> | null = null;

function toolkit(): Record<string, any> {
  if (!paypalConfigured()) throw new Error('PayPal sandbox credentials are missing');
  if (!cache) {
    kit = new PayPalAgentToolkit({
      clientId: process.env.PAYPAL_CLIENT_ID!,
      clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
      configuration: {
        actions: {
          invoices: { create: true, list: true, get: true, send: true, sendReminder: true, cancel: true, generateQRC: true },
          orders: { get: true },
          shipment: { create: true, get: true },
          disputes: { list: true, get: true },
          transactions: { list: true },
          insights: { get: true },
          products: { list: true },
        },
        context: { sandbox: paypalEnv() === 'sandbox' },
      },
    });
    cache = kit.getTools() as Record<string, any>;
  }
  return cache;
}

/** Strip JSON-schema keywords Gemini's function-declaration parser dislikes. */
function clean(schema: any): any {
  if (Array.isArray(schema)) return schema.map(clean);
  if (!schema || typeof schema !== 'object') return schema;
  const out: any = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === '$schema' || k === 'definitions' || k === '$ref' || k === 'default') continue;
    out[k] = clean(v);
  }
  return out;
}

/** Call a toolkit tool directly (used by our own composite tools). */
export async function callToolkit(name: string, args: any, actor: string, label?: string): Promise<any> {
  const tool = toolkit()[name];
  if (!tool) throw new Error(`PayPal Agent Toolkit has no tool "${name}" enabled`);
  const started = Date.now();
  let ok = true;
  let result: any;
  try {
    result = await tool.execute(args, { toolCallId: randomUUID(), messages: [] });
    if (typeof result === 'string') {
      try {
        result = JSON.parse(result);
      } catch {
        /* keep string */
      }
    }
    if (result && typeof result === 'object' && (result.ok === false || 'error' in result || result.name === 'INVALID_REQUEST')) ok = false;
    return result;
  } catch (err: any) {
    ok = false;
    result = { error: err?.message ?? String(err) };
    throw err;
  } finally {
    bus.ledger({
      id: randomUUID(),
      at: new Date().toISOString(),
      method: 'TOOL',
      path: `agent-toolkit/${name}`,
      status: ok ? 200 : 400,
      ms: Date.now() - started,
      ok,
      label: label ?? `Agent Toolkit · ${name}`,
      actor,
      summary: ok ? undefined : JSON.stringify(result).slice(0, 200),
    });
  }
}

/** Expose selected toolkit tools to a Gemini agent. */
export function toolkitTools(names: string[], actor: string): AgentTool[] {
  if (!paypalConfigured()) return [];
  const all = toolkit();
  return names
    .filter((n) => all[n])
    .map((n) => {
      const t = all[n];
      const params = clean(zodToJsonSchema(t.parameters, { target: 'openApi3', $refStrategy: 'none' }));
      return {
        name: n,
        description: String(t.description ?? n).slice(0, 1000),
        parameters: params.type ? params : { type: 'object', properties: {} },
        source: 'PayPal Agent Toolkit',
        execute: (args: any) => callToolkit(n, args, actor),
      } satisfies AgentTool;
    });
}

export function toolkitToolNames(): string[] {
  return paypalConfigured() ? Object.keys(toolkit()) : [];
}
