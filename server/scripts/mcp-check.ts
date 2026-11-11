// Connects to Haat's MCP endpoint the way an outside agent would (official MCP client over
// Streamable HTTP), lists the tools and calls them. With CHECKOUT=1 it also creates a real
// PayPal sandbox order through request_checkout and prints the approval link.
// Run: npx tsx scripts/mcp-check.ts [http://localhost:8787/mcp]
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = new URL(process.argv[2] ?? 'http://localhost:8787/mcp');
const client = new Client({ name: 'haat-mcp-check', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(url));

const { tools } = await client.listTools();
console.log('tools:', tools.map((t) => t.name).join(', '));

const text = (r: any) => (r.content?.[0]?.type === 'text' ? r.content[0].text : JSON.stringify(r));
const found = JSON.parse(text(await client.callTool({ name: 'search_catalog', arguments: { query: 'indigo block print', max_price_usd: 60 } })));
console.log(`search_catalog: ${found.length} results, first: ${found[0]?.title} ($${found[0]?.landed_usd} landed)`);

const details = JSON.parse(text(await client.callTool({ name: 'product_details', arguments: { product_id: found[0].product_id } })));
console.log(`product_details: ${details.title}, HS ${details.hs_code}, maker ${details.maker}`);

if (process.env.CHECKOUT === '1') {
  const r = await client.callTool({ name: 'request_checkout', arguments: { product_id: found[0].product_id, reason: 'MCP check from an outside agent' } });
  const co = JSON.parse(text(r));
  console.log(`request_checkout: order ${co.order_number}, PayPal ${co.paypal_order_id}, $${co.total_usd}`);
  console.log(`approve_url: ${co.approve_url ? 'present (sandbox PayPal link)' : 'MISSING'}`);
  const st = JSON.parse(text(await client.callTool({ name: 'order_status', arguments: { order_number: co.order_number } })));
  console.log(`order_status: ${st.status}`);
}
await client.close();
