import * as THREE from 'three';

// ---------- ตัวช่วยมองเห็นทหารฝ่ายเมือง ----------
// ทหารเมืองใส่เกราะเหล็กยืนบนกำแพงหิน/ลานหินสีเทา — จากกล้องแม่ทัพจะกลืนหายไปกับฉาก
// จึงวางวงสีใต้เท้าทุกนาย (โตขึ้นเมื่อซูมออก) และป้ายบอกจำนวนเหนือแต่ละกลุ่มเมื่อมองมุมกว้าง

export const DEFENDER_MARKER_COLORS = Object.freeze({
  melee: 0x2f7dff,   // ทหารราบเมือง/กองสำรอง
  archer: 0x5fd6ff,  // พลธนู
  worker: 0x8fb0d8,  // พลขนหิน
  guard: 0xa66bff,   // องครักษ์ชั้นใน/วัง + ม้าซอง
});

export function markerKindOf(s) {
  switch (s.utype) {
    case 'archer':
    case 'guardArcher': return 'archer';
    case 'carrier': return 'worker';
    case 'guardShield':
    case 'guardSpear':
    case 'guardCav':
    case 'sally': return 'guard';
    default: return 'melee';
  }
}

// วงใต้เท้ายิ่งใหญ่เมื่อกล้องไกล แต่ไม่เกินเพดาน (ไม่ให้ทับกันจนเป็นแผ่นเดียว)
export const markerScaleForDistance = (dist) => Math.min(2.6, Math.max(1, dist / 75));

const DISC_GEO = new THREE.CircleGeometry(0.62, 18).rotateX(-Math.PI / 2);
const _p = new THREE.Vector3();

export class DefenderMarkers {
  constructor(group, capacity = 1800) {
    this.capacity = capacity;
    this.material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.78, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(DISC_GEO, this.material, capacity);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.count = 0;
    group.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._c = new THREE.Color();
  }

  update(soldiers, scale = 1) {
    let n = 0;
    for (const s of soldiers) {
      if (!s.alive || n >= this.capacity) continue;
      const kind = markerKindOf(s);
      const k = scale * (kind === 'guard' ? 1.25 : 1) * (s.kind === 'cav' ? 1.5 : 1);
      // ยกพ้นพื้นปูลานวัง/ทางหลวง เพื่อไม่ให้ z-fight
      this._m.makeScale(k, 1, k).setPosition(s.pos.x, s.pos.y + 0.14, s.pos.z);
      this.mesh.setMatrixAt(n, this._m);
      this.mesh.setColorAt(n, this._c.setHex(DEFENDER_MARKER_COLORS[kind]));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    return n;
  }
}

// ป้ายจำนวนทหารเมืองเหนือแต่ละกลุ่ม — โผล่เฉพาะตอนซูมออก และคงขนาดบนจอไว้ไม่ว่ากล้องจะไกลแค่ไหน
export class DefenderGroupLabels {
  constructor(group) {
    this.group = group;
    this.sprites = [];
  }

  spriteAt(i) {
    if (this.sprites[i]) return this.sprites[i];
    const canvas = document.createElement('canvas');
    canvas.width = 192; canvas.height = 80;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 25;
    sprite.userData = { canvas, texture, key: '' };
    this.group.add(sprite);
    this.sprites[i] = sprite;
    return sprite;
  }

  draw(sprite, text) {
    if (sprite.userData.key === text) return;
    sprite.userData.key = text;
    const { canvas, texture } = sprite.userData;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.roundRect(6, 8, canvas.width - 12, canvas.height - 16, 30);
    ctx.fillStyle = 'rgba(10, 28, 68, 0.86)';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#4f9bff';
    ctx.stroke();
    ctx.font = 'bold 40px "Noto Sans Thai", "Apple Color Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
    texture.needsUpdate = true;
  }

  // opacity 0 = ซ่อน; ป้ายค่อย ๆ ปรากฏเมื่อกล้องถอยออกไกลกว่า ~100 ม.
  update(groups, cameraDist, camera = null) {
    const opacity = Math.min(1, Math.max(0, (cameraDist - 95) / 40));
    const h = cameraDist * 0.027;
    groups.forEach((g, i) => {
      const sprite = this.spriteAt(i);
      this.draw(sprite, `${g.icon} ${g.count}`);
      sprite.visible = opacity > 0.01;
      sprite.material.opacity = opacity;
      sprite.position.set(g.x, g.y + 3 + h * 0.6, g.z);
      sprite.scale.set(h * 2.4, h, 1);
    });
    for (let i = groups.length; i < this.sprites.length; i++) this.sprites[i].visible = false;
    if (camera && opacity > 0.01) this.declutter(camera);
  }

  // กันป้ายซ้อนกันบนจอ: ป้ายที่ใกล้กล้องอยู่ที่เดิม ป้ายที่ไกลกว่าและชนกันถูกยกขึ้นจนพ้น
  declutter(camera) {
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const items = this.sprites.filter((s) => s.visible)
      .map((s) => ({ s, d: camera.position.distanceTo(s.position) }))
      .sort((a, b) => a.d - b.d);
    const placed = [];
    for (const it of items) {
      for (let tries = 0; tries < 8; tries++) {
        _p.copy(it.s.position).project(camera);
        const hh = (it.s.scale.y / 2) / (it.d * tanHalf) * 1.08;
        const hw = hh * (it.s.scale.x / it.s.scale.y) / camera.aspect;
        const hit = placed.find((p) => Math.abs(p.x - _p.x) < p.hw + hw && Math.abs(p.y - _p.y) < p.hh + hh);
        if (!hit) { placed.push({ x: _p.x, y: _p.y, hw, hh }); break; }
        it.s.position.y += ((hit.y + hit.hh + hh) - _p.y + 0.01) * it.d * tanHalf;
      }
    }
  }
}

// ---------- ป้ายเลขกลุ่มเหนือธงกอง ----------
const BADGE_TEXTURES = new Map();
function badgeTexture(n) {
  if (BADGE_TEXTURES.has(n)) return BADGE_TEXTURES.get(n);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(28, 18, 10, 0.9)';
  ctx.strokeStyle = '#e8c14a';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(5, 5, 54, 54, 12);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffe27a';
  ctx.font = 'bold 40px "Noto Sans Thai", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), 32, 35);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  BADGE_TEXTURES.set(n, texture);
  return texture;
}

export function groupBadgeSprite() {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false }));
  sprite.renderOrder = 24;
  sprite.userData.n = null;
  return sprite;
}

export function setGroupBadge(sprite, n) {
  if (sprite.userData.n === n) return;
  sprite.userData.n = n;
  sprite.material.map = badgeTexture(n);
  sprite.material.needsUpdate = true;
}
