const ROLE_PRIORITY = {
  cav: { archer: 8, carrier: 7, def: 5, spear: 3, shield: 2 },
  spear: { sally: 9, cav: 9, archer: 5, carrier: 4, def: 5 },
  shield: { def: 7, archer: 4, carrier: 3, sally: 2 },
  ram: { def: 4, archer: 3, carrier: 2 },
};

export function targetScore(attacker, target, distance, claimed = 0) {
  const role = attacker.utype === 'cav' ? 'cav' : attacker.utype;
  const priority = ROLE_PRIORITY[role]?.[target.utype] ?? 4;
  const woundedBonus = target.hpMax ? (1 - Math.max(0, target.hp) / target.hpMax) * 2 : 0;
  return priority * 10 + woundedBonus - distance * 0.32 - claimed * 12;
}

export function chooseTacticalTarget(attacker, candidates, radius, claimedCount = () => 0) {
  let best = null, bestScore = -Infinity;
  for (const target of candidates) {
    if (!target.alive || target.faction === attacker.faction || target.zone !== attacker.zone) continue;
    const distance = attacker.pos.distanceTo(target.pos);
    if (distance > radius) continue;
    const score = targetScore(attacker, target, distance, claimedCount(target));
    if (score > bestScore) { best = target; bestScore = score; }
  }
  return best;
}

