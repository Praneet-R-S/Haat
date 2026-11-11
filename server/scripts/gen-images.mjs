// Generates the sample catalogue photography with Gemini image models.
// Usage: node scripts/gen-images.mjs [onlyName]
import { GoogleGenAI } from '@google/genai';
import { writeFileSync, existsSync } from 'node:fs';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const STYLE = `Photographic, shot on a full-frame camera with a 50mm lens, natural window daylight, soft shadows, true-to-life colour, fine fabric and clay texture visible, editorial product photography for an independent craft shop. No text, no logos, no watermark, no people's faces.`;
const SHOTS = {
  'chanderi-stole': `An ivory Chanderi silk-cotton handloom stole with small gold zari buttis, loosely folded on a pale lime-washed wall shelf, sheer weave catching the light. ${STYLE}`,
  'chanderi-runner': `A handwoven Chanderi table runner in muted rose with a thin gold zari border, laid across a weathered teak table with a brass tumbler beside it. ${STYLE}`,
  'bagru-dupatta': `An indigo dabu hand-block-printed cotton dupatta from Bagru, Rajasthan, with white mud-resist floral motifs, draped over a wooden charpai frame in a courtyard, morning light. ${STYLE}`,
  'bagru-cushions': `A pair of hand block printed cotton cushion covers in madder red and black syahi-begar motifs from Bagru, on a jute daybed. ${STYLE}`,
  'bagru-throw': `A lightweight hand-block-printed cotton quilt (razai) in indigo and ochre, folded in thirds at the foot of a simple wooden bed, white walls. ${STYLE}`,
  'terracotta-horse': `A hand-modelled Tamil terracotta horse figurine about 30 cm tall, painted in traditional red, white and black, standing on a stone ledge, warm earth tones. ${STYLE}`,
  'terracotta-planter': `A hand-thrown unglazed terracotta planter with a carved leaf band, holding a small fern, on a red oxide floor. ${STYLE}`,
  'studio-raw-photo': `A slightly imperfect smartphone photo taken by a weaver at home: a sky-blue Chanderi handloom dupatta with silver zari stripes spread on a woven charpai, a corner of a steel trunk visible, uneven afternoon light from a doorway. Realistic phone camera look, not staged. No people, no text.`,
  'loom-hands': `Close-up of hands working threads on a wooden pit loom in Chanderi, gold zari threads and ivory cotton warp, shallow depth of field, warm low light. Hands only, no face. ${STYLE}`,
};
const only = process.argv[2];
const models = ['gemini-3.1-flash-image', 'gemini-3-pro-image', 'gemini-2.5-flash-image'];
for (const [name, prompt] of Object.entries(SHOTS)) {
  if (only && name !== only) continue;
  const out = `seed/images/${name}.png`;
  if (existsSync(out) && !only) { console.log('skip', name); continue; }
  let done = false;
  for (const model of models) {
    try {
      const r = await ai.models.generateContent({ model, contents: prompt, config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: name === 'loom-hands' ? '16:9' : '4:5' } } });
      const part = r.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      if (!part) throw new Error('no image part');
      writeFileSync(out, Buffer.from(part.inlineData.data, 'base64'));
      console.log('ok', name, model); done = true; break;
    } catch (e) { console.log('fail', name, model, String(e.message).slice(0, 120)); }
  }
  if (!done) console.log('GAVE UP', name);
}
