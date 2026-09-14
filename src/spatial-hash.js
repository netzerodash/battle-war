export class SpatialHash {
  constructor(cellSize = 4) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }

  clear() { this.cells.clear(); }

  key(x, z) {
    return `${Math.floor(x / this.cellSize)}|${Math.floor(z / this.cellSize)}`;
  }

  insert(item) {
    const key = this.key(item.pos.x, item.pos.z);
    let bucket = this.cells.get(key);
    if (!bucket) { bucket = []; this.cells.set(key, bucket); }
    bucket.push(item);
  }

  rebuild(items) {
    this.clear();
    for (const item of items) if (item?.alive !== false && item?.pos) this.insert(item);
    return this;
  }

  query(pos, radius, out = []) {
    out.length = 0;
    const minX = Math.floor((pos.x - radius) / this.cellSize);
    const maxX = Math.floor((pos.x + radius) / this.cellSize);
    const minZ = Math.floor((pos.z - radius) / this.cellSize);
    const maxZ = Math.floor((pos.z + radius) / this.cellSize);
    const r2 = radius * radius;
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
      const bucket = this.cells.get(`${x}|${z}`);
      if (!bucket) continue;
      for (const item of bucket) {
        const dx = item.pos.x - pos.x, dz = item.pos.z - pos.z;
        if (dx * dx + dz * dz <= r2) out.push(item);
      }
    }
    return out;
  }
}

