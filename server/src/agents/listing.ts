// Listing agent: photo(s) + a voice note (any Indian language) -> a global listing,
// an HS code with reasoning, and export pricing that protects the maker's rupees.

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateJSON, inlinePart } from '../ai/gemini.ts';
import { DATA_DIR, products, sellers, uid, activity, type Product } from '../db/index.ts';
import { priceForExport } from '../domain/pricing.ts';
import { bus } from '../events/bus.ts';
import type { Part } from '@google/genai';

export interface MediaIn {
  data: string; // base64, no data: prefix
  mime: string;
}

const SCHEMA = {
  type: 'object',
  properties: {
    heard_language: { type: 'string', description: 'Language the maker spoke or wrote in, e.g. Hindi' },
    transcript_original: { type: 'string', description: 'Verbatim transcript in the original script (empty if no audio)' },
    transcript_english: { type: 'string', description: 'Faithful English translation of what the maker said' },
    title: { type: 'string', description: 'Product title for international buyers, max 70 chars, specific, no hype words' },
    subtitle: { type: 'string', description: 'One line: technique + place, e.g. "Handwoven silk-cotton, Chanderi, Madhya Pradesh"' },
    story: {
      type: 'string',
      description: '70-110 words. Plain, warm English. What it is, how it is made, who made it and where. Only facts the maker said or that are clearly visible. Do not claim natural dyes, organic, pure, antique, awards or certifications unless the maker said so. No honorifics or rank (never "master", "renowned", "expert"). No superlatives.',
    },
    category: { type: 'string', enum: ['Textiles', 'Home', 'Pottery', 'Jewellery', 'Art', 'Other'] },
    materials: { type: 'array', items: { type: 'string' } },
    dimensions: { type: 'string', description: 'e.g. "200 x 70 cm". Use what the maker said; otherwise estimate and add "(approx.)"' },
    weight_g: { type: 'integer', description: 'Shipping weight estimate in grams including packaging' },
    care: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' }, description: '4-7 lowercase search tags buyers abroad would use' },
    hs_code: { type: 'string', description: 'Most likely 6-digit Harmonized System code, e.g. 6214.90' },
    hs_reason: { type: 'string', description: 'One sentence on why this HS heading applies' },
    cost_inr: { type: 'number', description: 'The rupee amount the maker said they want per piece. If not stated, a fair estimate for the craft.' },
    cost_was_stated: { type: 'boolean' },
    stock: { type: 'integer', description: 'Pieces available; default 3 if not said' },
    missing: { type: 'array', items: { type: 'string' }, description: 'Short list of things worth asking the maker (max 3)' },
    reply_to_maker: {
      type: 'string',
      description: 'A short, respectful reply TO THE MAKER in the language they used (native script). Confirm the listing is ready and say they will receive about {TAKE_HOME} per piece after PayPal fees and conversion (write the literal token {TAKE_HOME}, it is filled in later; do not write any other rupee amount). Ask at most one question. 2-3 sentences.',
    },
    reply_to_maker_english: { type: 'string', description: 'English version of the reply, also using the literal token {TAKE_HOME}' },
  },
  required: [
    'heard_language', 'transcript_original', 'transcript_english', 'title', 'subtitle', 'story', 'category', 'materials', 'dimensions',
    'weight_g', 'care', 'tags', 'hs_code', 'hs_reason', 'cost_inr', 'cost_was_stated', 'stock', 'missing', 'reply_to_maker', 'reply_to_maker_english',
  ],
};

type Draft = {
  heard_language: string;
  transcript_original: string;
  transcript_english: string;
  title: string;
  subtitle: string;
  story: string;
  category: string;
  materials: string[];
  dimensions: string;
  weight_g: number;
  care: string;
  tags: string[];
  hs_code: string;
  hs_reason: string;
  cost_inr: number;
  cost_was_stated: boolean;
  stock: number;
  missing: string[];
  reply_to_maker: string;
  reply_to_maker_english: string;
};

const extFor = (mime: string) => (mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg');

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) + '-' + Math.random().toString(36).slice(2, 6);

export type DraftEvent =
  | { kind: 'stage'; stage: 'listening' | 'looking' | 'writing' | 'pricing' | 'saving'; label: string }
  | { kind: 'heard'; language: string; original: string; english: string };

export async function draftListing(input: { sellerId: string; images: MediaIn[]; audio?: MediaIn | null; text?: string; channel?: string; onEvent?: (e: DraftEvent) => void }) {
  const seller = sellers.get(input.sellerId);
  if (!seller) throw new Error('Unknown seller');
  if (!input.images.length) throw new Error('Send at least one photo');
  const channel = input.channel ?? `seller:${seller.id}`;
  const step = (title: string, detail?: unknown) => bus.emitEvent('studio.step', { title, detail }, channel);

  step('Reading the photo and listening to the voice note');
  const emit = input.onEvent ?? (() => {});
  emit({ kind: 'stage', stage: input.audio ? 'listening' : 'looking', label: input.audio ? 'Listening to the voice note' : 'Looking at the photo' });
  // A quick transcription runs alongside the full listing call, so the maker sees their own
  // words come back within seconds instead of waiting for the whole listing.
  if (input.audio) {
    generateJSON<{ language: string; original: string; english: string }>({
      system: 'Transcribe this voice note exactly, in its original language and script, then translate it into plain English.',
      parts: [inlinePart(input.audio.data, input.audio.mime)],
      schema: { type: 'object', properties: { language: { type: 'string' }, original: { type: 'string' }, english: { type: 'string' } }, required: ['language', 'original', 'english'] },
      thinking: 'MINIMAL',
    })
      .then(({ data }) => {
        emit({ kind: 'heard', ...data });
        emit({ kind: 'stage', stage: 'writing', label: 'Writing the listing in English' });
      })
      .catch(() => {});
  } else {
    emit({ kind: 'stage', stage: 'writing', label: 'Writing the listing in English' });
  }
  const parts: Part[] = [
    {
      text: `Maker: ${seller.name}, ${seller.business}, ${seller.place}, ${seller.state}, India. Craft: ${seller.craft}. Usual language: ${seller.language_name}.
They are listing a new piece for buyers in the US, UK and EU. Their message follows (voice note and/or text). Photos of the piece are attached.
${input.text ? `Typed message: """${input.text}"""` : ''}`,
    },
    ...input.images.slice(0, 4).map((im) => inlinePart(im.data, im.mime)),
  ];
  if (input.audio) parts.push(inlinePart(input.audio.data, input.audio.mime));

  const { data: d, model } = await generateJSON<Draft>({
    system:
      'You are the listing desk of Haat, an export service for Indian craftspeople. You turn a maker\'s own words and photos into an honest listing for international buyers. Never invent facts about provenance, awards, certifications or materials you cannot see or were not told. Write like a good independent shop, not like an ad.',
    parts,
    schema: SCHEMA,
    thinking: 'LOW',
  });
  step('Listing written', { model, language: d.heard_language });

  step('Working out an export price that protects the maker\'s rupees');
  emit({ kind: 'stage', stage: 'pricing', label: 'Pricing it so the rupees survive the trip' });
  const pricing = await priceForExport(d.cost_inr, d.weight_g);

  const images = input.images.slice(0, 4).map((im) => {
    const name = `${uid()}.${extFor(im.mime)}`;
    writeFileSync(resolve(DATA_DIR, 'uploads', name), Buffer.from(im.data, 'base64'));
    return `/uploads/${name}`;
  });

  const product: Omit<Product, 'created_at'> = {
    id: uid(),
    slug: slugify(d.title),
    seller_id: seller.id,
    status: 'draft',
    title: d.title,
    subtitle: d.subtitle,
    story: d.story,
    category: d.category,
    materials: d.materials,
    dimensions: d.dimensions,
    weight_g: d.weight_g,
    care: d.care,
    tags: d.tags,
    hs_code: d.hs_code,
    hs_reason: d.hs_reason,
    cost_inr: d.cost_inr,
    price_usd: pricing.price_usd,
    pricing,
    images,
    stock: Math.max(1, d.stock || 3),
    source_language: d.heard_language,
    source_transcript: d.transcript_original || input.text || null,
    paypal_product_id: null,
  };
  products.insert(product);
  activity.add({
    seller_id: seller.id,
    order_id: null,
    kind: 'listing.drafted',
    title: `Drafted "${d.title}" from a ${d.heard_language} ${input.audio ? 'voice note' : 'message'}`,
    detail: { productId: product.id, model, price_usd: pricing.price_usd, take_home_inr: pricing.seller_take_home_inr },
  });

  return {
    product: products.get(product.id)!,
    transcript: { language: d.heard_language, original: d.transcript_original, english: d.transcript_english },
    costWasStated: d.cost_was_stated,
    missing: d.missing,
    reply: {
      native: d.reply_to_maker.split('{TAKE_HOME}').join(`₹${pricing.seller_take_home_inr.toLocaleString('en-IN')}`),
      english: d.reply_to_maker_english.split('{TAKE_HOME}').join(`₹${pricing.seller_take_home_inr.toLocaleString('en-IN')}`),
    },
    model,
  };
}
