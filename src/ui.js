import { CFG, SIDE_NAMES, SIDE_CHARS } from './config.js';
import { ORDER_LABELS, PHASE_LABELS } from './orders.js';

export function unitName(s) {
  const names = { spear: 'พลหอก', shield: 'พลโล่', archer: 'นักธนู', ram: 'พลรถทุบ', cav: 'ทหารม้า' };
  return names[s.company?.ctype] || names[s.utype] || 'ทหาร';
}

export const fmtTime = (t) => {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

// ---------- HUD ----------
export function buildHUD() {
  const wrap = document.getElementById('hud-cards');
  wrap.innerHTML = '';
  const sideEls = [0, 1, 2, 3].map((side) => {
    const card = document.createElement('div');
    card.className = 'hud-card';
    card.innerHTML = `
      <h4>${SIDE_CHARS[side]} ${SIDE_NAMES[side]} <span class="st"></span></h4>
      <div class="line l1"></div>
      <div class="line l2"></div>
      <div class="capbar"><div></div></div>`;
    wrap.appendChild(card);
    return {
      root: card,
      st: card.querySelector('.st'),
      l1: card.querySelector('.l1'),
      l2: card.querySelector('.l2'),
      bar: card.querySelector('.capbar > div'),
    };
  });
  return {
    sideEls,
    time: document.getElementById('hud-time'),
    objective: document.getElementById('hud-objective'),
    reserves: document.getElementById('hud-reserves'),
    gateBar: document.querySelector('#hud-gate .capbar > div'),
    gateText: document.getElementById('hud-gate-text'),
    selText: document.getElementById('hud-sel-text'),
    tacticalStatus: document.getElementById('hud-tactical-status'),
  };
}

export function updateHUD(els, battle) {
  const gi = battle.globalInfo();
  document.body.dataset.gameTime = battle.time.toFixed(1);
  document.body.dataset.wallViolations = String(battle.metrics.wallViolations);
  document.body.dataset.overlapPairs = String(battle.metrics.overlapPairs);
  document.body.dataset.chokeOverlapPairs = String(battle.metrics.chokeOverlapPairs);
  document.body.dataset.stuckCompanies = String(battle.metrics.stuckCompanies);
  document.body.dataset.maxAttackersPerTarget = String(battle.metrics.maxAttackersPerTarget);
  els.time.textContent = fmtTime(battle.time);
  const gateHp = Math.max(0, Math.round((1 - battle.gate.breach) * 100));
  const ramActive = !!battle.ramUnderGate();
  const secondsLeft = ramActive ? Math.ceil((1 - battle.gate.breach) / CFG.unit.ram.batterRate) : null;
  const gateText = battle.gate.open
    ? 'เปิดแล้ว!'
    : battle.gate.breach > 0
      ? `ความแข็งแรง ${gateHp}%${secondsLeft !== null ? ` · อีกประมาณ ${secondsLeft} วิ` : ' · รถทุบหยุดอยู่'}`
      : battle.gate.progress > 0
        ? `กำลังเปิดจากด้านใน ${Math.round(battle.gate.progress * 100)}%`
        : 'ความแข็งแรง 100%';
  els.objective.textContent = `ฝ่ายเมืองเหลือ ${gi.defendersAlive}/${gi.defendersInitial} · ยึดกำแพง ${gi.capturedCount}/4`;
  els.reserves.textContent = `กองสำรองเมือง ${gi.reserves} · ประตู: ${gateText}`;
  els.gateBar.style.width = `${battle.gate.open ? 0 : (battle.gate.breach > 0 ? gateHp : Math.round((1 - battle.gate.progress) * 100))}%`;
  els.gateBar.classList.toggle('damaged', battle.gate.breach > 0 && !battle.gate.open);
  els.gateText.textContent = battle.gate.open ? 'เปิดแล้ว — ทหารทุกกองเข้าทางประตูได้' : gateText;

  const sel = [...battle.selection];
  const selSoldiers = sel.reduce((a, c) => a + c.aliveSoldiers.length, 0);
  const touchHint = document.body.classList.contains('touch')
    ? 'แตะกอง = เลือก · แตะกำแพง/ทุ่ง = สั่งทัพ'
    : 'ลากเมาส์ซ้ายครอบกองร้อยเพื่อเลือก (Shift เพิ่มกอง)';
  if (sel.length) {
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
    els.selText.textContent = `${sel.length} กอง · ${selSoldiers} นาย · กำลังรบ ${healthPct}% — ${compText}`;
    const replans = sel.reduce((n, c) => n + (c.order?.replanCount || 0), 0);
    const formations = { line: 'แนวรบ', column: 'แถวตอน', 'shield-front': 'โล่นำหน้า', loose: 'กระจายตัว' };
    const stances = { aggressive: 'บุกไล่', hold: 'รักษาแนว', 'avoid-arrows': 'หลบแนวธนู' };
    const waiting = sel.map((c) => c.order?.waitingReason).find(Boolean);
    els.tacticalStatus.textContent = `${orderText}${phaseText ? ` / ${phaseText}` : ''} · ${formations[battle.commandFormation]} · ${stances[battle.commandStance]}${waiting ? ` · ${waiting}` : replans ? ` · หาเส้นทางใหม่ ${replans} ครั้ง` : ''}`;
    els.tacticalStatus.classList.toggle('warn', !!waiting || replans > 0 || battle.metrics.stuckCompanies > 0);
  } else {
    els.selText.textContent = touchHint;
    els.tacticalStatus.textContent = 'เลือกกองเพื่อดูคำสั่ง เส้นทาง และสถานะ';
    els.tacticalStatus.classList.remove('warn');
  }

  [0, 1, 2, 3].forEach((side) => {
    const info = battle.sideInfo(side);
    const e = els.sideEls[side];
    e.root.classList.toggle('captured', info.captured);
    e.st.textContent = info.captured ? 'ยึดแล้ว' : 'ป้องกัน';
    e.l1.innerHTML = `หอกเมือง <b>${info.defendersWall}</b> · หิน <b>${info.pile}</b>/<small>${info.stock}</small>`;
    e.l2.innerHTML = `เราบนกำแพง <b>${info.onWall}</b>${info.descending ? ` · ลงบันได <b>${info.descending}</b>` : ''}${info.reinforceMen ? ` · เสริมกำลัง <b>${info.reinforceMen}</b> นาย` : ''}`;
    e.bar.style.width = `${Math.round(info.capProgress * 100)}%`;
  });
}

// ---------- Toast ----------
export function toast(msg, cls = '') {
  const wrap = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${cls}`;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.classList.add('fade'), 3200);
  setTimeout(() => el.remove(), 4000);
  while (wrap.children.length > 4) wrap.firstChild.remove();
}

// ---------- จอจบศึก ----------
export function showEnd(data) {
  const titles = {
    win: ['🏆 เมืองแตกแล้ว!', 'ประตูเปิด ทัพเมืองหมดสิ้น — เมืองหลวงเป็นของเจ้า'],
    lose_dead: ['💀 ทัพหมดสิ้น...', 'กองร้อยทั้งหมดล้ม — ลองใหม่: รุมหลายด้านพร้อมกัน แล้วใช้กองม้าเก็บกวาด'],
    lose_time: ['⌛ หมดเวลา — ถอนทัพ!', `ศึกยืดเยื้อเกิน ${Math.round(CFG.timeLimit / 60)} นาที ฝ่ายเมืองรอกำลังเสริมมาถึง`],
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
    กำแพงที่ยึดได้: <b>${data.captured.filter(Boolean).length} / 4</b> ด้าน · ประตูเมือง: <b>${data.gateOpen ? 'เปิดแล้ว' : 'ยังปิด'}</b><br>
    ทหารเราที่เหลือ: <b>${s.attackersAlive}</b> / ${deployed} นาย (${alivePct}%)<br>
    ทหารเมืองที่เหลือ: <b>${s.defendersTotal}</b> / ${s.defendersInitial} นาย (${defPct}%) — ทำลายไป <b>${s.kills}</b><br>
    หินที่ฝ่ายเมืองเหวี่ยงใส่เรา: <b>${s.rocksUsed}</b> ก้อน`;
  document.getElementById('end').classList.remove('hidden');
}
