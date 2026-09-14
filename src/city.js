import * as THREE from 'three';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';
import { CFG } from './config.js';
import { SIDE_VECS, stairPoints } from './world.js';

const C = {
  stone: 0x928a7a, stoneDark: 0x77705f, stoneLight: 0xa89f8c, walk: 0xaaa08a,
  roof: 0x2e6e68, roofDark: 0x24524d,
  wood: 0x6b4a2a, woodDark: 0x4a3420,
  red: 0x8f2f2f, redDark: 0x5a2b22,
  gold: 0xd9a441,
  houseWall: 0x8a7a5e, houseRoof: 0x4e4a44,
  tree: 0x3f5d3a, treeTrunk: 0x5a4026,
  banner: 0xb03030,
  stair: 0x5f4326,
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

  const W = CFG.wallHalf, T = CFG.wallThick, H = CFG.wallH;
  const mid = W + T / 2;   // 44
  const outer = W + T;     // 48

  // ---- กำแพง 4 ด้าน (หนา 2 ชั้น + ฐานราก) ----
  // กล่องยาวต้องหมุนตามแนวกำแพง: ด้าน N/S ยาวตามแกน X, ด้าน E/W ยาวตามแกน Z
  const alongX = (t) => Math.abs(t.x) > 0.5;
  const wpush = (hex, len, h, thick, t, x, y, z) => {
    const ax = alongX(t);
    push(hex, new THREE.BoxGeometry(ax ? len : thick, h, ax ? thick : len).translate(x, y, z));
  };
  for (let s = 0; s < 4; s++) {
    const { n, t } = SIDE_VECS[s];
    wpush(C.stone, 88, H, T, t, n.x * mid, H / 2, n.z * mid);
    // ฐานรากยื่นออกสองข้าง
    wpush(C.stoneDark, 90, 2.2, T + 1.6, t, n.x * mid, 1.1, n.z * mid);
    // แถบคาดแดงกลางกำแพง
    wpush(C.redDark, 88.4, 0.8, T + 0.3, t, n.x * mid, H * 0.62, n.z * mid);
    // พื้นยอดกำแพง
    wpush(C.walk, 88, 0.3, T - 0.5, t, n.x * mid, H + 0.15, n.z * mid);
    // เสาสันนอก (buttress) ทุก ๆ 8 เมตร
    for (let k = -5; k <= 5; k++) {
      const off = k * 8;
      wpush(C.stoneDark, 1.6, H * 0.72, 1.2, t, t.x * off + n.x * (outer + 0.5), H * 0.36, t.z * off + n.z * (outer + 0.5));
    }
    // ใบกำแพง (ช่องยิง) ริมขอบนอก — สลับช่องแบบกำแพงจีน
    for (let k = -12; k <= 12; k++) {
      const off = k * 3.4;
      if (Math.abs(off) > 40) continue;
      wpush(C.stoneLight, 1.9, 1.5, 0.9, t, t.x * off + n.x * (outer - 0.45), H + 0.75, t.z * off + n.z * (outer - 0.45));
    }
    // กั้นด้านใน
    wpush(C.stoneDark, 88, 1.0, 0.6, t, n.x * (W - 0.3), H + 0.5, n.z * (W - 0.3));
    // ธงตกแต่งตามกำแพง
    for (let k = -3; k <= 3; k++) {
      if (k === 0) continue;
      const off = k * 11;
      const px = t.x * off + n.x * (W - 0.7), pz = t.z * off + n.z * (W - 0.7);
      push(C.woodDark, new THREE.CylinderGeometry(0.05, 0.05, 5, 5).translate(px, H + 2.5, pz));
      const flag = new THREE.BoxGeometry(1.25, 0.7, 0.03);
      flag.rotateY(Math.atan2(n.x, n.z));
      flag.translate(px + n.x * 0.65, H + 4.4, pz + n.z * 0.65);
      push(C.banner, flag);
    }
  }

  // ---- ปราสาทป้อมมุม 4 หลัง (สไตล์สถาปัตย์จีน 2 ชั้น) ----
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * mid, z = sz * mid;
    cy(C.stone, 6.4, 7.0, 3.2, 8, x, 1.6, z);                       // ฐานเขียง
    cy(C.stone, 5.4, 6.2, H, 8, x, H / 2 + 2, z);                   // ตัวป้อมทรงกระบอก
    cy(C.walk, 6.6, 6.6, 0.5, 8, x, H + 2.2, z);                    // ดาดฟ้า
    for (let k = 0; k < 8; k++) {                                   // ใบกำแพงรอบดาดฟ้า
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      push(C.stoneLight, new THREE.BoxGeometry(1.6, 1.3, 0.8)
        .rotateY(-a).translate(x + Math.cos(a) * 6.1, H + 2.9, z + Math.sin(a) * 6.1));
    }
    // ชั้นบน: ศาลาเสาแดงหลังคาซ้อน
    cy(C.woodDark, 0.28, 0.32, 3.6, 6, x - 2.6, H + 4.2, z - 2.6);
    cy(C.woodDark, 0.28, 0.32, 3.6, 6, x + 2.6, H + 4.2, z - 2.6);
    cy(C.woodDark, 0.28, 0.32, 3.6, 6, x - 2.6, H + 4.2, z + 2.6);
    cy(C.woodDark, 0.28, 0.32, 3.6, 6, x + 2.6, H + 4.2, z + 2.6);
    push(C.red, new THREE.BoxGeometry(6.6, 0.6, 6.6).translate(x, H + 2.6, z));
    push(C.red, new THREE.BoxGeometry(6.0, 2.6, 6.0).translate(x, H + 4.4, z));
    cn(C.roof, 5.6, 2.4, 4, x, H + 6.9, z, Math.PI / 4);
    push(C.red, new THREE.BoxGeometry(4.0, 1.9, 4.0).translate(x, H + 7.4, z));
    cn(C.roofDark, 3.6, 2.0, 4, x, H + 9.3, z, Math.PI / 4);
    cn(C.gold, 0.5, 1.1, 4, x, H + 10.8, z, Math.PI / 4);
    cy(C.woodDark, 0.08, 0.08, 4.4, 5, x + 2.2, H + 8.4, z + 2.2);
    push(C.banner, new THREE.BoxGeometry(1.6, 0.9, 0.03).translate(x + 3.0, H + 10.2, z + 2.2));
  }

  // ---- ซุ้มประตูเมืองฝั่งใต้ 3 ชั้น ----
  cy(C.red, 1.3, 1.4, 11, 8, -6.2, 5.2, outer + 0.6);
  cy(C.red, 1.3, 1.4, 11, 8, 6.2, 5.2, outer + 0.6);
  bx(C.woodDark, 15.4, 2.4, 2.6, 0, 11.8, outer + 0.6);
  push(C.redDark, new THREE.BoxGeometry(11, 9.6, 1.2).translate(0, 4.8, outer + 0.8));
  bx(C.gold, 11, 0.6, 1.25, 0, 9.2, outer + 0.85);
  for (let k = -4; k <= 4; k++) push(C.gold, new THREE.BoxGeometry(0.2, 9, 1.28).translate(k * 1.25, 4.8, outer + 0.85));
  // หอคอยเหนือประตู 3 ชั้น
  push(C.red, new THREE.BoxGeometry(15, 4.2, 6.4).translate(0, 14.4, mid + 0.6));
  push(C.stone, new THREE.BoxGeometry(15.6, 0.5, 7).translate(0, 16.7, mid + 0.6));
  cn(C.roof, 11, 3.2, 4, 0, 18.6, mid + 0.6, Math.PI / 4);
  push(C.red, new THREE.BoxGeometry(9.5, 2.8, 5).translate(0, 19.9, mid + 0.6));
  cn(C.roofDark, 7.2, 2.6, 4, 0, 22.6, mid + 0.6, Math.PI / 4);
  push(C.red, new THREE.BoxGeometry(5.5, 2.0, 3.6).translate(0, 23.9, mid + 0.6));
  cn(C.roof, 4.4, 2.2, 4, 0, 26, mid + 0.6, Math.PI / 4);
  cn(C.gold, 0.6, 1.3, 4, 0, 27.7, mid + 0.6, Math.PI / 4);

  // ---- บันไดภายในประจำด้าน (ไว้ลงจากกำแพง / กองสำรองขึ้นเสริม) ----
  for (let s = 0; s < 4; s++) {
    const { n, t } = SIDE_VECS[s];
    const sp = stairPoints(s);
    const dir = sp.top.clone().sub(sp.base);
    const horizontal = dir.clone().setY(0);
    const run = horizontal.length();
    const len = dir.length();
    const midP = sp.base.clone().addScaledVector(dir, 0.5);
    const angle = Math.atan2(dir.y, run);
    const yaw = Math.atan2(horizontal.x, horizontal.z);
    // ขั้นไม้จริง — กล่องแต่ละขั้นวางระดับ ไม่ใช้แผ่นลาดแบบทางเลื่อน
    const stepCount = 18;
    const stepDepth = run / stepCount + 0.12;
    for (let i = 0; i < stepCount; i++) {
      const f = (i + 0.5) / stepCount;
      const height = Math.max(0.35, CFG.walkY * ((i + 1) / stepCount));
      const p = sp.base.clone().addScaledVector(horizontal, f);
      const step = new THREE.BoxGeometry(4.2, height, stepDepth);
      step.rotateY(yaw);
      step.translate(p.x, height / 2, p.z);
      push(i % 2 ? C.stair : C.woodDark, step);
    }
    // ชานพักบนกำแพง ช่วยให้จุดขึ้นลงอ่านออกชัด
    const landing = new THREE.BoxGeometry(4.6, 0.5, 3.0);
    landing.rotateY(yaw);
    landing.translate(sp.top.x, CFG.walkY - 0.25, sp.top.z);
    push(C.stair, landing);
    // ราวบันไดสองข้างวางตามความลาด
    for (const side2 of [-1.7, 1.7]) {
      const rail = new THREE.BoxGeometry(0.24, 0.32, len + 0.8);
      rail.rotateX(-angle);
      rail.rotateY(yaw);
      const rp = midP.clone().addScaledVector(t, side2);
      rail.translate(rp.x, rp.y + 1.0, rp.z);
      push(C.woodDark, rail);
    }
    // เสาราวแนวตั้งสองข้างเป็นช่วง ๆ
    for (const f of [0.08, 0.3, 0.52, 0.74, 0.96]) {
      const pp = sp.base.clone().addScaledVector(dir, f);
      for (const side2 of [-1.7, 1.7]) {
        const post = pp.clone().addScaledVector(t, side2);
        push(C.woodDark, new THREE.BoxGeometry(0.28, 2.0, 0.28).translate(post.x, pp.y + 0.8, post.z));
      }
    }
  }

  // ---- ลานบัญชาการกลางเมืองแบบเปิด — ไม่มีอาคารทึบบังการต่อสู้ ----
  bx(C.stone, 25, 0.45, 25, 0, 0.225, 0);
  bx(C.redDark, 21, 0.18, 0.6, 0, 0.55, -10.5);
  bx(C.redDark, 21, 0.18, 0.6, 0, 0.55, 10.5);
  bx(C.redDark, 0.6, 0.18, 21, -10.5, 0.55, 0);
  bx(C.redDark, 0.6, 0.18, 21, 10.5, 0.55, 0);
  // เสาธงเตี้ยอยู่ริมลาน ไม่บังยูนิตจากกล้องด้านบน
  for (const x of [-9, 9]) {
    cy(C.woodDark, 0.1, 0.12, 5, 6, x, 2.5, -9);
    push(C.banner, new THREE.BoxGeometry(1.5, 0.9, 0.04).translate(x + 0.75, 4.2, -9));
  }

  // ลานเมืองตั้งใจเปิดโล่งทั้งหมด เพื่อให้เห็นเส้นทางและการไล่ล่าของทหารจากกล้อง RTS

  // ---- ต้นไม้ ----
  function tree(x, z, s = 1) {
    cy(C.treeTrunk, 0.16 * s, 0.22 * s, 1 * s, 5, x, 0.5 * s, z);
    cn(C.tree, 1.15 * s, 2 * s, 6, x, 1.9 * s, z);
    cn(C.tree, 0.85 * s, 1.6 * s, 6, x, 3 * s, z);
  }
  for (let i = 0; i < 46; i++) {
    const a = (i * 2.399) % (Math.PI * 2);
    const r = 100 + ((i * 37) % 55);
    tree(Math.cos(a) * r, Math.sin(a) * r, 0.9 + ((i * 13) % 5) * 0.14);
  }
  for (const [tx, tz] of [[-34, 34], [34, -34], [-34, -34], [34, 34], [-33, 0], [0, 33]]) tree(tx, tz, 0.85);

  const group = new THREE.Group();
  for (const [hex, geoms] of buckets) {
    const merged = BGU.mergeGeometries(geoms, false);
    const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ color: hex, flatShading: true }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  scene.add(group);

  // ---- บานประตูเมือง (เปิดได้จริง — หมุนรอบบานพับ) ----
  const gateGroup = new THREE.Group();
  const doorMat = new THREE.MeshLambertMaterial({ color: C.redDark, flatShading: true });
  const studMat = new THREE.MeshLambertMaterial({ color: C.gold, flatShading: true });
  const braceMat = new THREE.MeshLambertMaterial({ color: C.woodDark, flatShading: true });
  const makeDoor = (sign) => {
    const pivot = new THREE.Group();
    // บานพับอยู่ชิดเสาประตู ส่วนตัวบานยื่นกลับเข้าหากึ่งกลาง
    pivot.position.set(sign * 5.05, 0, outer + 0.55);
    const door = new THREE.Mesh(new THREE.BoxGeometry(5.05, 9.4, 0.55), doorMat);
    door.position.set(-sign * 2.525, 4.7, 0);
    door.castShadow = true;
    pivot.add(door);
    // คานขวางด้านหน้า ทำให้ดูเป็นประตูไม้หนักแทนแผ่นเรียบ
    for (const y of [1.15, 4.7, 8.25]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.42, 0.22), braceMat);
      beam.position.set(-sign * 2.525, y, 0.39);
      beam.castShadow = true;
      pivot.add(beam);
    }
    // แกนบานพับบน/ล่าง
    for (const y of [1.1, 8.3]) {
      const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.75, 8), studMat);
      hinge.position.set(0, y, 0);
      pivot.add(hinge);
    }
    for (let r = 0; r < 4; r++) for (let cc = 0; cc < 2; cc++) {
      const stud = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.15), studMat);
      stud.position.set(-sign * (1.25 + cc * 2.5), 1.6 + r * 2.2, 0.39);
      pivot.add(stud);
    }
    gateGroup.add(pivot);
    return pivot;
  };
  const doorL = makeDoor(-1), doorR = makeDoor(1);
  group.add(gateGroup);

  // ---- ธงยึดกำแพง (เปลี่ยนสีตอนยึดได้) ----
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
  return { group, sides, doorL, doorR };
}

export function animateCityFlags(sides, dt) {
  for (const s of sides) {
    s.waveT += dt;
    s.flagMesh.rotation.z = Math.sin(s.waveT * 2.1) * 0.08;
    s.flagMesh.scale.x = 1 + Math.sin(s.waveT * 3.3) * 0.05;
  }
}

// เปิดประตู — บานสองข้างบานออก
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
