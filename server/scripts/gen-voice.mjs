// Generates the sample seller voice note (Hindi) used by "Try it with a sample".
import { GoogleGenAI } from '@google/genai';
import { writeFileSync } from 'node:fs';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { apiVersion: 'v1beta' } });
const TEXT = 'नमस्ते। यह नया कपड़ा है, बगरू का, हाथ से ठप्पे से छापा हुआ, नील और सफ़ेद रंग में। सूती है, ढाई मीटर लंबा, एक मीटर चौड़ा। एक पीस के मुझे बारह सौ रुपये चाहिए। अभी छह पीस तैयार हैं।';
const say = `Say in a calm, warm, slightly husky middle-aged man's voice from rural Rajasthan, speaking naturally like a voice note on the phone: ${TEXT}`;
for (const model of ['gemini-3.8-flash-tts', 'gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts']) {
  try {
    const r = await ai.models.generateContent({ model, contents: [{ parts: [{ text: say }] }], config: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } } } });
    const part = r.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    const pcm = Buffer.from(part.inlineData.data, 'base64');
    const rate = Number((part.inlineData.mimeType.match(/rate=(\d+)/) || [])[1] || 24000);
    if (pcm.subarray(0, 4).toString() === 'RIFF') { writeFileSync('seed/images/sample-voice-hi.wav', pcm); console.log('ok (wav)', model, pcm.length); break; }
    const h = Buffer.alloc(44);
    h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
    writeFileSync('seed/images/sample-voice-hi.wav', Buffer.concat([h, pcm]));
    console.log('ok', model, part.inlineData.mimeType, pcm.length); break;
  } catch (e) { console.log('fail', model, String(e.message).slice(0, 140)); }
}
