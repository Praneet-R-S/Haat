// Spoken replies for makers who prefer listening to reading. Cached on disk by text hash.

import { createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { speak } from '../ai/gemini.ts';
import { DATA_DIR } from '../db/index.ts';

const inflight = new Map<string, Promise<string>>();

export function voiceFor(text: string): Promise<string> {
  const clean = text.trim().slice(0, 900);
  const key = createHash('sha1').update(clean).digest('hex').slice(0, 20);
  const name = `voice-${key}.wav`;
  const url = `/uploads/${name}`;
  if (existsSync(resolve(DATA_DIR, 'uploads', name))) return Promise.resolve(url);
  if (inflight.has(key)) return inflight.get(key)!;
  const job = speak(clean)
    .then((wav) => {
      writeFileSync(resolve(DATA_DIR, 'uploads', name), wav);
      return url;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}
