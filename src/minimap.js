import { CFG, TEAM_COLORS } from './config.js';
import { markerKindOf, DEFENDER_MARKER_COLORS } from './markers.js';

// แผนที่ย่อมุมจอ: เหนืออยู่บน (โลก z ติดลบ = ขึ้นบนจอ) ครอบคลุมทั้งเมืองและแนวตั้งทัพ
export const MINIMAP_RANGE = 190;

export function worldToMinimap(x, z, size, range = MINIMAP_RANGE) {
  const k = size / (range * 2);
  return [size / 2 + x * k, size / 2 + z * k];
}

export function minimapToWorld(px, py, size, range = MINIMAP_RANGE) {
  const k = size / (range * 2);
  return [(px - size / 2) / k, (py - size / 2) / k];
}

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const ATTACKER = hex(TEAM_COLORS.attacker);
const COLORS = {
  field: '#3d4a2e', city: '#4a4a3c', stone: '#8a8272', vermilion: '#9b3326', paving: '#b9b2a2',
  captured: ATTACKER, gateClosed: '#6b4a2a', gateOpen: '#e7d28a', selected: '#ffe27a', view: 'rgba(255,255,255,.75)',
};

export class Minimap {
  constructor(canvas, { onPick, tipFor, tipEl }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onPick = onPick;
    this.tipFor = tipFor;
    this.tipEl = tipEl;
    this.dragging = false;
    this.resize();
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.pick(e, false);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.dragging) this.pick(e, true);
      this.hover(e);
    });
    const stop = () => { this.dragging = false; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    canvas.addEventListener('pointerleave', () => this.tipEl?.classList.add('hidden'));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.css = Math.max(40, r.width || 190);
    this.canvas.width = Math.round(this.css * dpr);
    this.canvas.height = Math.round(this.css * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  eventWorld(e) {
    const r = this.canvas.getBoundingClientRect();
    return minimapToWorld(e.clientX - r.left, e.clientY - r.top, r.width);
  }

  pick(e, drag) {
    const [x, z] = this.eventWorld(e);
    this.onPick?.(x, z, drag);
  }

  hover(e) {
    if (!this.tipEl) return;
    const [x, z] = this.eventWorld(e);
    const text = this.tipFor?.(x, z) || '';
    this.tipEl.classList.toggle('hidden', !text);
    this.tipEl.textContent = text;
  }

  square(half, fill, stroke, width) {
    const ctx = this.ctx;
    const [x0, y0] = worldToMinimap(-half, -half, this.css);
    const [x1] = worldToMinimap(half, half, this.css);
    const w = x1 - x0;
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(x0, y0, w, w); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.strokeRect(x0, y0, w, w); }
  }

  // ขอบกำแพงนอกด้าน side ความยาวส่วน frac (ใช้วาดแถบความคืบหน้าการยึด)
  sideLine(side, frac, color, width) {
    const c = CFG.wallHalf + CFG.wallThick / 2;
    const ends = [[[-c, -c], [c, -c]], [[c, -c], [c, c]], [[-c, c], [c, c]], [[-c, -c], [-c, c]]][side];
    const [a, b] = ends.map(([x, z]) => worldToMinimap(x, z, this.css));
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac);
    ctx.stroke();
  }

  draw(battle, viewCorners = null) {
    const ctx = this.ctx;
    const size = this.css;
    const k = size / (MINIMAP_RANGE * 2);
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = COLORS.field;
    ctx.fillRect(0, 0, size, size);

    const R = CFG.rings;
    this.square(R[0].half + R[0].thick, COLORS.city, null);
    // กำแพงนอก 4 ด้าน: สีแดงเมื่อยึดได้ + แถบความคืบหน้าการยึด
    const wallW = Math.max(2, R[0].thick * k);
    for (let side = 0; side < 4; side++) {
      const info = battle.sideInfo(side);
      this.sideLine(side, 1, info.captured ? COLORS.captured : COLORS.stone, wallW);
      if (!info.captured && info.capProgress > 0) this.sideLine(side, info.capProgress, COLORS.captured, wallW * 0.55);
    }
    for (let ring = 1; ring < R.length; ring++) {
      this.square(R[ring].half + R[ring].thick / 2, null, COLORS.vermilion, Math.max(1.5, R[ring].thick * k));
    }
    const P = R[R.length - 1];
    this.square(P.half, COLORS.paving, null);
    // ลานวัง: กรอบค่อย ๆ แดงตามความคืบหน้าการยึด
    if (battle.palace.progress > 0) {
      ctx.globalAlpha = 0.35 + battle.palace.progress * 0.6;
      this.square(P.half - 1, null, ATTACKER, 2);
      ctx.globalAlpha = 1;
    }
    // ประตูแต่ละชั้น (แกนใต้)
    for (let ring = 0; ring < R.length; ring++) {
      const open = ring === 0 ? battle.gate.open : battle.innerGates[ring - 1].open;
      const [gx, gy] = worldToMinimap(0, R[ring].half + R[ring].thick / 2, size);
      ctx.fillStyle = open ? COLORS.gateOpen : COLORS.gateClosed;
      ctx.fillRect(gx - 3, gy - 2, 6, 4);
    }

    // จุดทหาร — ทหารเมืองก่อน แล้วทัพเราทับด้านบน
    const dot = (x, z, color, s = 1.6) => {
      const [px, py] = worldToMinimap(Math.max(-MINIMAP_RANGE, Math.min(MINIMAP_RANGE, x)), Math.max(-MINIMAP_RANGE, Math.min(MINIMAP_RANGE, z)), size);
      ctx.fillStyle = color;
      ctx.fillRect(px - s / 2, py - s / 2, s, s);
    };
    for (const s of battle.defenderUnits()) {
      if (s.alive) dot(s.pos.x, s.pos.z, hex(DEFENDER_MARKER_COLORS[markerKindOf(s)]));
    }
    for (const c of battle.companies) {
      const color = c.selected ? COLORS.selected : ATTACKER;
      for (const s of c.soldiers) if (s.alive) dot(s.pos.x, s.pos.z, color, c.selected ? 2 : 1.6);
    }

    // กรอบมุมกล้อง
    if (viewCorners?.length === 4) {
      ctx.strokeStyle = COLORS.view;
      ctx.lineWidth = 1;
      ctx.beginPath();
      viewCorners.forEach(([x, z], i) => {
        const [px, py] = worldToMinimap(x, z, size);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.stroke();
    }
  }
}
