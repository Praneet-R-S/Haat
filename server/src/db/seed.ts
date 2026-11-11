// Sample makers and catalogue for the sandbox demo. These are illustrative profiles,
// not real businesses; GSTIN/IEC/LUT values are format-valid placeholders.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { makers, products, sellers, uid, activity, kv } from './index.ts';
import { priceForExport } from '../domain/pricing.ts';
import { paypalConfigured } from '../paypal/client.ts';
import { createCatalogProduct } from '../paypal/api.ts';
import { publicUrl } from '../domain/commerce.ts';

const IMG_DIR = resolve(import.meta.dirname, '../../seed/images');
const img = (slot: string) => {
  for (const ext of ['jpg', 'png', 'webp']) if (existsSync(resolve(IMG_DIR, `${slot}.${ext}`))) return `/seed/${slot}.${ext}`;
  return `/seed/${slot}.jpg`;
};

const SELLERS = [
  {
    slug: 'chanderi-bunkar-sangh',
    name: 'Meera Devi',
    business: 'Chanderi Bunkar Sangh',
    craft: 'Handloom weaving in silk-cotton with zari, on pit looms',
    place: 'Chanderi',
    state: 'Madhya Pradesh',
    language: 'hi',
    language_name: 'Hindi',
    bio: 'A cooperative of weaving households in Chanderi. Meera keeps the order book; the looms are in four homes on the same lane.',
    gstin: '23AAAAC1234F1Z5',
    iec: 'AAAAC1234F',
    lut_arn: 'AD2304250012345',
    makers: [
      { name: 'Meera Devi', role: 'Weaver and coordinator', share_pct: 30, paypal_email: 'meera.chanderi@example.com' },
      { name: 'Ramkali Koli', role: 'Weaver', share_pct: 25, paypal_email: 'ramkali.chanderi@example.com' },
      { name: 'Sunita Bai', role: 'Weaver', share_pct: 25, paypal_email: 'sunita.chanderi@example.com' },
      { name: 'Asha Koli', role: 'Warping and finishing', share_pct: 20, paypal_email: 'asha.chanderi@example.com' },
    ],
    products: [
      {
        slot: 'chanderi-stole',
        title: 'Ivory handloom stole with woven gold border',
        subtitle: 'Handwoven silk-cotton, Chanderi, Madhya Pradesh',
        story:
          'Woven on a pit loom in Chanderi, where the sheer silk-cotton weave has been made for centuries. The ochre-gold border is woven in on the loom, not printed or stitched, so it ages with the cloth. Light enough to wear in summer, warm enough for an evening. Made by Ramkali Koli and finished by Asha in the cooperative\'s lane.',
        category: 'Textiles',
        materials: ['silk', 'cotton', 'zari'],
        dimensions: '200 x 70 cm',
        weight_g: 320,
        care: 'Dry clean or gentle hand wash in cold water. Dry flat in shade.',
        tags: ['handloom', 'stole', 'chanderi', 'zari', 'gift', 'scarf'],
        hs_code: '6214.90',
        hs_reason: 'Shawls, scarves and stoles of other textile materials (silk-cotton blend).',
        cost_inr: 2200,
        stock: 4,
      },
      {
        slot: 'chanderi-runner',
        title: 'Pale rose Chanderi saree with floral buttis',
        subtitle: 'Handwoven silk-cotton, Chanderi, Madhya Pradesh',
        story:
          'A six-yard saree in pale rose, woven on a pit loom with small floral buttis worked across the body. The Chanderi weave is fine and slightly translucent, light enough for summer weddings. Woven by Sunita Bai over about nine days.',
        category: 'Textiles',
        materials: ['silk', 'cotton'],
        dimensions: '5.5 m x 1.15 m, with blouse piece',
        weight_g: 650,
        care: 'Dry clean for the first wash.',
        tags: ['saree', 'sari', 'handloom', 'chanderi', 'pink', 'wedding'],
        hs_code: '5007.90',
        hs_reason: 'Woven fabrics of silk; handloom sarees are classified as woven fabric.',
        cost_inr: 6500,
        stock: 2,
      },
    ],
  },
  {
    slug: 'bagru-chhipa-prints',
    name: 'Rafiq Chhipa',
    business: 'Bagru Chhipa Prints',
    craft: 'Hand block printing with natural dyes and dabu mud-resist',
    place: 'Bagru',
    state: 'Rajasthan',
    language: 'hi',
    language_name: 'Hindi',
    bio: 'A family of chhipa block printers in Bagru. Rafiq carves some of the blocks himself; his sisters run the dabu (mud resist) and the indigo vat.',
    gstin: '08AAAAB5678K1Z2',
    iec: 'AAAAB5678K',
    lut_arn: 'AD0804250067890',
    makers: [
      { name: 'Rafiq Chhipa', role: 'Printer and block carver', share_pct: 40, paypal_email: 'rafiq.bagru@example.com' },
      { name: 'Shabana Chhipa', role: 'Dabu and indigo dyeing', share_pct: 35, paypal_email: 'shabana.bagru@example.com' },
      { name: 'Imran Chhipa', role: 'Washing and finishing', share_pct: 25, paypal_email: 'imran.bagru@example.com' },
    ],
    products: [
      {
        slot: 'bagru-dupatta',
        title: 'Indigo dabu block-printed cotton dupatta',
        subtitle: 'Hand block printed with mud resist and indigo, Bagru, Rajasthan',
        story:
          'Each flower on this dupatta is pressed by hand with a wooden block of black clay, lime and gum, the dabu resist used in Bagru. The cloth then goes into an indigo vat several times until the blue is deep, and the resist is washed out in the river-water tanks, leaving the white pattern. Small irregularities are part of the hand process.',
        category: 'Textiles',
        materials: ['cotton', 'natural indigo'],
        dimensions: '225 x 100 cm',
        weight_g: 300,
        care: 'Wash separately in cold water the first few times; natural indigo can bleed.',
        tags: ['indigo', 'block print', 'dupatta', 'scarf', 'natural dye', 'bagru'],
        hs_code: '6214.90',
        hs_reason: 'Shawls, scarves, mufflers and veils of cotton (6214.90 covers other textile materials).',
        cost_inr: 1100,
        stock: 8,
      },
      {
        slot: 'bagru-cushions',
        title: 'Block-printed floor cushion, black and rust',
        subtitle: 'Hand block printed cotton cover with filling, Bagru, Rajasthan',
        story:
          'A square floor cushion covered in cotton printed by hand in black, white and rust. Rafiq prints the outline block first and Shabana fills the colour. Filled with cotton, firm enough to sit on, with a zip so the cover can be washed.',
        category: 'Home',
        materials: ['cotton'],
        dimensions: '50 x 50 x 12 cm',
        weight_g: 1300,
        care: 'Remove the cover, cold wash inside out, dry in shade.',
        tags: ['floor cushion', 'cushion', 'block print', 'home', 'seating'],
        hs_code: '9404.90',
        hs_reason: 'Cushions, stuffed or internally fitted with any material.',
        cost_inr: 1300,
        stock: 5,
      },
      {
        slot: 'bagru-throw',
        title: 'Red paisley block-printed cotton, 2.5 m',
        subtitle: 'Hand block printed cotton fabric with indigo border, Bagru',
        story:
          'A length of cotton printed by hand with a red paisley field and an indigo border, sold uncut for dressmaking or upholstery. Each repeat is lined up by eye, so the joins show the printer\'s hand. Pre-washed once.',
        category: 'Textiles',
        materials: ['cotton', 'natural indigo'],
        dimensions: '250 x 110 cm',
        weight_g: 450,
        care: 'Cold wash, line dry in shade.',
        tags: ['fabric', 'paisley', 'block print', 'cotton', 'sewing', 'red'],
        hs_code: '5208.52',
        hs_reason: 'Woven fabrics of cotton, printed, under 200 g/m2.',
        cost_inr: 1400,
        stock: 3,
      },
    ],
  },
  {
    slug: 'kalai-terracotta',
    name: 'Kalaiselvi Murugan',
    business: 'Kalai Terracotta',
    craft: 'Hand-modelled and wheel-thrown terracotta, fired in a wood kiln',
    place: 'Villianur',
    state: 'Puducherry',
    language: 'ta',
    language_name: 'Tamil',
    bio: 'Kalaiselvi works in the potters\' street of Villianur, where terracotta horses are still made for village shrines. She sells a few pieces a month through visitors.',
    gstin: '34AAAAK9012M1Z8',
    iec: 'AAAAK9012M',
    lut_arn: 'AD3404250034567',
    makers: [],
    products: [
      {
        slot: 'terracotta-horse',
        title: 'Pair of terracotta horses, 30 cm',
        subtitle: 'Hand-modelled and wood-fired, Villianur, Puducherry',
        story:
          'A pair of small versions of the guardian horses that stand outside village shrines in Tamil Nadu. Each is modelled by hand in sections, joined, dried for two weeks, fired in a wood kiln and painted in red, white and black. Packed in rice straw and a double box for the journey.',
        category: 'Pottery',
        materials: ['terracotta', 'mineral paint'],
        dimensions: '30 x 12 x 26 cm',
        weight_g: 1600,
        care: 'Indoor piece. Dust with a dry brush.',
        tags: ['terracotta', 'horse', 'figurine', 'sculpture', 'tamil'],
        hs_code: '6913.90',
        hs_reason: 'Statuettes and other ornamental ceramic articles, not porcelain.',
        cost_inr: 2600,
        stock: 2,
      },
      {
        slot: 'terracotta-planter',
        title: 'Hand-thrown terracotta planter with leaf band',
        subtitle: 'Unglazed red clay, wheel-thrown, Villianur, Puducherry',
        story:
          'Thrown on a kick wheel and carved with a band of leaves while the clay is leather-hard. Unglazed, so the clay breathes and roots stay cool. Comes with a drainage hole and a matching saucer.',
        category: 'Pottery',
        materials: ['terracotta'],
        dimensions: '18 cm tall, 20 cm across',
        weight_g: 1500,
        care: 'Safe outdoors; bring inside before frost.',
        tags: ['planter', 'pot', 'terracotta', 'garden', 'handmade'],
        hs_code: '6912.00',
        hs_reason: 'Ceramic household articles other than porcelain.',
        cost_inr: 900,
        stock: 7,
      },
    ],
  },
];

export async function seedIfEmpty() {
  if (sellers.all().length === 0) {
    for (const s of SELLERS) {
      const sellerId = uid();
      sellers.insert({
        id: sellerId,
        slug: s.slug,
        name: s.name,
        business: s.business,
        craft: s.craft,
        place: s.place,
        state: s.state,
        language: s.language,
        language_name: s.language_name,
        bio: s.bio,
        portrait: null,
        gstin: s.gstin,
        iec: s.iec,
        lut_arn: s.lut_arn,
      });
      // Sample UPI IDs on a handle no UPI app routes to, so nobody can pay a stranger from the demo.
      for (const m of s.makers) makers.insert({ id: uid(), seller_id: sellerId, ...m, upi_id: `${m.paypal_email.split('@')[0]}@haatdemo` });
      let i = 0;
      for (const p of s.products) {
        const pricing = await priceForExport(p.cost_inr, p.weight_g);
        products.insert({
          id: uid(),
          slug: p.slot,
          seller_id: sellerId,
          status: 'live',
          title: p.title,
          subtitle: p.subtitle,
          story: p.story,
          category: p.category,
          materials: p.materials,
          dimensions: p.dimensions,
          weight_g: p.weight_g,
          care: p.care,
          tags: p.tags,
          hs_code: p.hs_code,
          hs_reason: p.hs_reason,
          cost_inr: p.cost_inr,
          price_usd: pricing.price_usd,
          pricing,
          images: [img(p.slot)],
          stock: p.stock,
          source_language: null,
          source_transcript: null,
          paypal_product_id: null,
          created_at: new Date(Date.now() - (10 - i++) * 86400_000).toISOString(),
        });
      }
    }
    activity.add({ seller_id: null, order_id: null, kind: 'seed', title: 'Sample makers and catalogue loaded', detail: {} });
  }
  // Mirror the catalogue into the PayPal Catalog once credentials exist.
  if (paypalConfigured() && !kv.get('catalog_synced')) {
    (async () => {
      for (const p of products.all({ status: 'live' })) {
        if (p.paypal_product_id) continue;
        try {
          const res = await createCatalogProduct({ id: p.id, name: p.title, description: p.subtitle, homeUrl: `${publicUrl()}/app/p/${p.slug}`, actor: 'system' });
          products.update(p.id, { paypal_product_id: res.data?.id ?? null });
        } catch (e: any) {
          console.warn('catalog sync failed for', p.slug, e.message);
          return;
        }
      }
      kv.set('catalog_synced', '1');
    })();
  }
}
