import * as THREE from 'three';
import { initScene, updateCameraTween } from './scene.js';
import { buildCity, animateCityFlags, openGateDoors } from './city.js';
import { CFG, SIDE_NAMES, GATE_NAMES, WALL_NAMES, genMission } from './config.js';
import { Battle } from './battle.js';
import { SIDE_VECS, classifyOrderPoint, sectionOf } from './world.js';
import * as UI from './ui.js';
import { initAudio, setMuted, isMuted, sfx } from './audio.js';

const { renderer, scene, camera, controls } = initScene(document.getElementById('app'));
const city = buildCity(scene);

// กล้องแบบ RTS: ซ้าย = เลือกทหาร (ไม่หมุน), ขวา = หมุนกล้อง, ล้อเมาส์ = ซูม
controls.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.enablePan = true;
controls.panSpeed = 0.8;
// จอสัมผัส: นิ้วเดียว = หมุนกล้อง, สองนิ้ว = ซูม/แพน
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

const isTouch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
let boxMode = false; // โหมดลากครอบเลือกสำหรับจอสัมผัส
if (isTouch) {
  document.body.classList.add('touch');
  document.getElementById('touchbar').classList.remove('hidden');
}

let mission = genMission();
let battle = null;
let speed = 1;
let lastSpeed = 1;
let hudTimer = 0;
let simAccumulator = 0;
const SIM_STEP = 1 / 30;
let inspectedSoldier = null;
let unitViewSoldier = null;
const unitViewButton = document.getElementById('btn-unit-view');
const hudEls = UI.buildHUD();
const clock = new THREE.Clock();
const formationSelect = document.getElementById('cmd-formation');
const stanceSelect = document.getElementById('cmd-stance');
const captureChoice = document.getElementById('capture-choice');
let pendingCaptureSide = null;

// handle สำหรับดีบัก/ทดสอบ
window.__game = {
  get battle() { return battle; },
  get mission() { return mission; },
  camera,
  controls,
  focusSide,
  focusWide,
  startWithSeed(seed) { mission = genMission(seed); startBattle(false); },
};

const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const mouseNdc = new THREE.Vector2();

// ---------- กล้อง ----------
function setFocus(pos, target) {
  camera.__focusTween = {
    t: 0,
    fromPos: camera.position.clone(),
    toPos: pos.clone(),
    fromTarget: controls.target.clone(),
    toTarget: target.clone(),
  };
}
function focusSide(side) {
  const n = SIDE_VECS[side].n;
  const far = CFG.wallHalf + 88;
  setFocus(new THREE.Vector3(n.x * far, 92, n.z * far), new THREE.Vector3(n.x * CFG.wallHalf, 10, n.z * CFG.wallHalf));
}
function focusWide() {
  setFocus(new THREE.Vector3(0, 130, 250), new THREE.Vector3(0, 8, 0));
}
// มุมลานวังต้องห้าม (เป้าหมายสุดท้าย)
function focusPalace() {
  setFocus(new THREE.Vector3(0, 58, 78), new THREE.Vector3(0, 4, 6));
}

// ---------- แปลงเมาส์/นิ้ว <-> โลก ----------
function groundPoint(clientX, clientY) {
  mouseNdc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouseNdc, camera);
  const p = new THREE.Vector3();
  return raycaster.ray.intersectPlane(groundPlane, p) ? p : null;
}

// ปุ่มกล้อง (ใช้ได้ทั้งเมาส์และนิ้ว)
function rotateCam(deg) {
  camera.__focusTween = null;
  const off = camera.position.clone().sub(controls.target);
  off.applyAxisAngle(new THREE.Vector3(0, 1, 0), (deg * Math.PI) / 180);
  camera.position.copy(controls.target).add(off);
  controls.update();
}
function zoomCam(f) {
  camera.__focusTween = null;
  const dir = camera.position.clone().sub(controls.target);
  const len = THREE.MathUtils.clamp(dir.length() * f, controls.minDistance, controls.maxDistance);
  camera.position.copy(controls.target).add(dir.setLength(len));
  controls.update();
}

// ตรวจว่านิ้ว/เมาส์แตะ "ทับตัวกำแพง" ชั้นไหนบนจอ (ray วิ่งชนเนื้อกำแพงทุกชั้น)
// คืน { ring, side, point } — กำแพงนอก = สั่งตีด้านนั้น, กำแพงชั้นใน = พาดบันไดข้าม
// ช่องประตูไม่นับเป็นกำแพง (แตะที่ประตูชั้นในจึงกลายเป็นคำสั่งเดินไปฟันประตู)
function wallTapAt(clientX, clientY) {
  mouseNdc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouseNdc, camera);
  const ro = raycaster.ray.origin, rd = raycaster.ray.direction;
  for (let t = 2; t < 700; t += 0.8) {
    const x = ro.x + rd.x * t, y = ro.y + rd.y * t, z = ro.z + rd.z * t;
    if (y < -0.5) return null; // ถึงพื้นแล้วโดยไม่ชนกำแพง
    const m = Math.max(Math.abs(x), Math.abs(z));
    for (let ring = 0; ring < CFG.rings.length; ring++) {
      const R = CFG.rings[ring];
      if (m < R.half - 0.5 || m > R.half + R.thick + 0.5 || y > R.h + 1.5) continue;
      if (ring > 0 && z > 0 && Math.abs(x) <= CFG.innerGates.halfWidth + 0.6) continue;
      const point = new THREE.Vector3(x, 0, z);
      return { ring, side: sectionOf(point), point };
    }
  }
  return null;
}

function wallOrder(hit) {
  return hit.ring === 0
    ? { type: 'assault', side: hit.side }
    : { type: 'escalade', ring: hit.ring, side: hit.side };
}

// คำสั่งที่จุดแตะ/คลิก — แตะกำแพงนอก = โจมตีด้านนั้น · แตะกำแพงชั้นใน = พาดบันไดข้าม
function issueOrderAt(clientX, clientY) {
  const p = groundPoint(clientX, clientY);
  if (!p) return;
  let cls = classifyOrderPoint(p);
  let point = p;
  if (cls.type !== 'assault') {
    const hit = wallTapAt(clientX, clientY);
    if (hit) { cls = wallOrder(hit); point = hit.point; }
  }
  battle.orderSelected(point, cls);
}

function companyScreenPos(comp) {
  const v = comp.flagPos.clone().project(camera);
  if (v.z > 1) return null;
  return {
    x: ((v.x + 1) / 2) * window.innerWidth,
    y: ((1 - v.y) / 2) * window.innerHeight,
  };
}

function pickCompany(px, py, radius = 34) {
  let best = null, bestD = radius;
  for (const c of battle.companies) {
    if (c.aliveSoldiers.length === 0) continue;
    const sp = companyScreenPos(c);
    if (!sp) continue;
    const d = Math.hypot(sp.x - px, sp.y - py);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

function pickSoldier(px, py) {
  mouseNdc.set((px / window.innerWidth) * 2 - 1, -(py / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouseNdc, camera);
  const meshes = [];
  if (!battle) return null;
  for (const c of battle.companies) for (const s of c.soldiers) if (s.alive && s.mesh.visible) meshes.push(s.mesh);
  const hit = raycaster.intersectObjects(meshes, false)[0];
  return hit ? hit.object.userData.soldier || null : null;
}

function inspectSoldier(s) {
  inspectedSoldier = s;
  unitViewButton.disabled = !s;
  if (s?.company) battle.toggleSelect(s.company, false);
  if (s) UI.toast(`เลือกทหาร ${UI.unitName(s)} — กด 👁 มุมทหารเพื่อมองผ่านสายตาเขา`);
}

function leaveUnitView() {
  if (!unitViewSoldier) return;
  unitViewSoldier = null;
  controls.enabled = true;
  unitViewButton.classList.remove('active');
  unitViewButton.textContent = '👁 มุมทหาร';
}

function toggleUnitView() {
  if (unitViewSoldier) { leaveUnitView(); return; }
  if (!inspectedSoldier?.alive) return;
  unitViewSoldier = inspectedSoldier;
  controls.enabled = false;
  camera.__focusTween = null;
  unitViewButton.classList.add('active');
  unitViewButton.textContent = '↩ ออกจากมุมทหาร';
}

function pickCompaniesInRect(x0, y0, x1, y1) {
  const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
  const out = [];
  for (const c of battle.companies) {
    if (c.aliveSoldiers.length === 0) continue;
    const sp = companyScreenPos(c);
    if (sp && sp.x >= minX && sp.x <= maxX && sp.y >= minY && sp.y <= maxY) out.push(c);
  }
  return out;
}

// ---------- โฟลว์เกม ----------
function startBattle(rerollMission) {
  if (battle) { scene.remove(battle.group); battle = null; }
  if (rerollMission) mission = genMission();
  city.sides.forEach((s) => s.flagMat.color.set(0xb03030));
  city.palaceFlag.flagMat.color.set(0xb03030);
  for (const g of city.gates) openGateDoors(g.doorL, g.doorR, 0);
  battle = new Battle(mission, scene, city, onBattleEvent);
  // Keep a new battle in sync with the tactical controls the player can already see.
  battle.commandFormation = formationSelect.value;
  battle.commandStance = stanceSelect.value;
  inspectedSoldier = null;
  unitViewSoldier = null;
  unitViewButton.disabled = true;
  speed = 1;
  simAccumulator = 0;
  setSpeedUI();
  controls.autoRotate = false;
  document.getElementById('intro').classList.add('hidden');
  document.getElementById('end').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  captureChoice.classList.add('hidden');
  pendingCaptureSide = null;
  focusWide();
  UI.toast('🎺 เป้าหมาย: ฝ่ากำแพงสามชั้นเข้าไปยึดลานวังต้องห้าม — ลากซ้ายเลือกกอง คลิกขวาสั่งทัพ');
}

function onBattleEvent(type, data) {
  switch (type) {
    case 'order_assault': UI.toast(`🎺 สั่ง ${data.n} กองโจมตีกำแพงด้าน${SIDE_NAMES[data.side]}!`); sfx.horn(); break;
    case 'order_fail': UI.toast('ไม่มีกองที่รับคำสั่งได้ (กองที่ปีนอยู่สั่งไม่ได้)', 'bad'); break;
    case 'order_result': if (data.n < data.total) UI.toast(`รับคำสั่ง ${data.n}/${data.total} กอง — บางกองกำลังปีนหรือใช้เส้นทางนี้ไม่ได้`, 'bad'); break;
    case 'retreat_order': UI.toast(data.n ? `↩ ถอนกำลัง ${data.n} กองกลับแนวตั้งต้น` : 'กองที่กำลังปีน/อยู่บนกำแพงถอยทางนี้ไม่ได้', data.n ? '' : 'bad'); break;
    case 'hold_fire': UI.toast(data.enabled ? `🏹 นักธนู ${data.n} กองพักยิง` : `🏹 นักธนู ${data.n} กองกลับมายิง`, 'blue'); break;
    case 'inf_city_hint': UI.toast('🪜 ทหารราบเข้าเมืองทางบันไดใน — ตีกำแพงให้แตก แล้วพวกเขาจะลงไปเปิดประตูเอง'); break;
    case 'cav_wait_gate': UI.toast(`🐴 กองม้ารอหน้า${GATE_NAMES[data.ring ?? 0]} — พุ่งต่อเองเมื่อประตูเปิด`); break;
    case 'order_escalade': UI.toast(`🪜 ${data.n} กองแบกบันไดไปพาดข้าม${WALL_NAMES[data.ring]}ด้าน${SIDE_NAMES[data.side]}!`); sfx.horn(); break;
    case 'order_escalade_fail': UI.toast(`พาดบันไดข้าม${WALL_NAMES[data.ring]}ไม่ได้ — ต้องเป็นทหารราบที่เข้าถึงลานหน้ากำแพงนั้นแล้ว`, 'bad'); break;
    case 'escalade_start': UI.toast(`🪜 ตั้งบันไดพาด${WALL_NAMES[data.ring]}ด้าน${SIDE_NAMES[data.side]} — ทหารเริ่มไต่ข้าม!`, 'blue'); break;
    case 'inner_gate_attack': UI.toast(`🪓 ทหารเราเริ่มฟัน${GATE_NAMES[data.ring]}!`); break;
    case 'inner_gate_open': UI.toast(`🚪 ${GATE_NAMES[data.ring]}${data.breached ? 'พังแล้ว' : 'ถูกแงะเปิดจากด้านใน'}! กองที่รอหน้าประตูบุกต่อทันที`, 'big blue'); sfx.cheer(); break;
    case 'palace_contest': UI.toast('🏯 ทหารเราบุกถึงลานวังต้องห้าม! ยึดลานให้ครบเวลา — ต้องมีคนมากกว่าองครักษ์', 'big blue'); sfx.horn(); break;
    case 'cav_enter': UI.toast('🐴 กองม้าพุ่งเข้าเมือง — ไล่ล่าทหารที่เหลือ!', 'blue'); break;
    case 'captured':
      UI.toast(`🚩 ยึดกำแพงด้าน${SIDE_NAMES[data.side]}! เลือกภารกิจต่อไป`, 'big blue');
      pendingCaptureSide = data.side;
      document.getElementById('capture-choice-title').textContent = `🚩 ยึดกำแพงด้าน${SIDE_NAMES[data.side]}แล้ว`;
      captureChoice.classList.remove('hidden');
      sfx.cheer();
      break;
    case 'capture_action':
      if (pendingCaptureSide === data.side) { pendingCaptureSide = null; captureChoice.classList.add('hidden'); }
      UI.toast({ hold: '🛡 สั่งรักษากำแพงที่ยึดได้', reinforce: '↔ สั่งเคลื่อนไปช่วยกำแพงด้านข้าง', descend: '⚔ สั่งลงเมืองกวาดล้าง' }[data.action], 'blue');
      break;
    case 'wall_descent_order': UI.toast(`⚔ ${data.n} กอง (${data.men} นาย) ถอนจากแนวกำแพง ลงเมืองไล่ล่าศัตรู!`, 'blue'); break;
    case 'ladder_broken': UI.toast(`🪜 บันไดด้าน${SIDE_NAMES[data.side]}ถูกหินกลิ้งใส่จนหัก!`, 'bad'); break;
    case 'support_march': UI.toast(`🧠 ผู้บัญชาการเมืองส่งพล ${data.n} นายจากด้าน${SIDE_NAMES[data.from]}ไปช่วยด้าน${SIDE_NAMES[data.to]}`); break;
    case 'sortie': UI.toast(`🐎 เมืองเปิดประตูส่งม้าซอง ${data.n} ตัวออกมาฟันนักธนู/รถทุบ! — ส่งหอกไปตัดตอน!`, 'bad'); sfx.hornLow(); break;
    case 'sortie_return': UI.toast('🐎 ม้าซองถอยกลับเข้าเมืองแล้ว'); break;
    case 'ram_ready': UI.toast('⚫ รถทุบเข้าประจำตำแหน่ง — เริ่มกระแทกประตู!'); break;
    case 'archer_ram_takeover': UI.toast(`🏹 นักธนู ${data.n} นายรับช่วงรถทุบที่ถูกทิ้ง — ประตูยังพังต่อได้!`, 'blue'); break;
    case 'archer_rearmed': UI.toast(`⚔ นักธนู ${data.n} นายวางธนู หยิบหอก แล้วเข้ายึดเมืองด้าน${SIDE_NAMES[data.side]}!`, 'big blue'); break;
    case 'ram_lost': UI.toast('⚫ รถทุบถูกหินจากหอประตูทำลาย!', 'bad'); sfx.thud(); break;
    case 'gate_breached': UI.toast('💥 รถทุบกระหน่ำประตูจนแตกกระจาย! กองม้าเข้าได้!', 'big blue'); sfx.cheer(); break;
    case 'gate_opening': UI.toast('🔧 ทหารเรากำลังแงะประตูเมือง...'); break;
    case 'gate_open': UI.toast('🚪 ประตูเมืองชั้นนอกเปิดแล้ว! เทกองเข้าเมือง แล้วฝ่าประตูชั้นในต่อ', 'big blue'); sfx.cheer(); break;
    case 'evacuate': UI.toast(`🏰 ฝ่ายเมืองสละกำแพงด้าน${SIDE_NAMES[data.side]} ลงมารวมพลขั้นสุดท้าย!`); sfx.hornLow(); break;
    case 'end': UI.showEnd(data); if (data.result === 'win') sfx.fanfareWin(); else sfx.fanfareLose(); break;
  }
}

// ---------- อินพุต: เมาส์ + จอสัมผัส ----------
let dragStart = null;
let rightDown = null;
let dragging = false;
let touchStart = null;
const selBox = document.getElementById('selbox');

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') {
    touchStart = { x: e.clientX, y: e.clientY, t: performance.now() };
    // โหมดลากครอบ: ปิดการหมุนกล้องชั่วคราว
    if (boxMode && e.button === 0) {
      dragStart = { x: e.clientX, y: e.clientY, shift: false };
      dragging = false;
      controls.enabled = false;
    }
    return;
  }
  if (e.button === 0) {
    dragStart = { x: e.clientX, y: e.clientY, shift: e.shiftKey };
    dragging = false;
  } else if (e.button === 2) {
    rightDown = { x: e.clientX, y: e.clientY };
  }
});

window.addEventListener('pointermove', (e) => {
  if (dragStart) {
    const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
    if (!dragging && Math.hypot(dx, dy) > 7) dragging = true;
    if (dragging) {
      selBox.style.display = 'block';
      selBox.style.left = `${Math.min(dragStart.x, e.clientX)}px`;
      selBox.style.top = `${Math.min(dragStart.y, e.clientY)}px`;
      selBox.style.width = `${Math.abs(dx)}px`;
      selBox.style.height = `${Math.abs(dy)}px`;
    }
  }
  if (e.pointerType !== 'touch') {
    mousePos = { x: e.clientX, y: e.clientY };
    if (battle && battle.selection.size > 0 && !dragging && !rightDown) {
      const p = groundPoint(e.clientX, e.clientY);
      if (p) battle.setOrderPreview(p, classifyOrderPoint(p));
    }
  }
});

window.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'touch') {
    const moved = touchStart ? Math.hypot(e.clientX - touchStart.x, e.clientY - touchStart.y) : 99;
    const isTap = touchStart && moved < 14 && performance.now() - touchStart.t < 600;
    if (boxMode && dragStart && dragging && battle) {
      // ลากครอบเลือก (เพิ่มเข้ากองที่เลือกแล้ว)
      const picked = pickCompaniesInRect(dragStart.x, dragStart.y, e.clientX, e.clientY);
      for (const c of picked) battle.toggleSelect(c, true);
      if (picked.length) UI.toast(`เลือก ${battle.selection.size} กอง`);
    } else if (isTap && battle && !battle.ended) {
      // แตะ: บนกำแพง (มีกองที่เลือก) = สั่งตีกำแพงนอก / พาดบันไดข้ามกำแพงชั้นในทันที
      const wallHit = battle.selection.size > 0 ? wallTapAt(e.clientX, e.clientY) : null;
      if (wallHit) {
        battle.orderSelected(wallHit.point, wallOrder(wallHit));
      } else {
        // แตะบนกอง = เลือกเพิ่ม/ถอน · บนพื้น (มีกองที่เลือก) = สั่งทัพ
        const soldier = pickSoldier(e.clientX, e.clientY);
        const c = soldier?.company || pickCompany(e.clientX, e.clientY, 46);
        if (soldier) {
          inspectSoldier(soldier);
        } else if (c) {
          battle.toggleSelect(c, true);
        } else if (battle.selection.size > 0) {
          issueOrderAt(e.clientX, e.clientY);
        }
      }
    }
    if (boxMode) controls.enabled = true;
    dragStart = null; dragging = false;
    selBox.style.display = 'none';
    touchStart = null;
    return;
  }
  // เมาส์
  if (e.button === 0 && dragStart) {
    if (dragging) {
      if (battle) {
        const picked = pickCompaniesInRect(dragStart.x, dragStart.y, e.clientX, e.clientY);
        if (!dragStart.shift) battle.clearSelection();
        for (const c of picked) battle.toggleSelect(c, true);
        if (picked.length) UI.toast(`เลือก ${battle.selection.size} กอง`);
      }
    } else if (battle) {
      const soldier = pickSoldier(e.clientX, e.clientY);
      const c = soldier?.company || pickCompany(e.clientX, e.clientY);
      if (soldier) inspectSoldier(soldier);
      else if (c) battle.toggleSelect(c, e.shiftKey);
      else if (!e.shiftKey) battle.clearSelection();
    }
    selBox.style.display = 'none';
    dragStart = null;
    dragging = false;
  }
});

renderer.domElement.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (!rightDown) return; // ลากขวา = หมุนกล้อง (ไม่ใช่คำสั่ง)
  if (!battle || battle.ended) return;
  const moved = Math.hypot(e.clientX - rightDown.x, e.clientY - rightDown.y);
  rightDown = null;
  if (moved > 6 || battle.selection.size === 0) return; // ลาก = หมุนกล้อง
  issueOrderAt(e.clientX, e.clientY);
});

renderer.domElement.addEventListener('dblclick', (e) => {
  if (!battle || battle.ended || e.button !== 0) return;
  const c = pickCompany(e.clientX, e.clientY);
  if (!c) return;
  const n = battle.selectNearbySameType(c);
  UI.toast(`เลือก ${n} กองชนิดเดียวกันที่อยู่ใกล้เคียง`);
});

// ชี้กองไหน — โชว์ในแถบล่าง (เมาส์เท่านั้น)
let mousePos = { x: -1, y: -1 };

// ---------- ปุ่มควบคุม ----------
document.getElementById('btn-intro-start').onclick = () => { initAudio(); startBattle(false); };
document.getElementById('btn-abort').onclick = () => { if (battle && !battle.ended) battle.end('lose_abort'); };
document.getElementById('btn-end-retry').onclick = () => { initAudio(); startBattle(false); };
document.getElementById('btn-end-newmission').onclick = () => { initAudio(); startBattle(true); };

// ปุ่มเสียง
document.getElementById('btn-sound').onclick = () => {
  setMuted(!isMuted());
  document.getElementById('btn-sound').textContent = isMuted() ? '🔇' : '🔊';
};
unitViewButton.onclick = toggleUnitView;
formationSelect.onchange = () => { if (battle) battle.commandFormation = formationSelect.value; };
stanceSelect.onchange = () => { if (battle) battle.commandStance = stanceSelect.value; };
document.getElementById('btn-retreat').onclick = () => battle?.retreatSelected();
document.getElementById('btn-hold-fire').onclick = () => {
  if (battle?.toggleHoldFireSelected() === null) UI.toast('เลือกกองธนูก่อนใช้คำสั่งพักยิง', 'bad');
};
document.getElementById('btn-focus-combat').onclick = () => {
  const p = battle?.lastCombatPos;
  if (!p) { UI.toast('ยังไม่มีจุดปะทะ', 'bad'); return; }
  setFocus(p.clone().add(new THREE.Vector3(28, 30, 34)), p.clone().setY(p.y + 2));
};
document.querySelectorAll('[data-capture-action]').forEach((button) => {
  button.onclick = () => {
    if (battle && pendingCaptureSide !== null) battle.chooseCaptureAction(pendingCaptureSide, button.dataset.captureAction);
  };
});

function setSpeedUI() {
  document.querySelectorAll('.hud-speed .spd[data-speed]').forEach((b) => {
    b.classList.toggle('active', +b.dataset.speed === speed);
  });
}
document.querySelectorAll('.hud-speed .spd[data-speed]').forEach((b) => {
  b.onclick = () => { speed = +b.dataset.speed; if (speed > 0) lastSpeed = speed; setSpeedUI(); };
});

window.addEventListener('keydown', (e) => {
  if (!battle) return;
  if (e.key >= '1' && e.key <= '4') focusSide(+e.key - 1);
  else if (e.key === '5') focusPalace();
  else if (e.key === '0') focusWide();
  else if (e.key === 'Escape') {
    if (unitViewSoldier) leaveUnitView();
    else battle.clearSelection();
  }
  else if (e.key === ' ') {
    e.preventDefault();
    if (speed > 0) { lastSpeed = speed; speed = 0; } else speed = lastSpeed || 1;
    setSpeedUI();
  }
});

// ---------- ปุ่มควบคุมจอสัมผัส + แตะการ์ดด้าน = มุมกล้อง ----------
hudEls.sideEls.forEach((el, i) => {
  el.root.addEventListener('click', () => focusSide(i));
  el.root.title = 'แตะเพื่อส่งกล้องไปด้านนี้';
});
if (isTouch) {
  const $ = (id) => document.getElementById(id);
  $('tb-box').onclick = () => {
    boxMode = !boxMode;
    $('tb-box').classList.toggle('active', boxMode);
    UI.toast(boxMode ? '🔲 โหมดลากครอบเลือก: ลากนิ้วครอบกอง' : 'ปิดโหมดลากครอบ — ลากนิ้วเดียว = หมุนกล้อง');
  };
  $('tb-clear').onclick = () => battle && battle.clearSelection();
  $('tb-rl').onclick = () => rotateCam(-30);
  $('tb-rr').onclick = () => rotateCam(30);
  $('tb-zi').onclick = () => zoomCam(0.78);
  $('tb-zo').onclick = () => zoomCam(1.28);
  $('tb-wide').onclick = () => focusWide();
}

// ---------- ลูปหลัก ----------
let drumT = 1.5;
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());

  if (battle && speed > 0) {
    simAccumulator += dt * speed;
    // fixed timestep ทำให้ผล simulation คงที่แม้ refresh rate ต่างกัน
    let steps = 0;
    while (simAccumulator >= SIM_STEP && steps < 8) {
      battle.update(SIM_STEP);
      simAccumulator -= SIM_STEP;
      steps++;
    }
  }

  if (unitViewSoldier) {
    if (!unitViewSoldier.alive) {
      leaveUnitView();
      UI.toast('ทหารที่ติดตามล้มแล้ว — กลับสู่กล้องแม่ทัพ', 'bad');
    } else {
      const s = unitViewSoldier;
      const forward = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw));
      camera.position.copy(s.pos).addScaledVector(forward, 0.22).setY(s.pos.y + (s.kind === 'cav' ? 2.45 : 1.45));
      camera.lookAt(s.pos.x + forward.x * 14, camera.position.y - 0.05, s.pos.z + forward.z * 14);
    }
  }

  // กลองรบจังหวะสม่ำเสมอ
  if (battle && !battle.ended && speed > 0) {
    drumT -= dt * speed;
    if (drumT <= 0) { drumT = 1.9; sfx.drum(); }
  }

  // วงสีใต้เท้า + ป้ายจำนวนทหารเมือง (มุมทหาร = ปิดป้าย เพราะกล้องไม่ได้อิงจุดหมุนแล้ว)
  if (battle) battle.updateOverlays(dt, unitViewSoldier ? 0 : camera.position.distanceTo(controls.target), camera);

  // จอสั่น (offset ชั่วคราวรอบการเรนเดอร์)
  const shakeMag = battle ? battle.shake * 0.4 : 0;
  let sx = 0, sy = 0, sz = 0;
  if (shakeMag > 0.02) {
    sx = (Math.random() - 0.5) * shakeMag;
    sy = (Math.random() - 0.5) * shakeMag * 0.6;
    sz = (Math.random() - 0.5) * shakeMag;
    camera.position.x += sx; camera.position.y += sy; camera.position.z += sz;
  }

  if (battle) {
    hudTimer += dt;
    if (hudTimer > 0.15) {
      hudTimer = 0;
      UI.updateHUD(hudEls, battle);
      const hoverC = pickCompany(mousePos.x, mousePos.y, 26);
      battle.setHover(hoverC);
    }
  }

  animateCityFlags(city.sides, dt);
  if (!unitViewSoldier) updateCameraTween(camera, controls, dt);
  const hiddenFollowMesh = unitViewSoldier?.mesh;
  if (hiddenFollowMesh) hiddenFollowMesh.visible = false;
  renderer.render(scene, camera);
  if (hiddenFollowMesh) hiddenFollowMesh.visible = true;
  if (shakeMag > 0.02) {
    camera.position.x -= sx; camera.position.y -= sy; camera.position.z -= sz;
  }
});
