import * as THREE from 'three';
import { initScene, updateCameraTween } from './scene.js';
import { buildCity, animateCityFlags, openGateDoors } from './city.js';
import { CFG, SIDE_NAMES, genMission } from './config.js';
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
const hudEls = UI.buildHUD();
const clock = new THREE.Clock();

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
  setFocus(new THREE.Vector3(n.x * 128, 62, n.z * 128), new THREE.Vector3(n.x * 40, 10, n.z * 40));
}
function focusWide() {
  setFocus(new THREE.Vector3(0, 82, 165), new THREE.Vector3(0, 8, 0));
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

// ตรวจว่านิ้ว/เมาส์แตะ "ทับตัวกำแพง" บนจอหรือไม่ (ray วิ่งชนวงแหวนกำแพง)
// ถ้าใช่ คืนด้านที่โดน — ใช้แปลงแตะที่กำแพงให้เป็นคำสั่งโจมตีด้านนั้น
function wallTapSide(clientX, clientY) {
  mouseNdc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouseNdc, camera);
  const ro = raycaster.ray.origin, rd = raycaster.ray.direction;
  for (let t = 2; t < 520; t += 1.2) {
    const x = ro.x + rd.x * t, y = ro.y + rd.y * t, z = ro.z + rd.z * t;
    const m = Math.max(Math.abs(x), Math.abs(z));
    if (m > CFG.wallHalf + CFG.wallThick + 0.5) continue; // ยังอยู่นอกเมือง
    if (m < CFG.wallHalf - 1.5) return null;               // ลอดผ่านเหนือกำแพงเข้าไปในเมืองแล้ว
    if (y >= -0.5 && y <= CFG.wallH + 1.5) return sectionOf(new THREE.Vector3(x, 0, z));
  }
  return null;
}

// คำสั่งที่จุดแตะ/คลิก — พร้อมแปลง "แตะที่กำแพง" เป็นโจมตีด้านนั้น
function issueOrderAt(clientX, clientY) {
  const p = groundPoint(clientX, clientY);
  if (!p) return;
  let cls = classifyOrderPoint(p);
  if (cls.type !== 'assault') {
    const side = wallTapSide(clientX, clientY);
    if (side !== null) cls = { type: 'assault', side };
  }
  battle.orderSelected(p, cls);
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
  openGateDoors(city.doorL, city.doorR, 0);
  battle = new Battle(mission, scene, city, onBattleEvent);
  speed = 1;
  setSpeedUI();
  controls.autoRotate = false;
  document.getElementById('intro').classList.add('hidden');
  document.getElementById('end').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  focusWide();
  UI.toast('🎺 กองทัพตั้งรับคำสั่ง — ลากเมาส์ซ้ายเลือกกอง แล้วคลิกขวาสั่งโจมตี');
}

function onBattleEvent(type, data) {
  switch (type) {
    case 'order_assault': UI.toast(`🎺 สั่ง ${data.n} กองโจมตีกำแพงด้าน${SIDE_NAMES[data.side]}!`); sfx.horn(); break;
    case 'order_fail': UI.toast('ไม่มีกองที่รับคำสั่งได้ (กองที่ปีนอยู่สั่งไม่ได้)', 'bad'); break;
    case 'inf_city_hint': UI.toast('🪜 ทหารราบเข้าเมืองทางบันไดใน — ตีกำแพงให้แตก แล้วพวกเขาจะลงไปเปิดประตูเอง'); break;
    case 'cav_wait_gate': UI.toast('🐴 กองม้ารอหน้าประตู — ต้องเปิดประตูก่อนจึงจะพุ่งเข้าเมืองได้'); break;
    case 'cav_enter': UI.toast('🐴 กองม้าพุ่งเข้าเมือง — ไล่ล่าทหารที่เหลือ!', 'blue'); break;
    case 'captured': UI.toast(`🚩 ยึดกำแพงด้าน${SIDE_NAMES[data.side]}! ทหารลงบันไดในไปเปิดประตู`, 'big blue'); sfx.cheer(); break;
    case 'ladder_broken': UI.toast(`🪜 บันไดด้าน${SIDE_NAMES[data.side]}ถูกหินกลิ้งใส่จนหัก!`, 'bad'); break;
    case 'support_march': UI.toast(`🧠 ผู้บัญชาการเมืองส่งพล ${data.n} นายจากด้าน${SIDE_NAMES[data.from]}ไปช่วยด้าน${SIDE_NAMES[data.to]}`); break;
    case 'sortie': UI.toast(`🐎 เมืองเปิดประตูส่งม้าซอง ${data.n} ตัวออกมาฟันนักธนู/รถทุบ! — ส่งหอกไปตัดตอน!`, 'bad'); sfx.hornLow(); break;
    case 'sortie_return': UI.toast('🐎 ม้าซองถอยกลับเข้าเมืองแล้ว'); break;
    case 'ram_ready': UI.toast('⚫ รถทุบเข้าประจำตำแหน่ง — เริ่มกระแทกประตู!'); break;
    case 'ram_lost': UI.toast('⚫ รถทุบถูกหินจากหอประตูทำลาย!', 'bad'); sfx.thud(); break;
    case 'gate_breached': UI.toast('💥 รถทุบกระหน่ำประตูจนแตกกระจาย! กองม้าเข้าได้!', 'big blue'); sfx.cheer(); break;
    case 'gate_opening': UI.toast('🔧 ทหารเรากำลังแงะประตูเมือง...'); break;
    case 'gate_open': UI.toast('🚪 ประตูเมืองเปิดแล้ว! สั่งกองม้าเข้าไล่ล่าได้', 'big blue'); sfx.cheer(); break;
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
  if (e.pointerType !== 'touch') mousePos = { x: e.clientX, y: e.clientY };
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
      // แตะ: บนกำแพง (มีกองที่เลือก) = สั่งโจมตีด้านนั้นทันที
      const wallSide = battle.selection.size > 0 ? wallTapSide(e.clientX, e.clientY) : null;
      if (wallSide !== null) {
        battle.orderSelected(new THREE.Vector3(), { type: 'assault', side: wallSide });
      } else {
        // แตะบนกอง = เลือกเพิ่ม/ถอน · บนพื้น (มีกองที่เลือก) = สั่งทัพ
        const c = pickCompany(e.clientX, e.clientY, 46);
        if (c) {
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
      const c = pickCompany(e.clientX, e.clientY);
      if (c) battle.toggleSelect(c, e.shiftKey);
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

function setSpeedUI() {
  document.querySelectorAll('.hud-speed .spd').forEach((b) => {
    b.classList.toggle('active', +b.dataset.speed === speed);
  });
}
document.querySelectorAll('.hud-speed .spd').forEach((b) => {
  b.onclick = () => { speed = +b.dataset.speed; if (speed > 0) lastSpeed = speed; setSpeedUI(); };
});

window.addEventListener('keydown', (e) => {
  if (!battle) return;
  if (e.key >= '1' && e.key <= '4') focusSide(+e.key - 1);
  else if (e.key === '0') focusWide();
  else if (e.key === 'Escape') battle.clearSelection();
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

  if (battle && speed > 0) battle.update(dt * speed);

  // กลองรบจังหวะสม่ำเสมอ
  if (battle && !battle.ended && speed > 0) {
    drumT -= dt * speed;
    if (drumT <= 0) { drumT = 1.9; sfx.drum(); }
  }

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
  updateCameraTween(camera, controls, dt);
  renderer.render(scene, camera);
  if (shakeMag > 0.02) {
    camera.position.x -= sx; camera.position.y -= sy; camera.position.z -= sz;
  }
});
