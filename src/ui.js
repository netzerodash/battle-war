import { CFG, SIDE_NAMES, GATE_NAMES } from './config.js';
import { ORDER_LABELS, PHASE_LABELS } from './orders.js';
import { sectionOf, distOutOf, gateFrontPoint } from './world.js';

export function unitName(s) {
  const names = { spear: 'พลหอก', shield: 'พลโล่', archer: 'นักธนู', ram: 'พลรถทุบ', cav: 'ทหารม้า' };
  return names[s.company?.ctype] || names[s.utype] || 'ทหาร';
}

export const fmtTime = (t) => {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

const FORMATIONS = { line: 'แนวรบ', column: 'แถวตอน', 'shield-front': 'โล่นำหน้า', loose: 'กระจายตัว' };
const STANCES = { aggressive: 'บุกไล่', hold: 'รักษาแนว', 'avoid-arrows': 'หลบแนวธนู' };

// สถานะประตูแต่ละชั้น: ความแข็งแรง % + ข้อความสั้นสำหรับ tooltip / แผนที่ย่อ
export function gateStatus(battle, ring) {
  if (ring === 0) {
    const g = battle.gate;
    const strength = Math.max(0, Math.round((1 - g.breach) * 100));
    const ramActive = !!battle.ramUnderGate?.();
    const secondsLeft = ramActive ? Math.ceil((1 - g.breach) / CFG.unit.ram.batterRate) : null;
    const text = g.open ? 'เปิดแล้ว — ทุกกองเข้าทางประตูได้'
      : g.breach > 0 ? `ความแข็งแรง ${strength}%${secondsLeft !== null ? ` · อีกราว ${secondsLeft} วิ` : ' · รถทุบหยุดอยู่'}`
        : g.progress > 0 ? `กำลังแงะจากด้านใน ${Math.round(g.progress * 100)}%`
          : 'ปิด · ต้องใช้รถทุบ หรือปีนกำแพงลงไปแงะจากด้านใน';
    return { open: g.open, hit: !g.open && (g.breach > 0 || g.progress > 0), pct: g.breach > 0 ? strength : Math.round((1 - g.progress) * 100), text };
  }
  const g = battle.innerGates[ring - 1];
  const pct = Math.round((g.hp / g.hpMax) * 100);
  const text = g.open ? 'เปิดแล้ว'
    : g.progress > 0 ? `กำลังแงะจากด้านใน ${Math.round(g.progress * 100)}% · ความแข็งแรง ${pct}%`
      : g.started ? `กำลังถูกฟัน · ความแข็งแรง ${pct}%`
        : `ปิด · ความแข็งแรง ${pct}% · ฟันได้ด้วยทหารราบ หรือพาดบันไดข้ามไปแงะ`;
  return { open: g.open, hit: !g.open && (g.started || g.progress > 0), pct, text };
}

// ---------- HUD ----------
export function buildHUD() {
  return {
    time: document.getElementById('hud-time'),
    timer: document.getElementById('hud-timer'),
    gatePips: [...document.querySelectorAll('.gate-pip')].map((root) => ({ root, bar: root.querySelector('.pipbar > div') })),
    palace: document.getElementById('hud-palace'),
    palaceBar: document.querySelector('#hud-palace .pipbar > div'),
    palacePct: document.getElementById('hud-palace-pct'),
    cmdBar: document.getElementById('cmd-bar'),
    selText: document.getElementById('hud-sel-text'),
    tacticalStatus: document.getElementById('hud-tactical-status'),
    holdFire: document.getElementById('btn-hold-fire'),
    captureCountdown: document.getElementById('capture-countdown'),
  };
}

export function updateHUD(els, battle, pendingCaptureSide = null) {
  const gi = battle.globalInfo();
  document.body.dataset.gameTime = battle.time.toFixed(1);
  document.body.dataset.wallViolations = String(battle.metrics.wallViolations);
  document.body.dataset.overlapPairs = String(battle.metrics.overlapPairs);
  document.body.dataset.chokeOverlapPairs = String(battle.metrics.chokeOverlapPairs);
  document.body.dataset.stuckCompanies = String(battle.metrics.stuckCompanies);
  document.body.dataset.maxAttackersPerTarget = String(battle.metrics.maxAttackersPerTarget);

  els.time.textContent = fmtTime(battle.time);
  els.timer.title = `เวลาศึก — เหลือ ${fmtTime(Math.max(0, CFG.timeLimit - battle.time))} จาก ${Math.round(CFG.timeLimit / 60)} นาที`;

  els.gatePips.forEach(({ root, bar }, ring) => {
    const st = gateStatus(battle, ring);
    bar.style.width = `${st.open ? 0 : st.pct}%`;
    root.classList.toggle('open', st.open);
    root.classList.toggle('hit', st.hit);
    root.title = `${GATE_NAMES[ring]} — ${st.text}`;
  });

  const palacePct = Math.round(gi.palace.progress * 100);
  const holding = gi.palace.atk >= CFG.palace.minHolders && gi.palace.atk > gi.palace.def;
  els.palaceBar.style.width = `${palacePct}%`;
  els.palacePct.textContent = `${palacePct}%`;
  els.palace.classList.toggle('contest', gi.palace.atk > 0);
  els.palace.title = [
    `ยึดลานวัง ${palacePct}% — ต้องยืนครบ ${CFG.palace.holdTime} วิ โดยคนเรามากกว่าองครักษ์ในลาน`,
    gi.palace.atk > 0 ? `ในลาน: เรา ${gi.palace.atk} / องครักษ์ ${gi.palace.def}${holding ? ' — กำลังยึด!' : ' — ต้องมีคนมากกว่า'}` : 'ยังไม่มีทหารเราในลานวัง',
    `ฝ่ายเมืองเหลือ ${gi.defendersAlive}/${gi.defendersInitial} · กองสำรองเมืองนอก ${gi.reserves} · องครักษ์ ${gi.garrison}`,
    `ยึดกำแพงนอก ${gi.capturedCount}/4 ด้าน`,
  ].join('\n');

  // แถบคำสั่ง: โผล่เฉพาะตอนมีกองที่เลือก
  const sel = [...battle.selection];
  els.cmdBar.classList.toggle('hidden', sel.length === 0);
  if (sel.length) {
    const selSoldiers = sel.reduce((a, c) => a + c.aliveSoldiers.length, 0);
    const composition = {};
    for (const c of sel) composition[c.ctype] = (composition[c.ctype] || 0) + c.aliveSoldiers.length;
    const compText = Object.entries(composition).map(([type, n]) => `${unitName({ utype: type })} ${n}`).join(' · ');
    const orders = new Set(sel.map((c) => c.order?.kind).filter(Boolean));
    const phases = new Set(sel.map((c) => c.order?.phase).filter(Boolean));
    const orderText = orders.size === 1 ? ORDER_LABELS[[...orders][0]] : orders.size > 1 ? 'หลายคำสั่ง' : 'รอคำสั่ง';
    const phaseText = phases.size === 1 ? PHASE_LABELS[[...phases][0]] : '';
    let hp = 0, hpMax = 0;
    for (const c of sel) for (const s of c.aliveSoldiers) { hp += Math.max(0, s.hp); hpMax += s.hpMax; }
    const healthPct = Math.round((hp / Math.max(1, hpMax)) * 100);
    els.selText.textContent = `${sel.length} กอง · ${selSoldiers} นาย · กำลังรบ ${healthPct}%`;
    els.selText.title = compText;
    const replans = sel.reduce((n, c) => n + (c.order?.replanCount || 0), 0);
    const waiting = sel.map((c) => c.order?.waitingReason).find(Boolean);
    els.tacticalStatus.textContent = `${orderText}${phaseText ? ` / ${phaseText}` : ''} · ${compText}${waiting ? ` · ${waiting}` : replans ? ` · หาเส้นทางใหม่ ${replans} ครั้ง` : ''}`;
    els.tacticalStatus.title = `${FORMATIONS[battle.commandFormation]} · ${STANCES[battle.commandStance]}`;
    els.tacticalStatus.classList.toggle('warn', !!waiting || replans > 0 || battle.metrics.stuckCompanies > 0);
    els.holdFire.classList.toggle('hidden', !sel.some((c) => c.ctype === 'archer'));
  }

  if (pendingCaptureSide !== null && els.captureCountdown) {
    const left = Math.max(0, Math.ceil(8 - (battle.time - battle.captureDecisionAt[pendingCaptureSide])));
    els.captureCountdown.textContent = String(left);
  }
}

// ข้อความเมื่อชี้บนแผนที่ย่อ: สถานะกำแพงนอกด้านนั้น หรือสถานะประตู
export function mapTip(battle, x, z) {
  const m = distOutOf({ x, z });
  for (let ring = 0; ring < CFG.rings.length; ring++) {
    const front = gateFrontPoint(ring);
    if (Math.hypot(x - front.x, z - front.z) < CFG.rings[ring].thick + 5) {
      return `${GATE_NAMES[ring]}: ${gateStatus(battle, ring).text}`;
    }
  }
  if (m >= CFG.wallHalf - 6 && m <= CFG.wallHalf + CFG.wallThick + 8) {
    const side = sectionOf({ x, z });
    const info = battle.sideInfo(side);
    const cap = info.captured ? 'ยึดแล้ว' : `ป้องกัน${info.capProgress > 0 ? ` · กำลังยึด ${Math.round(info.capProgress * 100)}%` : ''}`;
    return `กำแพงด้าน${SIDE_NAMES[side]} — ${cap}\nทหารเมืองบนกำแพง ${info.defendersWall} · หิน ${info.pile}/${info.stock}\nเราบนกำแพง ${info.onWall}${info.descending ? ` · ลงบันได ${info.descending}` : ''}${info.reinforceMen ? ` · เมืองกำลังเสริม ${info.reinforceMen}` : ''}`;
  }
  return '';
}

// ---------- Toast / แบนเนอร์ ----------
// แจ้งเตือนทั่วไปค้างบนจอได้ไม่เกิน 2 อัน · เหตุการณ์ใหญ่ (cls มี 'big') ขึ้นเป็นแบนเนอร์กลางจอแทน
const bannerQueue = [];
let bannerBusy = false;

export function toast(msg, cls = '') {
  if (cls.split(' ').includes('big')) { banner(msg); return; }
  const wrap = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${cls}`;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.classList.add('fade'), 2600);
  setTimeout(() => el.remove(), 3200);
  while (wrap.children.length > 2) wrap.firstChild.remove();
}

export function banner(msg) {
  if (bannerBusy) {
    if (bannerQueue.length < 2) bannerQueue.push(msg);
    return;
  }
  const el = document.getElementById('banner');
  bannerBusy = true;
  el.textContent = msg;
  el.classList.remove('hidden', 'show');
  void el.offsetWidth; // เริ่มแอนิเมชันใหม่
  el.classList.add('show');
  setTimeout(() => {
    el.classList.add('hidden');
    el.classList.remove('show');
    bannerBusy = false;
    if (bannerQueue.length) banner(bannerQueue.shift());
  }, 2600);
}

// ---------- จอจบศึก ----------
export function showEnd(data) {
  const titles = {
    win: ['🏆 ยึดวังต้องห้ามสำเร็จ!', 'ธงทัพเจ้าปักกลางลานวังชั้นในสุด — ราชธานีเป็นของเจ้า'],
    lose_dead: ['💀 ทัพหมดสิ้น...', 'กองร้อยทั้งหมดล้ม — ลองใหม่: เจาะกำแพงนอกให้แตกก่อน แล้วรวมพลฟันประตูชั้นในทีละชั้น'],
    lose_time: ['⌛ หมดเวลา — ถอนทัพ!', `ศึกยืดเยื้อเกิน ${Math.round(CFG.timeLimit / 60)} นาทีโดยยังยึดลานวังไม่ได้ — ฝ่ายเมืองรอกำลังเสริมมาถึง`],
    lose_abort: ['🏳️ ยอมแพ้', 'ถอนทัพกลับแคมป์'],
  };
  const [title, sub] = titles[data.result] || ['จบศึก', ''];
  const s = data.stats;
  const deployed = s.deployedTotal || 1;
  // ดาวจัดเกรดฝีมือผู้บังคับบัญชา
  let stars = '';
  if (data.result === 'win') {
    const r = s.attackersAlive / deployed;
    stars = r >= 0.55 ? '⭐⭐⭐' : r >= 0.38 ? '⭐⭐' : '⭐';
  }
  document.getElementById('end-title').textContent = `${stars} ${title}`;
  document.getElementById('end-sub').textContent = sub;
  const alivePct = Math.round((s.attackersAlive / deployed) * 100);
  const defPct = Math.round((s.defendersTotal / Math.max(1, s.defendersInitial)) * 100);
  document.getElementById('end-stats').innerHTML = `
    เวลาที่ใช้: <b>${fmtTime(data.time)}</b><br>
    กำแพงนอกที่ยึดได้: <b>${data.captured.filter(Boolean).length} / 4</b> ด้าน · ประตูที่ฝ่าได้: <b>${[data.gateOpen, ...(data.innerGatesOpen || [])].filter(Boolean).length} / 3</b> ชั้น<br>
    ยึดลานวัง: <b>${Math.round((data.palaceProgress || 0) * 100)}%</b><br>
    ทหารเราที่เหลือ: <b>${s.attackersAlive}</b> / ${deployed} นาย (${alivePct}%)<br>
    ทหารเมืองที่เหลือ: <b>${s.defendersTotal}</b> / ${s.defendersInitial} นาย (${defPct}%) — ทำลายไป <b>${s.kills}</b><br>
    หินที่ฝ่ายเมืองเหวี่ยงใส่เรา: <b>${s.rocksUsed}</b> ก้อน`;
  document.getElementById('end').classList.remove('hidden');
}
