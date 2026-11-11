/* Haat landing page. Vanilla scroll choreography; transform, opacity and clip-path only. */
(() => {
  'use strict';
  const doc = document.documentElement;
  const motion = doc.classList.contains('motion');
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const seg = (p, a, b) => clamp((p - a) / (b - a));
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const mqPhone = matchMedia('(max-width: 760px)');
  const fine = matchMedia('(pointer: fine)').matches;

  /* ---------------------------------------------------------------- the voice note: data */
  // Loudness of the real test-run recording (/seed/sample-voice-hi.wav), 72 windows.
  const RMS = [0.01, 1, 0.6, 0.85, 0.17, 0.95, 0.2, 0.65, 0.68, 0.38, 0.75, 0.73, 0.75, 0.64, 0.68, 0.77, 0.3, 0.2, 0.4, 0.65, 0.51, 0.1, 0.91, 0.85, 0.44, 0.15, 0, 0, 0.02, 0.53, 0.16, 0, 0.53, 0.64, 0.64, 0.58, 0.37, 0.41, 0.02, 0.53, 0.46, 0.45, 0.49, 0.04, 0.01, 0.88, 0.79, 0.75, 0.7, 0.11, 0, 0.36, 0.62, 0.12, 0.99, 0.8, 0.16, 0.63, 0.61, 0.19, 0.01, 0.44, 0.77, 0.7, 0.87, 0.52, 0.12, 0, 0.46, 0.81, 0.39, 0.1];
  const DUR = 25.16;
  $$('[data-wave]').forEach((el) => {
    const frag = document.createDocumentFragment();
    RMS.forEach((v) => {
      const i = document.createElement('i');
      i.style.setProperty('--h', Math.max(0.1, v).toFixed(2));
      frag.appendChild(i);
    });
    el.appendChild(frag);
  });
  const lit = $('[data-wave-lit]');
  const timeEl = $('[data-time]');
  const fmt = (t) => `0:${String(Math.floor(t)).padStart(2, '0')}`;

  // Split each Hindi line into words and give every word a start time inside its sentence.
  const sents = $$('.sent').map((el) => {
    const [t0, t1] = el.dataset.t.split(' ').map(Number);
    const hi = $('.hi', el);
    const words = hi.textContent.trim().split(/\s+/);
    hi.textContent = '';
    const ws = words.map((w, i) => {
      const s = document.createElement('span');
      s.className = 'w';
      s.textContent = w;
      hi.appendChild(s);
      if (i < words.length - 1) hi.appendChild(document.createTextNode(' '));
      return s;
    });
    const weight = words.map((w) => (/\d/.test(w) ? 9 : w.replace(/[।,]/g, '').length + 1));
    const total = weight.reduce((a, b) => a + b, 0);
    let acc = 0;
    const times = weight.map((w) => {
      const t = t0 + (acc / total) * (t1 - t0);
      acc += w;
      return t;
    });
    return { el, t0, t1, ws, times, en: $('.en', el) };
  });

  // Wrap each card field so it can wipe in over its placeholder.
  const fills = $$('[data-fill]').map((el) => {
    const t = document.createElement('span');
    t.className = 'fill__t';
    while (el.firstChild) t.appendChild(el.firstChild);
    el.appendChild(t);
    return { el, at: Number(el.dataset.fill), on: null };
  });

  /* ---------------------------------------------------------------- audio */
  const playBtn = $('[data-play]');
  const playLabel = $('[data-play-label]');
  const AUDIO_SRC = '/seed/sample-voice-hi.wav';
  let audio = null;
  let syncing = false;
  const setPlaying = (on) => {
    playBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    playLabel.textContent = on ? 'Pause the voice note' : 'Play the voice note (Hindi, 25 seconds)';
  };
  const disableAudio = () => {
    playBtn.disabled = true;
    playLabel.textContent = 'The recording plays when the Haat app server is running';
    playBtn.title = 'The recording is served by the Haat app';
  };
  if (location.protocol === 'file:') disableAudio();
  else fetch(AUDIO_SRC, { method: 'HEAD' }).then((r) => { if (!r.ok) disableAudio(); }).catch(disableAudio);

  playBtn.addEventListener('click', () => {
    if (!audio) {
      audio = new Audio(AUDIO_SRC);
      audio.preload = 'auto';
      audio.addEventListener('ended', () => { syncing = false; setPlaying(false); });
      audio.addEventListener('pause', () => { syncing = false; setPlaying(false); });
      audio.addEventListener('play', () => setPlaying(true));
      audio.addEventListener('error', disableAudio);
    }
    if (!audio.paused) { audio.pause(); return; }
    if (motion && note) {
      const p = progressOf(note.el);
      const a = seg(p, NOTE.audio[0], NOTE.audio[1]);
      audio.currentTime = a > 0.02 && a < 0.98 ? a * DUR : 0;
      syncing = true;
    } else if (audio.ended) {
      audio.currentTime = 0;
    }
    audio.play().catch(() => { syncing = false; setPlaying(false); });
  });
  const interrupt = () => { if (syncing && audio && !audio.paused) audio.pause(); };
  addEventListener('wheel', interrupt, { passive: true });
  addEventListener('touchstart', interrupt, { passive: true });
  addEventListener('keydown', (e) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key) && e.target !== playBtn) interrupt(); });

  /* ---------------------------------------------------------------- static mode: audio still lights the note */
  if (!motion) {
    const loop = () => {
      if (audio && !audio.paused) {
        const t = audio.currentTime;
        lit.style.clipPath = `inset(0 ${(100 - (100 * t) / DUR).toFixed(2)}% 0 0)`;
        timeEl.textContent = fmt(t);
        sents.forEach((s) => s.ws.forEach((w, i) => w.classList.toggle('now', t >= s.times[i] && t < (s.times[i + 1] ?? s.t1 + 0.2))));
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return;
  }

  /* ---------------------------------------------------------------- motion mode */
  const progressOf = (el) => {
    const r = el.getBoundingClientRect();
    const span = r.height - innerHeight;
    return span > 0 ? clamp(-r.top / span) : r.top < 0 ? 1 : 0;
  };
  const inView = (el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > -50 && r.top < innerHeight + 50;
  };
  const S = (el) => ({ el, cur: -1, tgt: 0 });

  /* hero planes */
  const hero = S($('[data-act="hero"]'));
  const H = {
    bg: $('[data-plane="bg"]'), subject: $('[data-plane="subject"]'), copy: $('[data-plane="copy"]'),
    fore: $('[data-plane="fore"]'), air: $('[data-plane="air"]'), cap: $('.hero__caption'),
  };
  const ptr = { x: 0, y: 0, tx: 0, ty: 0 };
  if (fine) {
    addEventListener('pointermove', (e) => {
      ptr.tx = (e.clientX / innerWidth) * 2 - 1;
      ptr.ty = (e.clientY / innerHeight) * 2 - 1;
    }, { passive: true });
  }
  function drawHero(p) {
    const vh = innerHeight, x = ptr.x, y = ptr.y;
    H.bg.style.transform = `translate3d(${(-x * 6).toFixed(1)}px, ${(-p * 0.06 * vh - y * 4).toFixed(1)}px, 0) scale(${(1 + 0.05 * p).toFixed(4)})`;
    H.subject.style.transform = `translate3d(${(-x * 12).toFixed(1)}px, ${(-p * 0.14 * vh - y * 7).toFixed(1)}px, 0)`;
    H.copy.style.transform = `translate3d(0, ${(-p * 0.24 * vh).toFixed(1)}px, 0)`;
    H.copy.style.opacity = (1 - seg(p, 0.6, 0.98)).toFixed(3);
    H.fore.style.transform = `translate3d(${(-x * 22).toFixed(1)}px, ${((0.05 - p * 0.46) * vh - y * 10).toFixed(1)}px, 0)`;
    H.air.style.transform = `translate3d(${(-x * 34).toFixed(1)}px, ${(-p * 0.55 * vh - y * 14).toFixed(1)}px, 0)`;
    H.air.style.opacity = (1 - seg(p, 0, 0.7)).toFixed(3);
    H.cap.style.opacity = (1 - seg(p, 0.06, 0.25)).toFixed(3);
  }

  /* the pile */
  const pile = S($('[data-act="pile"]'));
  const slips = $$('.slip').map((el) => ({ el, r: Number(el.dataset.r) }));
  const cloth = $('[data-pile-cloth]');
  const pileLast = $('[data-pile-last]');
  function drawPile(p) {
    slips.forEach((s, i) => {
      const a = 0.05 + i * 0.1;
      const e = ease(seg(p, a, a + 0.075));
      const swing = i % 2 ? 9 : -9;
      s.el.style.opacity = e.toFixed(3);
      s.el.style.transform = `translate3d(0, ${((1 - e) * 110).toFixed(1)}px, 0) rotate(${(s.r + (1 - e) * swing).toFixed(2)}deg) scale(${(1.06 - 0.06 * e).toFixed(4)})`;
    });
    const b = seg(p, 0.05, 0.78);
    cloth.style.transform = `rotate(1.5deg) scale(${(1 - 0.05 * b).toFixed(4)})`;
    cloth.style.opacity = (1 - 0.3 * b).toFixed(3);
    const l = ease(seg(p, 0.8, 0.88));
    pileLast.style.opacity = l.toFixed(3);
    pileLast.style.transform = `translate3d(0, ${((1 - l) * 16).toFixed(1)}px, 0)`;
  }

  /* the voice note */
  const NOTE = { voice: [0.03, 0.065], flood: [0.07, 0.14], grid: [0.15, 0.19], audio: [0.19, 0.7], out: [0.72, 0.755], price: [0.755, 0.88], stamp: [0.9, 0.94] };
  const note = S($('[data-act="note"]'));
  const N = {
    stage: $('.note__stage'), flood: $('.note__flood'), hush: $('[data-hush]'), hushLit: $('[data-hush-lit]'), voice: $('[data-voice]'),
    who: $('.thread__who'), photo: $('.bubble--photo'), words: $('.note__words'), transcript: $('[data-transcript]'),
    listing: $('.listing'), price: $('[data-price]'), rows: $$('[data-price] [data-row]'), stamp: $('[data-stamp]'),
  };
  let floodC = { x: 0, y: 0, r: 0 };
  function measureFlood() {
    const st = N.stage.getBoundingClientRect();
    const b = playBtn.getBoundingClientRect();
    floodC.x = b.left + b.width / 2 - st.left;
    floodC.y = b.top + b.height / 2 - st.top;
    floodC.r = Math.hypot(Math.max(floodC.x, st.width - floodC.x), Math.max(floodC.y, st.height - floodC.y)) + 20;
  }
  function drawNote(p) {
    const phone = mqPhone.matches;
    // the quiet line, then the bubble, then the indigo flood from the play button
    const v = ease(seg(p, NOTE.voice[0], NOTE.voice[1]));
    N.voice.style.opacity = v.toFixed(3);
    N.voice.style.transform = `translate3d(0, ${((1 - v) * 24).toFixed(1)}px, 0)`;
    const f = easeIO(seg(p, NOTE.flood[0], NOTE.flood[1]));
    const circle = `circle(${(f * floodC.r).toFixed(1)}px at ${floodC.x.toFixed(1)}px ${floodC.y.toFixed(1)}px)`;
    N.flood.style.clipPath = circle;
    N.hushLit.style.clipPath = circle;
    // the line turns paper-coloured where the indigo reaches it, then lifts away
    const h = seg(p, NOTE.flood[1] - 0.015, NOTE.grid[0] + 0.01);
    [N.hush, N.hushLit].forEach((el) => {
      el.style.opacity = (1 - h).toFixed(3);
      el.style.transform = `translate3d(0, ${(-h * 70).toFixed(1)}px, 0)`;
      el.style.visibility = h >= 1 ? 'hidden' : 'visible';
    });

    const g = ease(seg(p, NOTE.grid[0], NOTE.grid[1]));
    [N.who, N.photo].forEach((el) => { el.style.opacity = g.toFixed(3); el.style.transform = `translate3d(0, ${((1 - g) * 18).toFixed(1)}px, 0)`; });
    N.words.style.opacity = g.toFixed(3);
    const lg = ease(seg(p, NOTE.grid[0] + 0.01, NOTE.grid[1] + 0.01));
    N.listing.style.opacity = lg.toFixed(3);
    N.listing.style.transform = `translate3d(${((1 - lg) * 40).toFixed(1)}px, 0, 0)`;

    // playback position
    const t = seg(p, NOTE.audio[0], NOTE.audio[1]) * DUR;
    lit.style.clipPath = `inset(0 ${(100 - (100 * t) / DUR).toFixed(2)}% 0 0)`;
    timeEl.textContent = t > 0.05 ? fmt(t) : fmt(DUR);

    let cur = 0;
    sents.forEach((s, si) => {
      if (t >= s.t0 - 0.3) cur = si;
      s.ws.forEach((w, i) => {
        const a = clamp((t - s.times[i]) / 0.3);
        w.style.opacity = (0.26 + 0.74 * a).toFixed(3);
        const next = s.times[i + 1] ?? s.t1 + 0.25;
        w.classList.toggle('now', t >= s.times[i] && t < next && t < DUR - 0.05);
      });
      if (s.en) {
        const e = ease(clamp((t - s.t1 + 0.2) / 0.7));
        s.en.style.opacity = e.toFixed(3);
        s.en.style.transform = `translate3d(0, ${((1 - e) * 8).toFixed(1)}px, 0)`;
      }
    });
    // on a phone only the sentence being spoken is on screen
    sents.forEach((s, si) => {
      if (phone) {
        const nextT0 = sents[si + 1] ? sents[si + 1].t0 : Infinity;
        const show = si === 0 ? 1 : clamp((t - s.t0 + 0.25) / 0.25);
        const hide = clamp((t - nextT0 + 0.5) / 0.25);
        const o = show * (1 - hide);
        s.el.style.opacity = o.toFixed(3);
        s.el.style.transform = `translate3d(0, ${((1 - show) * 24 - hide * 24).toFixed(1)}px, 0)`;
      } else {
        s.el.style.opacity = '';
        s.el.style.transform = '';
      }
    });
    const out = seg(p, NOTE.out[0], NOTE.out[1]);
    N.transcript.style.opacity = (1 - out).toFixed(3);
    N.transcript.style.transform = `translate3d(0, ${(-out * 30).toFixed(1)}px, 0)`;
    N.transcript.style.visibility = out >= 1 ? 'hidden' : 'visible';

    // the price, worked out line by line
    const pr = seg(p, NOTE.price[0], NOTE.price[0] + 0.02);
    N.price.style.opacity = pr.toFixed(3);
    N.price.style.visibility = pr <= 0 ? 'hidden' : 'visible';
    let totalIn = false;
    N.rows.forEach((row, i) => {
      const a = NOTE.price[0] + 0.012 + i * 0.016;
      const e = ease(seg(p, a, a + 0.02));
      row.style.opacity = e.toFixed(3);
      row.style.transform = `translate3d(${((1 - e) * -16).toFixed(1)}px, 0, 0)`;
      if (row.classList.contains('ledger__row--total') && e > 0.5) totalIn = true;
    });

    fills.forEach((fl) => {
      const on = fl.at === 7 ? totalIn : t >= sents[fl.at].t1 - 0.1;
      if (on !== fl.on) { fl.el.classList.toggle('is-in', on); fl.on = on; }
    });

    const st = seg(p, NOTE.stamp[0], NOTE.stamp[1]);
    const se = ease(st);
    N.stamp.style.opacity = clamp(st * 2).toFixed(3);
    N.stamp.style.transform = `rotate(-9deg) scale(${(1.5 - 0.5 * se).toFixed(4)})`;
  }

  /* the desk: folios pan sideways, entries write themselves */
  const desk = S($('[data-act="desk"]'));
  const track = $('[data-track]');
  const folios = $$('[data-folio]').map((el) => ({ el, lines: $$('.entries li', el), x: 0 }));
  let panMax = 0;
  function measureDesk() {
    panMax = Math.max(0, track.scrollWidth - innerWidth);
    desk.el.style.height = `${Math.round(panMax * 1.15 + innerHeight)}px`;
    folios.forEach((f) => { f.x = f.el.offsetLeft; });
  }
  function drawDesk(p) {
    const q = seg(p, 0.04, 0.96);
    const shift = q * panMax;
    track.style.transform = `translate3d(${(-shift).toFixed(1)}px, 0, 0)`;
    const vw = innerWidth;
    folios.forEach((f) => {
      const left = f.x - shift;
      const t = clamp((vw * 0.95 - left) / (vw * (mqPhone.matches ? 0.7 : 0.45)));
      f.lines.forEach((li, i) => {
        const r = clamp(t * 1.7 - i * 0.2);
        li.style.clipPath = `inset(0 ${((1 - r) * 100).toFixed(1)}% 0 0)`;
      });
    });
  }

  /* agents: the chat plays once it is in view */
  const chat = $('.chat');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => {
      es.forEach((e) => { if (e.isIntersecting) { chat.classList.add('in'); io.disconnect(); } });
    }, { threshold: 0.35 });
    io.observe(chat);
  } else chat.classList.add('in');

  /* keyboard users who tab to the play button should see it */
  playBtn.addEventListener('focus', () => {
    const p = progressOf(note.el);
    if (p < NOTE.voice[1]) {
      const r = note.el.getBoundingClientRect();
      scrollTo(0, scrollY + r.top + (r.height - innerHeight) * (NOTE.flood[1] + 0.01));
    }
  });

  /* ---------------------------------------------------------------- loop */
  const acts = [
    [hero, drawHero],
    [pile, drawPile],
    [note, drawNote],
    [desk, drawDesk],
  ];
  function measure() {
    measureDesk();
    measureFlood();
    acts.forEach(([s]) => { s.cur = -1; s.drawn = false; });
  }
  measure();
  addEventListener('resize', measure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  addEventListener('load', measure);

  let last = performance.now();
  function tick(now) {
    const dt = Math.min(64, now - last);
    last = now;
    const k = 1 - Math.pow(1 - 0.17, dt / 16.7);

    if (syncing && audio && !audio.paused) {
      const r = note.el.getBoundingClientRect();
      const span = r.height - innerHeight;
      const p = NOTE.audio[0] + (audio.currentTime / DUR) * (NOTE.audio[1] - NOTE.audio[0]);
      const y = Math.round(scrollY + r.top + p * span);
      if (Math.abs(y - scrollY) > 1) scrollTo(0, y);
    }

    ptr.x += (ptr.tx - ptr.x) * k * 0.5;
    ptr.y += (ptr.ty - ptr.y) * k * 0.5;
    const ptrMoving = Math.abs(ptr.tx - ptr.x) + Math.abs(ptr.ty - ptr.y) > 0.001;

    acts.forEach(([s, draw]) => {
      if (!inView(s.el)) return;
      s.tgt = progressOf(s.el);
      if (s.cur < 0) s.cur = s.tgt;
      const d = s.tgt - s.cur;
      const moving = Math.abs(d) > 0.0002;
      if (moving) s.cur += d * k;
      if (moving || s.drawn !== true || (s === hero && ptrMoving)) {
        draw(s.cur);
        s.drawn = !moving;
      }
    });
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
