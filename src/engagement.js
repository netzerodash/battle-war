export function engagementCapacity(target, choke = false) {
  if (choke) return 2;
  return target.kind === 'cav' ? 4 : 3;
}

export class EngagementRegistry {
  constructor() {
    this.byTarget = new Map();
    this.byAttacker = new Map();
  }

  release(attacker) {
    const claim = this.byAttacker.get(attacker);
    if (!claim) return;
    const list = this.byTarget.get(claim.target);
    if (list) {
      const i = list.indexOf(attacker);
      if (i >= 0) list.splice(i, 1);
      if (!list.length) this.byTarget.delete(claim.target);
    }
    this.byAttacker.delete(attacker);
  }

  claim(attacker, target, capacity = engagementCapacity(target)) {
    const old = this.byAttacker.get(attacker);
    if (old?.target === target) return old;
    this.release(attacker);
    let list = this.byTarget.get(target);
    if (!list) { list = []; this.byTarget.set(target, list); }
    if (list.length >= capacity) return null;
    const claim = { target, slot: list.length, capacity };
    list.push(attacker);
    this.byAttacker.set(attacker, claim);
    return claim;
  }

  hasSpace(target, capacity = engagementCapacity(target)) {
    return (this.byTarget.get(target)?.length || 0) < capacity;
  }

  pointFor(attacker, target, reach = 1.1, out) {
    const claim = this.byAttacker.get(attacker);
    if (!claim || claim.target !== target) return null;
    const angle = (claim.slot / Math.max(1, claim.capacity)) * Math.PI * 2;
    out.set(target.pos.x + Math.cos(angle) * reach, target.pos.y, target.pos.z + Math.sin(angle) * reach);
    return out;
  }

  cleanup() {
    for (const [attacker, claim] of [...this.byAttacker]) {
      if (!attacker.alive || !claim.target.alive || attacker.zone !== claim.target.zone) this.release(attacker);
    }
  }
}

