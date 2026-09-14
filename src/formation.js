import * as THREE from 'three';

// วางหลายกองรอบจุดคำสั่งเป็นตาราง โดยหันหน้าตามทิศที่ทัพกำลังเดิน
export function formationDestinations(companies, target, spacing = 14, formation = 'line') {
  if (companies.length <= 1) return companies.map(() => target.clone());
  const center = new THREE.Vector3();
  for (const c of companies) center.add(c.anchor);
  center.multiplyScalar(1 / companies.length);
  const forward = target.clone().sub(center).setY(0);
  if (forward.lengthSq() < 0.001) forward.set(0, 0, -1);
  forward.normalize();
  const right = new THREE.Vector3(forward.z, 0, -forward.x);
  const cols = formation === 'column'
    ? Math.min(2, companies.length)
    : formation === 'loose'
      ? Math.ceil(Math.sqrt(companies.length))
      : Math.min(8, companies.length);
  const rows = Math.ceil(companies.length / cols);
  const spread = formation === 'loose' ? spacing * 1.35 : spacing;
  const ranked = companies.map((company, index) => ({ company, index }));
  if (formation === 'shield-front') {
    ranked.sort((a, b) => Number(b.company.ctype === 'shield') - Number(a.company.ctype === 'shield') || a.index - b.index);
  }
  const rankByIndex = new Map(ranked.map((entry, rank) => [entry.index, rank]));
  return companies.map((_, i) => {
    const rank = rankByIndex.get(i);
    const col = rank % cols;
    // shield-front วางอันดับแรกไว้แถวหน้าซึ่งอยู่ใกล้เป้าหมายกว่า
    const rawRow = Math.floor(rank / cols);
    const row = formation === 'shield-front' ? rows - 1 - rawRow : rawRow;
    return target.clone()
      .addScaledVector(right, (col - (cols - 1) / 2) * spread)
      .addScaledVector(forward, (row - (rows - 1) / 2) * spread);
  });
}

// slot รายบุคคล: แถวหน้ากว้าง 5 นาย แถวหลังตามมา ไม่วิ่งเข้าพิกัดเดียวกัน
export function unitSlot(index, count, spacing = 1.5, formation = 'line') {
  let cols;
  if (formation === 'column') cols = Math.min(2, Math.max(1, count));
  else if (formation === 'loose') cols = Math.min(5, Math.max(1, count));
  else cols = Math.min(5, Math.max(1, count));
  const rows = Math.ceil(count / cols);
  const col = index % cols;
  const row = Math.floor(index / cols);
  const spread = formation === 'loose' ? spacing * 1.55 : spacing;
  return {
    lateral: (col - (cols - 1) / 2) * spread,
    depth: (row - (rows - 1) / 2) * spread,
  };
}
