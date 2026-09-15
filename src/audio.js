// เสียงสังเคราะห์ล้วน ๆ ด้วย WebAudio — ไม่ต้องมีไฟล์เสียง
let ctx = null, master = null;
let muted = false;
const last = {}; // throttle ต่อชนิดเสียง

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function initAudio() { ensure(); }
export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.5; }
export function isMuted() { return muted; }

function throttle(key, ms) {
  const now = performance.now();
  if (last[key] && now - last[key] < ms) return false;
  last[key] = now;
  return true;
}

function env(g, t0, a, d, peak) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
}

function tone(freq, type, a, d, peak, slideTo, delay = 0) {
  const c = ensure();
  if (!c || muted) return;
  const t0 = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + a + d);
  env(g, t0, a, d, peak);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + a + d + 0.05);
}

function noise(d, peak, filterFreq, type = 'lowpass', delay = 0) {
  const c = ensure();
  if (!c || muted) return;
  const t0 = c.currentTime + delay;
  const len = Math.max(1, Math.floor(c.sampleRate * d));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = filterFreq;
  const g = c.createGain();
  env(g, t0, 0.01, d, peak);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t0);
}

export const sfx = {
  // แตรสั่งทัพ
  horn() {
    if (!throttle('horn', 250)) return;
    tone(196, 'sawtooth', 0.06, 0.45, 0.2, 165);
    tone(294, 'sawtooth', 0.06, 0.45, 0.13);
  },
  hornLow() {
    if (!throttle('hornLow', 400)) return;
    tone(147, 'sawtooth', 0.09, 0.5, 0.2, 110);
  },
  // เสียงดาบปะทะ (throttle แน่น ๆ กันเสียงรก)
  clash() {
    if (!throttle('clash', 95)) return;
    tone(700 + Math.random() * 700, 'square', 0.004, 0.05, 0.035, 280);
    noise(0.04, 0.03, 3200, 'highpass');
  },
  // ฝักธนู
  whoosh() {
    if (!throttle('whoosh', 160)) return;
    noise(0.16, 0.04, 1100, 'bandpass');
  },
  // หินกระแทก
  thud() {
    if (!throttle('thud', 110)) return;
    noise(0.14, 0.18, 320);
    tone(72, 'sine', 0.004, 0.16, 0.26, 44);
  },
  // ไม้/บันไดหัก
  crack() {
    if (!throttle('crack', 180)) return;
    noise(0.24, 0.26, 850);
    tone(115, 'square', 0.004, 0.14, 0.16, 55);
  },
  // กลองรบ (จังหวะระหว่างศึก) — เร่งความเข้มตามช่วงศึก: เมืองนอก → เมืองชั้นใน → ลานวัง
  // (ตัวช่วงเวลาระหว่างจังหวะอยู่ที่ main.js — ฟังก์ชันนี้ปรับแค่เสียงต่อจังหวะ ไม่ปรับจังหวะเอง)
  drum(intensity = 'outer') {
    if (intensity === 'palace') {
      tone(52, 'sawtooth', 0.004, 0.2, 0.28, 32);
      tone(78, 'sine', 0.004, 0.15, 0.14, 55);
      noise(0.08, 0.08, 650);
    } else if (intensity === 'inner') {
      tone(55, 'sine', 0.004, 0.15, 0.25, 36);
      noise(0.06, 0.06, 550);
    } else {
      tone(58, 'sine', 0.004, 0.13, 0.22, 40);
      noise(0.05, 0.05, 500);
    }
  },
  // เชียร์เมื่อยึดได้
  cheer() {
    if (!throttle('cheer', 500)) return;
    noise(0.5, 0.12, 1500, 'bandpass');
    tone(392, 'square', 0.02, 0.18, 0.1);
    tone(523, 'square', 0.02, 0.2, 0.1, undefined, 0.12);
    tone(659, 'square', 0.02, 0.3, 0.12, undefined, 0.24);
  },
  fanfareWin() {
    const n = [392, 523, 659, 784, 659, 784];
    n.forEach((f, i) => tone(f, 'square', 0.02, 0.32, 0.14, undefined, i * 0.16));
    tone(196, 'sawtooth', 0.05, 1.2, 0.12);
  },
  fanfareLose() {
    const n = [330, 294, 262, 196];
    n.forEach((f, i) => tone(f, 'sawtooth', 0.04, 0.4, 0.13, undefined, i * 0.28));
  },
};
