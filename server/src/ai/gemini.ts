// Gemini wrapper: structured generation (multimodal) and a tool-calling agent loop.
// Model fallback handles 429/503 spikes so a live demo does not die on one busy model.

import { GoogleGenAI, type Content, type Part, type FunctionDeclaration } from '@google/genai';

let client: GoogleGenAI | null = null;
function ai(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

export function aiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function models(): string[] {
  const primary = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  const fallbacks = (process.env.GEMINI_FALLBACK_MODELS || 'gemini-3.6-flash,gemini-3.8-flash,gemini-3.1-flash-lite')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [primary, ...fallbacks.filter((m) => m !== primary)];
}

function retryable(err: any) {
  const msg = String(err?.message ?? err);
  return /\b(429|500|503|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand|INTERNAL)\b/i.test(msg);
}

async function generate(args: { contents: Content[]; config: any; timeoutMs?: number }) {
  let lastErr: any;
  for (const model of models()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await ai().models.generateContent({
          model,
          contents: args.contents,
          config: { ...args.config, httpOptions: { timeout: args.timeoutMs ?? 45_000 } },
        });
        return { res, model };
      } catch (err) {
        lastErr = err;
        console.warn(`[gemini] ${model} attempt ${attempt + 1} failed: ${String((err as any)?.message ?? err).slice(0, 160)}`);
        if (/404|NOT_FOUND|no longer available/i.test(String((err as any)?.message ?? err))) break;
        if (!retryable(err) && !/abort|timed? ?out/i.test(String((err as any)?.message ?? err))) throw err;
        // A model that is overloaded rarely recovers within seconds: move on after one retry.
        if (/503|UNAVAILABLE|high demand|abort|timed? ?out/i.test(String((err as any)?.message ?? err))) break;
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

export function inlinePart(base64: string, mimeType: string): Part {
  return { inlineData: { data: base64, mimeType } };
}

/** One-shot structured output. `parts` may mix text, images and audio. */
export async function generateJSON<T>(opts: {
  system: string;
  parts: Part[];
  schema: object;
  thinking?: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';
}): Promise<{ data: T; model: string }> {
  const { res, model } = await generate({
    contents: [{ role: 'user', parts: opts.parts }],
    config: {
      systemInstruction: opts.system,
      responseMimeType: 'application/json',
      responseJsonSchema: opts.schema,
      ...(opts.thinking ? { thinkingConfig: { thinkingLevel: opts.thinking } } : {}),
    },
  });
  const text = res.text ?? '';
  try {
    return { data: JSON.parse(text) as T, model };
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return { data: JSON.parse(m[0]) as T, model };
    throw new Error('Model did not return valid JSON');
  }
}

export async function generateText(system: string, parts: Part[]): Promise<string> {
  const { res } = await generate({ contents: [{ role: 'user', parts }], config: { systemInstruction: system } });
  return res.text ?? '';
}

// ---------------------------------------------------------------- agent loop

export interface AgentTool<A = any> {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: object;
  /** Where the tool comes from, shown in the UI ("PayPal Agent Toolkit", "PayPal Payouts API", "Haat"). */
  source?: string;
  execute: (args: A, ctx: AgentContext) => Promise<unknown>;
}

export interface AgentContext {
  actor: string;
  channel?: string;
  /** Free-form per-run state tools can share (e.g. the seller id). */
  state: Record<string, any>;
}

export type AgentEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool_call'; id: string; name: string; source?: string; args: unknown }
  | { kind: 'tool_result'; id: string; name: string; ok: boolean; result: unknown; ms: number }
  | { kind: 'done'; text: string; model: string };

export async function runAgent(opts: {
  system: string;
  history: Content[];
  tools: AgentTool[];
  ctx: AgentContext;
  onEvent?: (e: AgentEvent) => void;
  maxSteps?: number;
}): Promise<{ text: string; history: Content[]; model: string }> {
  const history = [...opts.history];
  const decls: FunctionDeclaration[] = opts.tools.map((t) => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: t.parameters,
  }));
  const byName = new Map(opts.tools.map((t) => [t.name, t]));
  let lastModel = '';
  let collected = '';

  for (let step = 0; step < (opts.maxSteps ?? 10); step++) {
    const { res, model } = await generate({
      contents: history,
      config: {
        systemInstruction: opts.system,
        tools: decls.length ? [{ functionDeclarations: decls }] : undefined,
        thinkingConfig: { thinkingLevel: 'LOW' },
      },
    });
    lastModel = model;
    const content = res.candidates?.[0]?.content;
    if (!content) break;
    history.push(content);

    const text = (content.parts ?? [])
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join('')
      .trim();
    if (text) {
      collected = text;
      opts.onEvent?.({ kind: 'text', text });
    }

    const calls = (content.parts ?? []).filter((p) => p.functionCall).map((p) => p.functionCall!);
    if (!calls.length) {
      opts.onEvent?.({ kind: 'done', text: collected, model });
      return { text: collected, history, model };
    }

    const responses: Part[] = await Promise.all(
      calls.map(async (call, i) => {
        const id = call.id ?? `${step}-${i}`;
        const tool = byName.get(call.name ?? '');
        opts.onEvent?.({ kind: 'tool_call', id, name: call.name ?? '?', source: tool?.source, args: call.args });
        const started = Date.now();
        let ok = true;
        let result: unknown;
        try {
          if (!tool) throw new Error(`Unknown tool ${call.name}`);
          result = await tool.execute(call.args ?? {}, opts.ctx);
        } catch (err: any) {
          ok = false;
          result = { error: err?.message ?? String(err), issue: err?.issue, debug_id: err?.debugId };
        }
        opts.onEvent?.({ kind: 'tool_result', id, name: call.name ?? '?', ok, result, ms: Date.now() - started });
        return {
          functionResponse: {
            id: call.id,
            name: call.name,
            response: ok ? { output: result as any } : { error: result as any },
          },
        } as Part;
      }),
    );
    history.push({ role: 'user', parts: responses });
  }
  opts.onEvent?.({ kind: 'done', text: collected, model: lastModel });
  return { text: collected, history, model: lastModel };
}

// ---------------------------------------------------------------- speech

let ttsClient: GoogleGenAI | null = null;
const TTS_MODELS = (process.env.GEMINI_TTS_MODELS || 'gemini-3.8-flash-tts,gemini-3.1-flash-tts-preview').split(',').map((s) => s.trim());

function wavFromPcm(pcm: Buffer, rate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Speak a short message aloud (any Indian language). Returns WAV bytes. */
export async function speak(text: string, _style = 'a warm, unhurried voice, like a trusted relative reading a message aloud'): Promise<Buffer> {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
  ttsClient ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { apiVersion: 'v1beta' } });
  let lastErr: any;
  for (const model of TTS_MODELS) {
    try {
      const r = await ttsClient.models.generateContent({
        model,
        // Send only the words: some TTS models read a style instruction out loud as part of the audio.
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Sulafat' } } },
          httpOptions: { timeout: 60_000 },
        } as any,
      });
      const part = r.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
      if (!part?.inlineData?.data) throw new Error('No audio returned');
      const bytes = Buffer.from(part.inlineData.data, 'base64');
      if (bytes.subarray(0, 4).toString() === 'RIFF') return bytes;
      const rate = Number(part.inlineData.mimeType?.match(/rate=(\d+)/)?.[1] ?? 24000);
      return wavFromPcm(bytes, rate);
    } catch (err) {
      lastErr = err;
      console.warn(`[tts] ${model} failed: ${String((err as any)?.message ?? err).slice(0, 140)}`);
    }
  }
  throw lastErr;
}
