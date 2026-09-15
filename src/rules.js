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
