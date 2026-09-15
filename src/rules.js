// ชนะเมื่อยึดลานวังชั้นในสุดได้ครบเวลา (ไม่จำเป็นต้องล้างทัพเมืองจนหมด)
export function battleOutcome({ palaceProgress = 0, attackersAlive, time, timeLimit }) {
  if (palaceProgress >= 1) return 'win';
  if (attackersAlive === 0) return 'lose_dead';
  if (time > timeLimit) return 'lose_time';
  return null;
}

// ความคืบหน้ายึดลานวังต่อเฟรม: เรามากกว่าและถึงขั้นต่ำ → เดินหน้า, ไม่งั้นค่อย ๆ ถอยกลับ
export function palaceProgressStep(progress, attackers, defenders, dt, { holdTime, decayRate, minHolders }) {
  if (attackers >= minHolders && attackers > defenders) return Math.min(1, progress + dt / holdTime);
  return Math.max(0, progress - (dt / holdTime) * decayRate);
}

export const canUnitClimb = (type) => type !== 'cav' && type !== 'archer';

// จังหวะดราม่า/เพลงรบ: ความเข้มของศึกตอนนี้ — เมืองนอก (ยังไม่เปิดประตู) → เมืองชั้นใน (เปิดแล้ว
// แต่ยังไม่ถึงลานวัง) → ลานวัง (มีทหารเราในลานวังแล้ว หรือกำลังยึดอยู่) ใช้ปรับจังหวะกลองและเลือกฉากตัด
export function siegeIntensity(gateOpen, palaceEngaged) {
  if (palaceEngaged) return 'palace';
  if (gateOpen) return 'inner';
  return 'outer';
}
export const DRUM_INTERVAL = Object.freeze({ outer: 1.9, inner: 1.5, palace: 1.05 });
