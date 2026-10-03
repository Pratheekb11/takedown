'use strict';

// All sound is synthesized (WebAudio effects, speech-synthesis announcer), so the game
// ships with zero audio files.
const Sound = (() => {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let muted = false;

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  const ok = () => ctx && !muted;

  function env(g, t, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  function noise(dur, type, f0, f1, q, peak) {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    env(g, t, peak, dur);
    src.connect(f).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  function tone(type, f0, f1, dur, peak) {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    env(g, t, peak, dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // Announcer voice: the device's own speech synthesizer, pitched down and slowed
  // for an arcade-announcer feel. Silently does nothing where speech isn't available.
  const speech = window.speechSynthesis;
  let voice = null;
  function pickVoice() {
    const all = speech ? speech.getVoices().filter((v) => /^en/i.test(v.lang)) : [];
    const pref = [/google uk english male/i, /daniel/i, /\bguy\b/i, /david/i, /\balex\b/i, /\bfred\b/i, /male/i];
    voice = pref.reduce((hit, re) => hit || all.find((v) => re.test(v.name)), null) || all[0] || null;
  }
  if (speech) {
    pickVoice();
    speech.addEventListener('voiceschanged', pickVoice);
  }

  // interrupt: cut off whatever is being said (default). Off = wait for it to finish.
  function say(text, { rate = 0.9, pitch = 0.55, volume = 1, interrupt = true } = {}) {
    if (!speech || muted) return;
    if (interrupt) speech.cancel(); // never let stale lines pile up
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.lang = voice ? voice.lang : 'en-US';
    u.rate = rate;
    u.pitch = pitch;
    u.volume = volume;
    speech.speak(u);
  }

  function hush() {
    if (speech) speech.cancel();
  }

  return {
    init,
    say,
    hush,
    toggle() {
      muted = !muted;
      if (muted) hush();
      return muted;
    },
    get muted() {
      return muted;
    },
    whoosh(h = 1) {
      if (ok()) noise(0.16 * h, 'bandpass', 500 * h, 2200 * h, 1.4, 0.12);
    },
    hit(power) {
      if (!ok()) return;
      noise(0.1 + power * 0.08, 'lowpass', 3000, 400, 0.7, 0.35 + power * 0.4);
      tone('sine', 150 + power * 50, 40, 0.16 + power * 0.14, 0.4 + power * 0.5);
    },
    block() {
      if (!ok()) return;
      noise(0.07, 'highpass', 2000, 1500, 1, 0.25);
      tone('square', 320, 180, 0.06, 0.06);
    },
    land() {
      if (ok()) noise(0.12, 'lowpass', 500, 120, 0.7, 0.3);
    },
    superCharge() {
      if (!ok()) return;
      tone('sawtooth', 110, 880, 0.55, 0.12);
      noise(0.6, 'bandpass', 300, 3200, 2, 0.22);
    },
    ko() {
      if (!ok()) return;
      tone('sine', 95, 28, 1.3, 0.9);
      noise(1.4, 'lowpass', 1200, 150, 0.5, 0.45);
    },
    bell() {
      if (!ok()) return;
      tone('triangle', 1250, 1230, 0.9, 0.18);
      tone('sine', 2500, 2480, 0.6, 0.06);
    },
    crowd() {
      if (ok()) noise(2.2, 'bandpass', 700, 1100, 0.6, 0.16);
    },
    ui() {
      if (ok()) tone('square', 660, 990, 0.05, 0.05);
    },
  };
})();
