// util.js — seeded RNG, small vector helpers and collision maths.
// The simulation uses only these (never Math.random), so a round plays the
// same way from the same seed. Hot-loop helpers reuse module-level temps and
// never allocate. Angles are in radians; yaw 0 faces north (-z).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function randRange(rng, lo, hi) { return lo + rng() * (hi - lo); }

// 2D axis-aligned box used by every collider: { x0, z0, x1, z1, y0, y1 }.
export function box2(x0, z0, x1, z1, y0 = 0, y1 = 3) {
  return { x0, z0, x1, z1, y0, y1 };
}

// Push a circle (x, z, radius) out of a 2D box. Returns true when pushed.
export function resolveCircleBox(px, pz, r, b, out) {
  const cx = clamp(px, b.x0, b.x1);
  const cz = clamp(pz, b.z0, b.z1);
  let dx = px - cx;
  let dz = pz - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    const push = (r - d) / d;
    out.x = px + dx * push;
    out.z = pz + dz * push;
  } else {
    // Centre inside the box: push out along the smallest penetration axis.
    const pl = px - b.x0, pr = b.x1 - px, pt = pz - b.z0, pb = b.z1 - pz;
    const m = Math.min(pl, pr, pt, pb);
    out.x = px; out.z = pz;
    if (m === pl) out.x = b.x0 - r;
    else if (m === pr) out.x = b.x1 + r;
    else if (m === pt) out.z = b.z0 - r;
    else out.z = b.z1 + r;
  }
  return true;
}

// Does segment (x0,z0)-(x1,z1) cross box b in 2D? Slab test, no allocation.
export function segmentHitsBox2D(x0, z0, x1, z1, b) {
  let tmin = 0, tmax = 1;
  const dx = x1 - x0, dz = z1 - z0;
  if (Math.abs(dx) < 1e-9) {
    if (x0 < b.x0 || x0 > b.x1) return false;
  } else {
    let t1 = (b.x0 - x0) / dx, t2 = (b.x1 - x0) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (z0 < b.z0 || z0 > b.z1) return false;
  } else {
    let t1 = (b.z0 - z0) / dz, t2 = (b.z1 - z0) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

// Ray (origin + t*dir, t in [0, maxT]) against a 3D AABB. Returns t or -1.
export function rayBox(ox, oy, oz, dx, dy, dz, b, maxT) {
  let tmin = 0, tmax = maxT;
  if (Math.abs(dx) < 1e-9) { if (ox < b.x0 || ox > b.x1) return -1; }
  else {
    let t1 = (b.x0 - ox) / dx, t2 = (b.x1 - ox) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dy) < 1e-9) { if (oy < b.y0 || oy > b.y1) return -1; }
  else {
    let t1 = (b.y0 - oy) / dy, t2 = (b.y1 - oy) / dy;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dz) < 1e-9) { if (oz < b.z0 || oz > b.z1) return -1; }
  else {
    let t1 = (b.z0 - oz) / dz, t2 = (b.z1 - oz) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}

// Move a circle (x, z, radius) by (dx, dz) against AABB colliders, one axis
// at a time so it slides along walls. Zeroes the velocity component on the
// axis that was blocked. Bounds keep the circle inside the map.
export function moveWithCollision(colliders, ent, dx, dz, radius) {
  if (dx !== 0) {
    let nx = clamp(ent.x + dx, -31.6, 31.6);
    for (const b of colliders) {
      if (b.y1 < 0.4) continue;
      if (nx + radius > b.x0 && nx - radius < b.x1 && ent.z + radius > b.z0 && ent.z - radius < b.z1) {
        nx = dx > 0 ? b.x0 - radius : b.x1 + radius;
        ent.vx = 0;
      }
    }
    ent.x = nx;
  }
  if (dz !== 0) {
    let nz = clamp(ent.z + dz, -21.6, 21.6);
    for (const b of colliders) {
      if (b.y1 < 0.4) continue;
      if (ent.x + radius > b.x0 && ent.x - radius < b.x1 && nz + radius > b.z0 && nz - radius < b.z1) {
        nz = dz > 0 ? b.z0 - radius : b.z1 + radius;
        ent.vz = 0;
      }
    }
    ent.z = nz;
  }
}

// Ray against a sphere. Returns t or -1.
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxT) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return -1;
  const t = tca - Math.sqrt(r2 - d2);
  return t <= maxT ? t : -1;
}
