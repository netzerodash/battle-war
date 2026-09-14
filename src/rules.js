export function battleOutcome({ defendersAlive, attackersAlive, gateOpen, time, timeLimit }) {
  if (defendersAlive === 0 && gateOpen) return 'win';
  if (attackersAlive === 0) return 'lose_dead';
  if (time > timeLimit) return 'lose_time';
  return null;
}

export const canUnitClimb = (type) => type !== 'cav' && type !== 'archer';
