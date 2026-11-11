// The maker's side of Haat: a phone-sized chat that behaves like the WhatsApp they already use.
// Photo + voice note in, an export listing out; sale news comes back as text and as a voice note.

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api, fileToB64, inr, scriptClass, shrinkImage, stream, usd, useEvents, type Activity, type Maker, type Order, type Product, type Seller } from '../lib';
import { Dots, Img, ToolChip } from '../ui';
import { UpiSplit, type Split } from '../UpiSplit';

type Tool = { name: string; source?: string; ok?: boolean };
type Msg =
  | { id?: string; role: 'seller'; text: string; english?: string; voice?: boolean; voiceUrl?: string; image?: string; at: string }
  | { id?: string; role: 'agent'; text: string; english?: string; kind?: string; orderId?: string; audio?: string; split?: Split; tools?: Tool[]; at: string }
  | { id?: string; role: 'draft'; product: Product; reply?: { native: string; english: string }; at: string };

type SellerFull = Seller & { makers: Maker[]; products: Product[]; orders: Order[]; invoices: any[]; activity: Activity[]; thread: Msg[] };

/** Fire a demo action from anywhere (the Live stage uses this). */
export function demo(action: 'seller-sample' | 'buyer-ask', detail?: unknown) {
  window.dispatchEvent(new CustomEvent('haat:demo', { detail: { action, detail } }));
}
/** Tell the Live stage about a local milestone (things the server never sees, like "send pressed"). */
export function story(stage: string) {
  window.dispatchEvent(new CustomEvent('haat:story', { detail: { stage, at: Date.now() } }));
}

// ------------------------------------------------------------------ recorder

function useRecorder() {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [secs, setSecs] = useState(0);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);
  async function start() {
    const streamIn = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    const r = new MediaRecorder(streamIn, mime ? { mimeType: mime } : undefined);
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.start();
    setRec(r);
    setSecs(0);
    timer.current = window.setInterval(() => setSecs((s) => s + 1), 1000);
  }
  function stop(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!rec) return resolve(null);
      rec.onstop = () => {
        rec.stream.getTracks().forEach((t) => t.stop());
        resolve(new Blob(chunks.current, { type: rec.mimeType.split(';')[0] || 'audio/webm' }));
      };
      rec.stop();
      setRec(null);
      if (timer.current) clearInterval(timer.current);
    });
  }
  return { recording: !!rec, secs, start, stop };
}

// ------------------------------------------------------------------ voice playback

const players = new Set<HTMLAudioElement>();

function VoiceButton({ text, url: initial, lang, auto = false }: { text?: string; url?: string; lang?: string; auto?: boolean }) {
  const [url, setUrl] = useState(initial);
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const [progress, setProgress] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => setUrl(initial), [initial]);
  useEffect(() => () => audio.current?.pause(), []);

  async function toggle() {
    if (state === 'playing') {
      audio.current?.pause();
      setState('idle');
      return;
    }
    let u = url;
    if (!u && text) {
      setState('loading');
      try {
        u = (await api<{ url: string }>('/api/tts', { method: 'POST', json: { text } })).url;
        setUrl(u);
      } catch {
        setState('idle');
        return;
      }
    }
    if (!u) return;
    players.forEach((p) => p.pause());
    const a = new Audio(u);
    audio.current = a;
    players.add(a);
    a.ontimeupdate = () => setProgress(a.duration ? a.currentTime / a.duration : 0);
    a.onended = () => {
      setState('idle');
      setProgress(0);
      players.delete(a);
    };
    a.onpause = () => setState((s) => (s === 'playing' ? 'idle' : s));
    await a.play().catch(() => setState('idle'));
    setState('playing');
  }
  useEffect(() => {
    if (auto && initial) toggle();
  }, [auto, initial]);

  const label = lang === 'ta' ? 'கேளுங்கள்' : 'सुनें';
  return (
    <button onClick={toggle} className="group mt-1.5 inline-flex items-center gap-2 rounded-full bg-ink/[0.06] pl-1 pr-3 py-1 text-[0.74rem] text-ink-2 hover:bg-ink/10" aria-label={state === 'playing' ? 'Pause' : 'Listen'}>
      <span className="grid size-6 place-items-center rounded-full bg-indigo text-card">
        {state === 'loading' ? (
          <span className="size-1.5 rounded-full bg-card pulse-dot" />
        ) : state === 'playing' ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden><rect x="1" y="1" width="3" height="8" /><rect x="6" y="1" width="3" height="8" /></svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden><path d="M2 1l7 4-7 4z" /></svg>
        )}
      </span>
      <span className={scriptClass(lang)}>{label}</span>
      <span className="relative h-[3px] w-14 overflow-hidden rounded-full bg-ink/10" aria-hidden>
        <span className="absolute inset-y-0 left-0 bg-indigo transition-[width] duration-200" style={{ width: `${progress * 100}%` }} />
      </span>
    </button>
  );
}

// ------------------------------------------------------------------ phone

const STAGES = [
  { key: 'listening', label: 'Listening' },
  { key: 'writing', label: 'Writing in English' },
  { key: 'pricing', label: 'Pricing for export' },
];

export function SellerPhone({ slug, className = '' }: { slug: string; className?: string }) {
  const [seller, setSeller] = useState<SellerFull | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<{ data: string; mime: string; preview: string }[]>([]);
  const [audio, setAudio] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [liveTools, setLiveTools] = useState<{ id: string; name: string; source?: string; ok?: boolean; ms?: number }[]>([]);
  const [err, setErr] = useState('');
  const [showEn, setShowEn] = useState(true);
  const [autoplay, setAutoplay] = useState<string | null>(null);
  const rec = useRecorder();
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sendRef = useRef<() => void>(() => {});

  useEffect(() => {
    api<SellerFull>(`/api/sellers/${slug}`).then((s) => {
      setSeller(s);
      setMsgs(s.thread ?? []);
    });
  }, [slug]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [msgs.length, busy, stage, liveTools.length]);

  useEvents(seller ? [`seller:${seller.id}`] : null, (e) => {
    if (e.type === 'seller.message') setMsgs((m) => [...m, e.data]);
    if (e.type === 'seller.message.audio') {
      setMsgs((m) => m.map((x) => (x.id === e.data.id ? ({ ...x, audio: e.data.audio } as Msg) : x)));
      setAutoplay(e.data.id);
    }
  });

  // Demo hooks for the Live stage
  useEffect(() => {
    const on = (ev: Event) => {
      const { action } = (ev as CustomEvent).detail ?? {};
      if (action === 'seller-sample') loadSample().then(() => setTimeout(() => sendRef.current(), 450));
    };
    window.addEventListener('haat:demo', on);
    return () => window.removeEventListener('haat:demo', on);
  }, [seller?.id]);

  const lang = seller?.language;
  const now = () => new Date().toISOString();

  async function loadSample() {
    const res = await fetch('/seed/studio-raw-photo.jpg');
    const blob = await res.blob();
    setPhotos([await shrinkImage(new File([blob], 'photo.jpg', { type: blob.type }))]);
    const v = await fetch('/seed/sample-voice-hi.wav');
    if (v.ok) {
      const vb = await v.blob();
      setAudio({ blob: vb, url: URL.createObjectURL(vb) });
    } else {
      setText('यह बगरू का हाथ से छपा हुआ नील का कपड़ा है, सूती है, ढाई मीटर। मुझे एक पीस के बारह सौ रुपये चाहिए। अभी छह पीस हैं।');
    }
  }

  async function send() {
    if (!seller || busy) return;
    setErr('');
    const audioIn = audio ? await fileToB64(audio.blob) : null;
    const t = text.trim();
    if (!photos.length && !audioIn && !t) return;
    const sentPhotos = photos;
    const voiceUrl = audio?.url;
    setMsgs((m) => [...m, { role: 'seller', text: t || '', voice: !!audioIn, voiceUrl, image: sentPhotos[0]?.preview, at: now() }]);
    setText('');
    setPhotos([]);
    setAudio(null);
    try {
      if (sentPhotos.length) {
        story('sent');
        setBusy('listing');
        setStage(audioIn ? 'listening' : 'writing');
        await stream(
          '/api/studio/draft-stream',
          { sellerId: seller.id, images: sentPhotos.map(({ data, mime }) => ({ data, mime })), audio: audioIn, text: t || undefined },
          (line) => {
            if (line.type === 'event' && line.event.kind === 'stage') setStage(line.event.stage);
            if (line.type === 'event' && line.event.kind === 'heard') setHeard(line.event.original, line.event.english);
            if (line.type === 'draft') {
              if (line.transcript?.original) setHeard(line.transcript.original, line.transcript.english);
              setMsgs((m) => [...m, { role: 'draft', product: line.product, reply: line.reply, at: now() }]);
              story('drafted');
            }
            if (line.type === 'error') setErr(line.error);
          },
        );
      } else {
        setBusy('chat');
        setLiveTools([]);
        await stream(`/api/sellers/${seller.id}/message`, { text: t || undefined, audio: audioIn }, (line) => {
          if (line.type === 'event') {
            const e = line.event;
            if (e.kind === 'heard') setHeard(e.original, e.english);
            if (e.kind === 'tool_call') setLiveTools((x) => [...x, { id: e.id, name: e.name, source: e.source }]);
            if (e.kind === 'tool_result') setLiveTools((x) => x.map((y) => (y.id === e.id ? { ...y, ok: e.ok, ms: e.ms } : y)));
          }
          if (line.type === 'reply') setMsgs((m) => [...m, line.reply]);
          if (line.type === 'error') setErr(line.error);
        });
        setLiveTools([]);
      }
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
      setStage(null);
    }
  }
  sendRef.current = send;

  function setHeard(original: string, english: string) {
    setMsgs((m) => {
      const copy = [...m];
      for (let i = copy.length - 1; i >= 0; i--) {
        const x = copy[i];
        if (x.role === 'seller') {
          if (!x.text || x.voice) copy[i] = { ...x, text: original, english };
          break;
        }
      }
      return copy;
    });
  }

  async function publish(p: Product, price?: number) {
    setBusy('publish');
    try {
      const live = await api<Product>('/api/studio/publish', { method: 'POST', json: { productId: p.id, priceUsd: price } });
      setMsgs((m) => m.map((x) => (x.role === 'draft' && x.product.id === p.id ? { ...x, product: live } : x)));
      story('published');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function toggleRec() {
    setErr('');
    try {
      if (rec.recording) {
        const blob = await rec.stop();
        if (blob && blob.size > 800) setAudio({ blob, url: URL.createObjectURL(blob) });
      } else await rec.start();
    } catch {
      setErr('Microphone not available. Type instead, or use the sample.');
    }
  }

  if (!seller) return <div className={`${className} rounded-[34px] bg-sunk animate-pulse`} />;

  return (
    <div className={`phone flex flex-col overflow-hidden rounded-[30px] bg-[#ece5d8] ${className}`}>
      <div className="flex items-center gap-3 bg-indigo px-4 pb-3 pt-3.5 text-card">
        <div className="relative grid size-9 place-items-center rounded-full bg-card/15 display text-lg">
          H
          <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-indigo bg-[#8fc79a]" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-tight truncate">Haat export desk</p>
          <p className="text-[0.75rem] text-card/70 truncate">{busy ? <>working <Dots /></> : `for ${seller.name} · ${seller.language_name}`}</p>
        </div>
        <button onClick={() => setShowEn((s) => !s)} className="chip bg-card/15 text-card text-[0.7rem]" aria-pressed={showEn} title="Show English under each message">
          EN {showEn ? 'on' : 'off'}
        </button>
      </div>

      <div ref={scrollRef} className="phone-wall flex-1 overflow-y-auto px-3 py-4 space-y-2.5 [scrollbar-width:thin]" aria-live="polite">
        {msgs.length === 0 && (
          <div className="mx-auto mt-2 max-w-[92%] rounded-xl bg-card/85 p-3 text-center text-[0.82rem] leading-relaxed text-ink-2 shadow-sm">
            <p className={scriptClass(lang)}>{lang === 'ta' ? 'புதிய பொருளின் படத்தையும் குரல் செய்தியையும் அனுப்புங்கள்.' : 'नए सामान की फ़ोटो और एक वॉइस नोट भेजिए।'}</p>
            <p className="mt-1 text-[0.75rem] text-ink-3">Send a photo of a new piece and a voice note: what it is, how big, what you want for it.</p>
          </div>
        )}
        {msgs.map((m, i) => (
          <Bubble key={m.id ?? i} m={m} lang={lang} showEn={showEn} onPublish={publish} busy={!!busy} autoplay={m.id !== undefined && m.id === autoplay} />
        ))}
        {busy === 'listing' && stage && <WorkingBubble stage={stage} />}
        {busy === 'chat' && (
          <div className="flex flex-wrap items-center gap-1.5 pl-1">
            {liveTools.length === 0 && <span className="rounded-2xl bg-card px-3 py-2 text-ink-3 shadow-sm"><Dots /></span>}
            {liveTools.map((t) => (
              <ToolChip key={t.id} name={t.name} source={t.source} ok={t.ok} ms={t.ms} />
            ))}
          </div>
        )}
        {err && <p className="text-center text-[0.8rem] text-madder">{err}</p>}
      </div>

      <div className="border-t border-black/5 bg-card/80 p-2.5">
        {(photos.length > 0 || audio) && (
          <div className="mb-2 flex items-center gap-2 rise">
            {photos.map((p, i) => (
              <div key={i} className="relative">
                <img src={p.preview} alt="" className="size-12 rounded-md object-cover" />
                <button className="absolute -right-1.5 -top-1.5 size-5 rounded-full bg-ink text-card text-[10px]" onClick={() => setPhotos((x) => x.filter((_, j) => j !== i))} aria-label="Remove photo">
                  ×
                </button>
              </div>
            ))}
            {audio && (
              <div className="flex min-w-0 items-center gap-1.5 rounded-full bg-indigo-soft py-1 pl-1 pr-2">
                <VoiceButton url={audio.url} lang={lang} />
                <button className="text-ink-3 text-xs" onClick={() => setAudio(null)} aria-label="Remove voice note">×</button>
              </div>
            )}
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={async (e) => {
              const files = Array.from(e.target.files ?? []).slice(0, 3);
              setPhotos(await Promise.all(files.map((f) => shrinkImage(f))));
              e.target.value = '';
            }}
          />
          <button className="btn btn-quiet min-h-10 px-2.5 shrink-0" onClick={() => fileRef.current?.click()} aria-label="Add photo" title="Add photo">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><rect x="3" y="6" width="18" height="14" rx="2.5" /><circle cx="12" cy="13" r="3.5" /><path d="M8.5 6l1.4-2h4.2l1.4 2" /></svg>
          </button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={lang === 'ta' ? 'தட்டச்சு செய்யுங்கள்…' : 'लिखिए या बोलिए…'}
            className={`field min-h-10 max-h-28 resize-none py-2 text-[0.9rem] ${scriptClass(lang)}`}
            aria-label="Message"
          />
          {text.trim() || photos.length || audio ? (
            <button className="btn btn-primary min-h-10 px-3 shrink-0" onClick={send} disabled={!!busy} aria-label="Send">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M3.4 20.4 21 12 3.4 3.6 3.3 10l12.4 2-12.4 2z" /></svg>
            </button>
          ) : (
            <button
              className={`btn min-h-10 px-3 shrink-0 ${rec.recording ? 'bg-madder text-card' : 'btn-primary'}`}
              onClick={toggleRec}
              aria-label={rec.recording ? 'Stop recording' : 'Record voice note'}
              aria-pressed={rec.recording}
            >
              {rec.recording ? (
                <span className="num text-sm">{rec.secs}s ■</span>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
              )}
            </button>
          )}
        </div>
        <button onClick={loadSample} disabled={!!busy} className="mt-1.5 w-full text-center text-[0.72rem] text-ink-3 hover:text-ink">
          Try it with a sample photo and Hindi voice note
        </button>
      </div>
    </div>
  );
}

function WorkingBubble({ stage }: { stage: string }) {
  const idx = Math.max(0, STAGES.findIndex((s) => s.key === stage));
  return (
    <div className="flex justify-start rise">
      <div className="rounded-2xl rounded-bl-md bg-card px-3.5 py-2.5 shadow-sm text-[0.8rem]">
        <ol className="space-y-1">
          {STAGES.map((s, i) => (
            <li key={s.key} className={`flex items-center gap-2 ${i < idx ? 'text-leaf' : i === idx ? 'text-ink' : 'text-ink-3/70'}`}>
              <span className="grid size-3.5 place-items-center" aria-hidden>
                {i < idx ? '✓' : i === idx ? <span className="size-1.5 rounded-full bg-turmeric pulse-dot" /> : <span className="size-1 rounded-full bg-current" />}
              </span>
              {s.label}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Bubble({ m, lang, showEn, onPublish, busy, autoplay }: { m: Msg; lang?: string; showEn: boolean; onPublish: (p: Product, price?: number) => void; busy: boolean; autoplay: boolean }) {
  if (m.role === 'seller')
    return (
      <div className="flex justify-end rise">
        <div className="max-w-[84%] rounded-2xl rounded-br-md bg-[#d7e4cc] px-3 py-2 text-[0.9rem] shadow-sm">
          {m.image && <img src={m.image} alt="" className="mb-2 max-h-44 w-full rounded-lg object-cover" />}
          {m.voice && (m.voiceUrl ? <VoiceButton url={m.voiceUrl} lang={lang} /> : <p className="text-[0.72rem] text-ink-3">Voice note</p>)}
          {m.text ? <p className={`${m.voice ? 'mt-1.5' : ''} ${scriptClass(lang)}`}>{m.text}</p> : m.voice ? <p className="mt-1 text-[0.75rem] text-ink-3">Transcribing <Dots /></p> : null}
          {showEn && m.english && <p className="mt-1 border-t border-ink/10 pt-1 text-[0.76rem] text-ink-2">{m.english}</p>}
        </div>
      </div>
    );
  if (m.role === 'draft') return <DraftCard m={m} lang={lang} showEn={showEn} onPublish={onPublish} busy={busy} />;
  const sale = m.kind === 'sale';
  return (
    <div className="flex justify-start rise">
      <div className={`max-w-[88%] rounded-2xl rounded-bl-md px-3 py-2 text-[0.9rem] shadow-sm ${sale ? 'bg-[#f6e7c3]' : 'bg-card'}`}>
        {sale && (
          <p className="mb-1 flex items-center gap-1.5 text-[0.72rem] font-semibold text-[#6d4c12]">
            <span className="size-1.5 rounded-full bg-turmeric" /> {lang === 'ta' ? 'விற்பனை' : 'बिक गया'} · Sold
          </p>
        )}
        <p className={`whitespace-pre-wrap ${scriptClass(lang)}`}>{m.text}</p>
        {showEn && m.english && <p className="mt-1 border-t border-ink/10 pt-1 text-[0.76rem] text-ink-2">{m.english}</p>}
        {(m.audio || !sale) && <VoiceButton text={m.text} url={m.audio} lang={lang} auto={autoplay} />}
        {sale && !m.audio && <p className="mt-1 text-[0.7rem] text-ink-3">Recording a voice note <Dots /></p>}
        {!!m.tools?.length && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {m.tools.map((t, i) => (
              <ToolChip key={i} name={t.name} source={t.source} ok={t.ok ?? true} />
            ))}
          </div>
        )}
        {sale && m.split && m.orderId && (
          <div className="mt-2">
            <UpiSplit orderId={m.orderId} split={m.split} compact />
          </div>
        )}
        {sale && m.orderId && (
          <Link to={`/orders/${m.orderId}`} className="mt-1.5 inline-block text-[0.76rem] text-indigo">
            See where the money went
          </Link>
        )}
      </div>
    </div>
  );
}

function DraftCard({ m, lang, showEn, onPublish, busy }: { m: Extract<Msg, { role: 'draft' }>; lang?: string; showEn: boolean; onPublish: (p: Product, price?: number) => void; busy: boolean }) {
  const p = m.product;
  const [price, setPrice] = useState(p.price_usd.toFixed(2));
  const live = p.status === 'live';
  const d = (i: number) => ({ animationDelay: `${180 + i * 170}ms` });
  return (
    <div className="flex justify-start">
      <div className="w-[92%] overflow-hidden rounded-2xl rounded-bl-md bg-card shadow-sm">
        {m.reply && (
          <div className="px-3 pt-2.5 pb-2 text-[0.9rem] rise">
            <p className={scriptClass(lang)}>{m.reply.native}</p>
            {showEn && <p className="mt-1 text-[0.76rem] text-ink-2">{m.reply.english}</p>}
            <VoiceButton text={m.reply.native} lang={lang} />
          </div>
        )}
        <div className="border-t border-line bg-paper/70 p-3">
          <p className="label text-[0.6rem] rise" style={d(0)}>Listing, ready for buyers abroad</p>
          <div className="mt-2 flex gap-3">
            <Img src={p.images[0]} alt={p.title} className="size-16 shrink-0 rounded-md rise" />
            <div className="min-w-0">
              <p className="display text-[1.02rem] leading-snug rise" style={d(1)}>{p.title}</p>
              <p className="mt-0.5 text-[0.75rem] text-ink-2 rise" style={d(2)}>{p.subtitle}</p>
            </div>
          </div>
          <p className="mt-2.5 line-clamp-4 text-[0.8rem] leading-relaxed text-ink-2 rise" style={d(3)}>{p.story}</p>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-[0.75rem]">
            <div className="rise" style={d(4)}><dt className="label text-[0.6rem]">Buyer pays</dt><dd className="num text-[0.9rem]">{usd(p.price_usd)}</dd></div>
            <div className="rise" style={d(5)}><dt className="label text-[0.6rem]">You receive</dt><dd className="num text-[0.9rem] font-medium text-leaf">{inr(p.pricing.seller_take_home_inr)}</dd></div>
            <div className="rise" style={d(6)}><dt className="label text-[0.6rem]">HS code</dt><dd className="num text-[0.9rem]">{p.hs_code}</dd></div>
          </dl>
          <p className="mt-2 text-[0.7rem] text-ink-3 rise" style={d(7)}>You asked {inr(p.cost_inr)} · {p.pricing.notes?.[0]}</p>
          {live ? (
            <div className="mt-3 flex items-center justify-between gap-2 rise">
              <span className="chip bg-leaf-soft text-leaf">
                <span aria-hidden>✓</span> Live · PayPal Catalog {p.paypal_product_id ? <span className="num">{p.paypal_product_id.slice(0, 14)}</span> : ''}
              </span>
              <Link to={`/p/${p.slug}`} className="text-[0.78rem] text-indigo">View</Link>
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-2 rise" style={d(8)}>
              <label className="flex items-center gap-1 text-[0.78rem] text-ink-2">
                $<input value={price} onChange={(e) => setPrice(e.target.value)} className="field num min-h-8 w-20 py-1 text-[0.8rem]" inputMode="decimal" aria-label="Price in USD" />
              </label>
              <button className="btn btn-primary min-h-8 flex-1 text-[0.82rem]" disabled={busy} onClick={() => onPublish(p, Number(price) !== p.price_usd ? Number(price) : undefined)}>
                {lang === 'ta' ? 'விற்கத் தொடங்கு' : 'बेचना शुरू करें'} · Publish
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
