// Haat as an MCP server: any MCP-capable AI shopping agent (Claude, ChatGPT, Cursor,
// custom agents) can discover Indian makers' pieces and start a PayPal checkout that
// the human approves. Stateless Streamable HTTP at POST /mcp.

import type { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { buyerTools } from '../agents/buyer.ts';
import { bus } from '../events/bus.ts';

function build() {
  const server = new McpServer({ name: 'haat', version: '1.0.0' });
  const tools = buyerTools({ budgetUsd: 500, shipCountry: 'buyer country' }, 'mcp');
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

  const run = async (name: string, args: any) => {
    bus.emitEvent('mcp.call', { tool: name, args });
    try {
      const out = await byName[name].execute(args, { actor: 'mcp-agent', state: {} });
      return { content: [{ type: 'text' as const, text: JSON.stringify(out, null, 2) }] };
    } catch (err: any) {
      return { isError: true, content: [{ type: 'text' as const, text: err.message }] };
    }
  };

  server.registerTool(
    'search_catalog',
    {
      title: 'Search handmade pieces from Indian makers',
      description: byName.search_catalog.description,
      inputSchema: { query: z.string(), max_price_usd: z.number().optional() },
    },
    (a) => run('search_catalog', a),
  );
  server.registerTool(
    'product_details',
    { title: 'Product details', description: byName.product_details.description, inputSchema: { product_id: z.string() } },
    (a) => run('product_details', a),
  );
  server.registerTool(
    'request_checkout',
    {
      title: 'Start a PayPal checkout (human approves)',
      description: `${byName.request_checkout.description} Show the returned approve_url to the human; payment completes only after they approve in PayPal.`,
      inputSchema: { product_id: z.string(), quantity: z.number().int().optional(), reason: z.string() },
    },
    (a) => run('request_checkout', a),
  );
  server.registerTool(
    'order_status',
    { title: 'Order status', description: byName.order_status.description, inputSchema: { order_number: z.string() } },
    (a) => run('order_status', a),
  );
  return server;
}

export async function handleMcp(req: Request, res: Response) {
  const server = build();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
