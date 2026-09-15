import * as THREE from 'three';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';
import { CFG, TEAM_COLORS } from './config.js';
import { SIDE_VECS, stairPoints, gateHalfWidth } from './world.js';

const C = {
  stone: 0x928a7a, stoneDark: 0x77705f, stoneLight: 0xa89f8c, walk: 0xaaa08a,
  roof: 0x2e6e68, roofDark: 0x24524d,
  wood: 0x6b4a2a, woodDark: 0x4a3420,
  red: 0x8f2f2f, redDark: 0x5a2b22,
  gold: 0xd9a441,
  tree: 0x3f5d3a, treeTrunk: 0x5a4026,
  banner: TEAM_COLORS.city, // ธงฝ่ายเมือง
  stair: 0x5f4326,
  // โทนวังต้องห้าม: กำแพงชาด หลังคากระเบื้องเคลือบเหลือง ฐานหินอ่อน
  vermilion: 0x9b3326, vermilionDark: 0x74241a,
  tile: 0xd9a441, tileDark: 0xb07f2c,
  marble: 0xe6e1d3, marbleDark: 0xc9c3b3,
  paving: 0xb9b2a2, imperialWay: 0xd2cab6,
};

function colorize(geom, hex) {
  const c = new THREE.Color(hex);
  const n = geom.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geom.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geom;
}

// รวมชิ้นส่วนสีเดียวกันเป็น mesh เดียวเพื่อลด draw call
export function buildCity(scene) {
  const buckets = new Map();
  const push = (hex, geom) => {
    if (!buckets.has(hex)) buckets.set(hex, []);
    buckets.get(hex).push(geom);
  };
  const bx = (hex, w, h, d, x, y, z, ry = 0) => push(hex, new THREE.BoxGeometry(w, h, d).rotateY(ry).translate(x, y, z));
  const cy = (hex, rt, rb, h, seg, x, y, z) => push(hex, new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y, z));
  const cn = (hex, r, h, seg, x, y, z, ry = 0) => push(hex, new THREE.ConeGeometry(r, h, seg).rotateY(ry).translate(x, y, z));
  // หลังคาปั้นหยาแบบจีน: ฐานกว้าง w ลึก d สูง h วางฐานที่ระดับ y
  const roof = (hex, w, d, h, x, y, z) => push(hex, new THREE.ConeGeometry(Math.SQRT1_2, 1, 4)
    .rotateY(Math.PI / 4).scale(w, h, d).translate(x, y + h / 2, z));

  // กล่องตามแนวกำแพง: len ตามแนวขนานกำแพง, thick ตามแนวฉาก
  const wbox = (hex, s, off, dist, len, h, thick, y) => {
    const { n, t } = SIDE_VECS[s];
    const alongX = Math.abs(t.x) > 0.5;
    push(hex, new THREE.BoxGeometry(alongX ? len : thick, h, alongX ? thick : len)
      .translate(t.x * off + n.x * dist, y, t.z * off + n.z * dist));
  };
  // วางชิ้นกำแพงหนึ่งด้าน — ด้านใต้เว้นช่องประตูจริงในเนื้อกำแพง
  const wallRun = (s, span, gap, fn) => {
    if (s !== 2 || gap <= 0) { fn(0, span); return; }
    const seg = (span - gap) / 2;
    for (const sign of [-1, 1]) fn(sign * (gap / 2 + seg / 2), seg);
  };

  // ================= กำแพงเมืองชั้นนอก (หินเทา ใบเสมา ป้อมมุม) =================
  const W = CFG.wallHalf, T = CFG.wallThick, H = CFG.wallH;
  const mid = W + T / 2;
  const outer = W + T;
  const span = 2 * mid;
  for (let s = 0; s < 4; s++) {
    wallRun(s, span, 11, (off, len) => {
      wbox(C.stone, s, off, mid, len, H, T, H / 2);
      wbox(C.stoneDark, s, off, mid, len + (s === 2 ? 1 : 2), 2.2, T + 1.6, 1.1);
    });
    wbox(C.redDark, s, 0, mid, span + 0.4, 0.8, T + 0.3, H * 0.62);
    wbox(C.walk, s, 0, mid, span, 0.3, T - 0.5, H + 0.15);
    for (let k = -7; k <= 7; k++) {
      if (s === 2 && k === 0) continue;
      wbox(C.stoneDark, s, k * 8, outer + 0.5, 1.6, H * 0.72, 1.2, H * 0.36);
    }
    for (let k = -20; k <= 20; k++) {
      const off = k * 3.4;
      if (Math.abs(off) > mid - 4) continue;
      wbox(C.stoneLight, s, off, outer - 0.45, 1.9, 1.5, 0.9, H + 0.75);
    }
    // ใบกำแพงด้านใน — เว้นช่องตรงชานพักบันไดขึ้นกำแพง
    {
      const st = stairPoints(s);
      const gapA = SIDE_VECS[s].t.dot(st.top) - 0.5, gapB = SIDE_VECS[s].t.dot(st.landing) + 3;
      wbox(C.stoneDark, s, (-span / 2 + gapA) / 2, W - 0.3, gapA + span / 2, 1.0, 0.6, H + 0.5);
      wbox(C.stoneDark, s, (gapB + span / 2) / 2, W - 0.3, span / 2 - gapB, 1.0, 0.6, H + 0.5);
    }
    const { n, t } = SIDE_VECS[s];
    for (let k = -4; k <= 4; k++) {
      if (k === 0) continue;
      const off = k * 14;
      const px = t.x * off + n.x * (W - 0.7), pz = t.z * off + n.z * (W - 0.7);
      push(C.woodDark, new THREE.CylinderGeometry(0.05, 0.05, 5, 5).translate(px, H + 2.5, pz));
      const flag = new THREE.BoxGeometry(1.25, 0.7, 0.03);
      flag.rotateY(Math.atan2(n.x, n.z));
      flag.translate(px + n.x * 0.65, H + 4.4, pz + n.z * 0.65);
      push(C.banner, flag);
    }
  }

  // ป้อมมุม 4 หลัง (สไตล์จีน 2 ชั้น)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * mid, z = sz * mid;
    cy(C.stone, 6.4, 7.0, 3.2, 8, x, 1.6, z);
    cy(C.stone, 5.4, 6.2, H, 8, x, H / 2 + 2, z);
    cy(C.walk, 6.6, 6.6, 0.5, 8, x, H + 2.2, z);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      push(C.stoneLight, new THREE.BoxGeometry(1.6, 1.3, 0.8)
        .rotateY(-a).translate(x + Math.cos(a) * 6.1, H + 2.9, z + Math.sin(a) * 6.1));
    }
    for (const [dx, dz] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]]) cy(C.woodDark, 0.28, 0.32, 3.6, 6, x + dx, H + 4.2, z + dz);
    bx(C.red, 6.6, 0.6, 6.6, x, H + 2.6, z);
    bx(C.red, 6.0, 2.6, 6.0, x, H + 4.4, z);
    cn(C.roof, 5.6, 2.4, 4, x, H + 6.9, z, Math.PI / 4);
    bx(C.red, 4.0, 1.9, 4.0, x, H + 7.4, z);
    cn(C.roofDark, 3.6, 2.0, 4, x, H + 9.3, z, Math.PI / 4);
    cn(C.gold, 0.5, 1.1, 4, x, H + 10.8, z, Math.PI / 4);
    cy(C.woodDark, 0.08, 0.08, 4.4, 5, x + 2.2, H + 8.4, z + 2.2);
    bx(C.banner, 1.6, 0.9, 0.03, x + 3.0, H + 10.2, z + 2.2);
  }

  // ซุ้มประตูเมืองชั้นนอก 3 ชั้น
  cy(C.red, 1.3, 1.4, 11, 8, -6.2, 5.2, outer + 0.6);
  cy(C.red, 1.3, 1.4, 11, 8, 6.2, 5.2, outer + 0.6);
  bx(C.woodDark, 15.4, 2.4, 2.6, 0, 11.8, outer + 0.6);
  bx(C.redDark, 1.0, 10.0, 1.4, -5.55, 5.0, outer + 0.65);
  bx(C.redDark, 1.0, 10.0, 1.4, 5.55, 5.0, outer + 0.65);
  bx(C.gold, 12.1, 0.55, 1.45, 0, 9.65, outer + 0.68);
  bx(C.red, 15, 4.2, 6.4, 0, 14.4, mid + 0.6);
  bx(C.stone, 15.6, 0.5, 7, 0, 16.7, mid + 0.6);
  cn(C.roof, 11, 3.2, 4, 0, 18.6, mid + 0.6, Math.PI / 4);
  bx(C.red, 9.5, 2.8, 5, 0, 19.9, mid + 0.6);
  cn(C.roofDark, 7.2, 2.6, 4, 0, 22.6, mid + 0.6, Math.PI / 4);
  bx(C.red, 5.5, 2.0, 3.6, 0, 23.9, mid + 0.6);
  cn(C.roof, 4.4, 2.2, 4, 0, 26, mid + 0.6, Math.PI / 4);
  cn(C.gold, 0.6, 1.3, 4, 0, 27.7, mid + 0.6, Math.PI / 4);

  // บันไดภายในประจำด้านของกำแพงนอก (ลงจากกำแพง / กองสำรองขึ้นเสริม)
  for (let s = 0; s < 4; s++) {
    const sp = stairPoints(s);
    const dir = sp.top.clone().sub(sp.base);
    const horizontal = dir.clone().setY(0);
    const run = horizontal.length();
    const len = dir.length();
    const midP = sp.base.clone().addScaledVector(dir, 0.5);
    const lateral = new THREE.Vector3(horizontal.z, 0, -horizontal.x).normalize();
    const angle = Math.atan2(dir.y, run);
    const yaw = Math.atan2(horizontal.x, horizontal.z);
    const stepCount = 22;
    const stepDepth = run / stepCount + 0.12;
    const treadThickness = 0.32;
    const risePerStep = CFG.walkY / stepCount;
    for (let i = 0; i < stepCount; i++) {
      const f = (i + 0.5) / stepCount;
      const height = CFG.walkY * ((i + 1) / stepCount);
      const p = sp.base.clone().addScaledVector(horizontal, f);
      push(i % 2 ? C.stair : C.woodDark, new THREE.BoxGeometry(4.0, treadThickness, stepDepth).rotateY(yaw).translate(p.x, height - treadThickness / 2, p.z));
      push(C.woodDark, new THREE.BoxGeometry(4.0, risePerStep, 0.16).rotateY(yaw).translate(p.x, height - risePerStep / 2, p.z));
    }
    // ชานพักหัวบันได: สะพานสั้นจากหัวบันไดข้ามช่องใบกำแพงด้านใน ต่อเสมอพื้นทางเดินบนกำแพง
    {
      const tTop = SIDE_VECS[s].t.dot(sp.top), tLand = SIDE_VECS[s].t.dot(sp.landing);
      const from = tTop - 0.3, to = tLand + 2.5;
      const nIn = W - 4.1, nOut = W + 0.25;
      wbox(C.stair, s, (from + to) / 2, (nIn + nOut) / 2, to - from, 0.5, nOut - nIn, CFG.walkY - 0.25);
      wbox(C.stoneDark, s, tLand + 1.3, W - 3.2, 1.4, CFG.walkY - 0.5, 1.4, (CFG.walkY - 0.5) / 2);
    }
    for (const side2 of [-1.7, 1.7]) {
      const rp = midP.clone().addScaledVector(lateral, side2);
      push(C.woodDark, new THREE.BoxGeometry(0.24, 0.32, len + 0.8).rotateX(-angle).rotateY(yaw).translate(rp.x, rp.y + 1.0, rp.z));
      push(C.woodDark, new THREE.BoxGeometry(0.3, 0.4, len + 0.4).rotateX(-angle).rotateY(yaw).translate(rp.x, rp.y - 0.35, rp.z));
    }
    for (const f of [0.08, 0.3, 0.52, 0.74, 0.96]) {
      const pp = sp.base.clone().addScaledVector(dir, f);
      for (const side2 of [-1.7, 1.7]) {
        const post = pp.clone().addScaledVector(lateral, side2);
        push(C.woodDark, new THREE.BoxGeometry(0.28, 2.0, 0.28).translate(post.x, pp.y + 0.8, post.z));
      }
    }
  }

  // ================= กำแพงชั้นใน + กำแพงวังต้องห้าม (กำแพงชาด หลังคาเหลือง) =================
  const innerRing = (ring) => {
    const R = CFG.rings[ring];
    const rMid = R.half + R.thick / 2, rOuter = R.half + R.thick, rSpan = 2 * rMid;
    const gap = gateHalfWidth(ring) * 2 + 1.2;
    const lintelY = R.h * 0.72;
    const palace = ring === CFG.rings.length - 1;
    for (let s = 0; s < 4; s++) {
      wallRun(s, rSpan, gap, (off, len) => {
        wbox(C.vermilion, s, off, rMid, len, R.h, R.thick, R.h / 2);
        wbox(C.marbleDark, s, off, rMid, len + 0.6, 1.0, R.thick + 1.0, 0.5);
      });
      // ทับหลังเหนือช่องประตู
      if (s === 2) wbox(C.vermilion, s, 0, rMid, gap + 0.4, R.h - lintelY, R.thick, lintelY + (R.h - lintelY) / 2);
      // หลังคากระเบื้องเคลือบเหลืองคลุมสันกำแพง + ขอบกันตก
      wbox(C.tile, s, 0, rMid, rSpan + R.thick, 0.45, R.thick + 0.9, R.h + 0.22);
      wbox(C.vermilionDark, s, 0, R.half + 0.25, rSpan, 0.6, 0.35, R.h + 0.75);
      if (palace) {
        for (let k = -20; k <= 20; k++) {
          const off = k * 2.1;
          if (Math.abs(off) > rMid - 2 || (s === 2 && Math.abs(off) < gap / 2 + 3)) continue;
          wbox(C.vermilion, s, off, rOuter - 0.3, 1.0, 0.9, 0.45, R.h + 0.9);
        }
      } else {
        wbox(C.vermilionDark, s, 0, rOuter - 0.25, rSpan, 0.6, 0.35, R.h + 0.75);
      }
    }
    // ป้อมมุม: วังมีหอมุมหลังคาซ้อนสองชั้น
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * rMid, z = sz * rMid;
      const bodyH = R.h + 0.8;
      bx(C.vermilion, R.thick + 1.6, bodyH, R.thick + 1.6, x, bodyH / 2, z);
      roof(C.tile, R.thick + 3.2, R.thick + 3.2, 1.3, x, bodyH, z);
      if (palace) {
        bx(C.red, 3.4, 1.8, 3.4, x, bodyH + 1.8, z);
        roof(C.tile, 5.2, 5.2, 1.6, x, bodyH + 2.6, z);
        cn(C.gold, 0.35, 0.8, 4, x, bodyH + 4.6, z, Math.PI / 4);
      }
    }
    // ซุ้มประตูบนสันกำแพง (หน้าใต้)
    // ซุ้มประตูบนสันกำแพง — กว้างกว่าช่องประตูเล็กน้อย ไม่ให้หลังคาบังลานทั้งด้าน
    const baseY = R.h + 0.45;
    const towerW = gap + 2;
    const hallH = 2.0;
    bx(C.marble, towerW + 0.8, 0.4, R.thick + 0.4, 0, baseY + 0.2, rMid);
    for (const x of [-towerW / 2 + 0.4, -gap / 4, gap / 4, towerW / 2 - 0.4]) cy(C.red, 0.2, 0.24, hallH, 6, x, baseY + 0.4 + hallH / 2, rOuter - 0.6);
    bx(C.red, towerW - 0.8, hallH, R.thick - 1.6, 0, baseY + 0.4 + hallH / 2, rMid - 0.2);
    roof(C.tile, towerW + 1.8, R.thick + 1.2, 1.4, 0, baseY + 0.4 + hallH, rMid);
    let topY = baseY + 0.4 + hallH + 1.4;
    if (palace) {
      bx(C.red, towerW - 3, 1.1, R.thick - 2.2, 0, topY - 0.3 + 0.55, rMid);
      roof(C.tile, towerW - 1, R.thick, 1.1, 0, topY + 0.8, rMid);
      topY += 1.9;
    }
    cn(C.gold, 0.3, 0.6, 4, 0, topY + 0.3, rMid, Math.PI / 4);
    // เสาหน้าช่องประตู ขอบทอง
    bx(C.vermilionDark, 0.7, lintelY, 0.9, -gap / 2 - 0.1, lintelY / 2, rOuter + 0.35);
    bx(C.vermilionDark, 0.7, lintelY, 0.9, gap / 2 + 0.1, lintelY / 2, rOuter + 0.35);
    bx(C.gold, gap + 0.8, 0.4, 0.95, 0, lintelY + 0.15, rOuter + 0.4);
  };
  for (let ring = 1; ring < CFG.rings.length; ring++) innerRing(ring);

  // ================= ลานวัง + ตำหนักไท่เหอ (ท้องพระโรง) =================
  const P = CFG.rings[CFG.rings.length - 1];
  bx(C.paving, P.half * 2 - 0.4, 0.08, P.half * 2 - 0.4, 0, 0.04, 0);
  // ทางหลวงแกนกลาง: จากประตูนอกทะลุถึงหน้าตำหนัก
  bx(C.imperialWay, 6.5, 0.06, outer + 6, 0, 0.07, (outer + 6) / 2 - 2);
  const hz = -P.half * 0.58;
  bx(C.marble, 24, 0.9, 12.5, 0, 0.45, hz);
  bx(C.marble, 20.5, 0.8, 10.5, 0, 1.3, hz);
  bx(C.marbleDark, 17.5, 0.7, 8.8, 0, 2.05, hz);
  bx(C.marble, 5.5, 0.35, 3.4, 0, 1.0, hz + 7.4);
  bx(C.marble, 4.5, 0.35, 2.4, 0, 1.7, hz + 6.2);
  bx(C.red, 14, 4.0, 6.2, 0, 2.4 + 2.0, hz);
  for (let i = -3; i <= 3; i++) cy(C.redDark, 0.26, 0.3, 4.0, 6, i * 2.05, 4.4, hz + 3.3);
  roof(C.tile, 18.5, 9.4, 1.7, 0, 6.4, hz);
  bx(C.red, 12.5, 1.3, 5.2, 0, 8.7, hz);
  roof(C.tile, 15.5, 7.6, 3.1, 0, 9.3, hz);
  bx(C.gold, 8.5, 0.35, 0.35, 0, 12.45, hz);
  cn(C.gold, 0.35, 0.9, 4, -4.4, 12.6, hz, Math.PI / 4);
  cn(C.gold, 0.35, 0.9, 4, 4.4, 12.6, hz, Math.PI / 4);
  // กระถางธูปทองสองข้างบันได
  for (const x of [-4, 4]) { cy(C.tileDark, 0.5, 0.35, 0.8, 8, x, 0.45, hz + 8.6); cy(C.gold, 0.55, 0.5, 0.18, 8, x, 0.9, hz + 8.6); }

  // ---- ต้นไม้ ----
  function tree(x, z, s = 1) {
    cy(C.treeTrunk, 0.16 * s, 0.22 * s, 1 * s, 5, x, 0.5 * s, z);
    cn(C.tree, 1.15 * s, 2 * s, 6, x, 1.9 * s, z);
    cn(C.tree, 0.85 * s, 1.6 * s, 6, x, 3 * s, z);
  }
  for (let i = 0; i < 52; i++) {
    const a = (i * 2.399) % (Math.PI * 2);
    const r = 165 + ((i * 37) % 85);
    tree(Math.cos(a) * r, Math.sin(a) * r, 0.9 + ((i * 13) % 5) * 0.14);
  }
  const inTree = (CFG.rings[1].half + CFG.rings[1].thick + W) / 2 + 2;
  for (const [tx, tz] of [[-inTree, inTree], [inTree, -inTree], [-inTree, -inTree], [inTree, inTree]]) tree(tx, tz, 0.95);
  for (const [tx, tz] of [[-30, -30], [30, -30]]) tree(tx, tz, 0.8);

  const group = new THREE.Group();
  for (const [hex, geoms] of buckets) {
    const merged = BGU.mergeGeometries(geoms, false);
    const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ color: hex, flatShading: true }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  scene.add(group);

  // ---- บานประตูทุกชั้น (เปิดได้จริง — หมุนรอบบานพับ บานเข้าด้านใน) ----
  const gateGroup = new THREE.Group();
  const doorMat = new THREE.MeshLambertMaterial({ color: C.redDark, flatShading: true });
  const innerDoorMat = new THREE.MeshLambertMaterial({ color: C.vermilionDark, flatShading: true });
  const studMat = new THREE.MeshLambertMaterial({ color: C.gold, flatShading: true });
  const braceMat = new THREE.MeshLambertMaterial({ color: C.woodDark, flatShading: true });
  const makeDoor = (sign, { width, height, z, mat }) => {
    const pivot = new THREE.Group();
    pivot.position.set(sign * width, 0, z);
    const door = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.5), mat);
    door.position.set(-sign * width / 2, height / 2, 0);
    door.castShadow = true;
    pivot.add(door);
    for (const f of [0.12, 0.5, 0.88]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(width - 0.25, 0.4, 0.22), braceMat);
      beam.position.set(-sign * width / 2, height * f, 0.36);
      pivot.add(beam);
    }
    for (const y of [height * 0.12, height * 0.88]) {
      const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.75, 8), studMat);
      hinge.position.set(0, y, 0);
      pivot.add(hinge);
    }
    const rows = Math.max(3, Math.round(height / 2.2));
    for (let r = 0; r < rows; r++) for (let cc = 0; cc < 2; cc++) {
      const stud = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.15), studMat);
      stud.position.set(-sign * (width * 0.25 + cc * width * 0.5), height * (0.17 + (r / (rows - 1)) * 0.66), 0.36);
      pivot.add(stud);
    }
    gateGroup.add(pivot);
    return pivot;
  };
  const gates = CFG.rings.map((R, ring) => {
    const spec = ring === 0
      ? { width: 5.05, height: 9.4, z: outer + 0.55, mat: doorMat }
      : { width: gateHalfWidth(ring) + 0.3, height: R.h * 0.72 - 0.1, z: R.half + R.thick + 0.3, mat: innerDoorMat };
    return { doorL: makeDoor(-1, spec), doorR: makeDoor(1, spec) };
  });
  group.add(gateGroup);

  // ---- ธงยึดกำแพงชั้นนอก (เปลี่ยนสีตอนยึดได้) ----
  const sides = [];
  for (let s = 0; s < 4; s++) {
    const { n, t } = SIDE_VECS[s];
    const px = n.x * mid, pz = n.z * mid;
    const pole = new THREE.Mesh(
      colorize(new THREE.CylinderGeometry(0.09, 0.11, 6, 6).translate(px, H + 3, pz), C.woodDark),
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })
    );
    const flagMat = new THREE.MeshLambertMaterial({ color: C.banner, side: THREE.DoubleSide });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5, 6, 2), flagMat);
    flag.position.set(px + n.x * 1.2 + t.x * 1.2, H + 5.2, pz + n.z * 1.2 + t.z * 1.2);
    flag.rotation.y = Math.atan2(n.x, n.z);
    pole.castShadow = flag.castShadow = true;
    group.add(pole, flag);
    sides.push({ flagMat, flagMesh: flag, waveT: Math.random() * 10 });
  }

  // ---- ธงลานวัง: เปลี่ยนสีตามความคืบหน้าการยึดวัง ----
  const palacePole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 9, 6), braceMat);
  palacePole.position.set(0, 4.5, P.half * 0.15);
  const palaceFlagMat = new THREE.MeshLambertMaterial({ color: C.banner, side: THREE.DoubleSide });
  const palaceFlagMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2, 6, 2), palaceFlagMat);
  palaceFlagMesh.position.set(1.7, 8, P.half * 0.15);
  palacePole.castShadow = palaceFlagMesh.castShadow = true;
  group.add(palacePole, palaceFlagMesh);
  sides.palace = { flagMat: palaceFlagMat, flagMesh: palaceFlagMesh, waveT: 0 };

  return { group, sides, doorL: gates[0].doorL, doorR: gates[0].doorR, gates, palaceFlag: sides.palace };
}

export function animateCityFlags(sides, dt) {
  const all = sides.palace ? [...sides, sides.palace] : sides;
  for (const s of all) {
    s.waveT += dt;
    s.flagMesh.rotation.z = Math.sin(s.waveT * 2.1) * 0.08;
    s.flagMesh.scale.x = 1 + Math.sin(s.waveT * 3.3) * 0.05;
  }
}

// เปิดประตู — บานสองข้างบานเข้าด้านใน
export function openGateDoors(doorL, doorR, k) {
  const a = gateDoorAngle(k);
  doorL.rotation.y = a;
  doorR.rotation.y = -a;
}

export function gateDoorAngle(k) {
  const t = THREE.MathUtils.clamp(k, 0, 1);
  const eased = t * t * (3 - 2 * t);
  return eased * 1.48;
}
