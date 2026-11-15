// world.js — Foundry Yard: an original industrial map with two bomb sites,
// a mid lane and long sightlines. Builds the three.js scene, the collision
// boxes the simulation uses, the waypoint graph the bots navigate, and the
// line-of-sight tests. All geometry is boxes and planes with procedural
// textures; the palette is dusk concrete, rust and amber light.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { box2, segmentHitsBox2D, rayBox } from './util.js';

export const MAP = {
  x0: -32, x1: 32, z0: -22, z1: 22,
  spawnAtt: { x: 0, z: 18 },
  spawnDef: { x: 0, z: -18 },
  sites: {
    A: { x0: -30, z0: -20, x1: -18, z1: -8, cx: -24, cz: -14 },
    B: { x0: 18, z0: -20, x1: 30, z1: -8, cx: 24, cz: -14 },
  },
};

// Obstacles: x/z footprint plus height. Movement collides in 2D; sight and
// shots use the full 3D box.
const OBSTACLES = [
  // Perimeter walls.
  { x0: -33, z0: -23, x1: 33, z1: -22, y1: 4.5 },
  { x0: -33, z0: 22, x1: 33, z1: 23, y1: 4.5 },
  { x0: -33, z0: -22, x1: -32, z1: 22, y1: 4.5 },
  { x0: 32, z0: -22, x1: 33, z1: 22, y1: 4.5 },
  // Mid container stack: blocks the direct middle, gaps on both sides.
  { x0: -4, z0: -5, x1: 4, z1: 1, y1: 3.0 },
  // Site A cover: a low wall and a crate.
  { x0: -26, z0: -10, x1: -22, z1: -6, y1: 2.6 },
  { x0: -28, z0: -16, x1: -25, z1: -13, y1: 1.4 },
  // Site B cover, mirrored.
  { x0: 22, z0: -10, x1: 26, z1: -6, y1: 2.6 },
  { x0: 25, z0: -16, x1: 28, z1: -13, y1: 1.4 },
  // Mid-lane flanks.
  { x0: -14, z0: 2, x1: -12, z1: 10, y1: 2.8 },
  { x0: 12, z0: 2, x1: 14, z1: 10, y1: 2.8 },
  // Cover near the attacker spawn.
  { x0: -2, z0: 10, x1: 2, z1: 13, y1: 2.2 },
  // Long-lane crates.
  { x0: -28, z0: 4, x1: -25, z1: 7, y1: 2.0 },
  { x0: 25, z0: 4, x1: 28, z1: 7, y1: 2.0 },
  // Defender-side wall with gaps at both ends.
  { x0: -8, z0: -18, x1: 8, z1: -16, y1: 3.0 },
  // Silo blocks on both flanks.
  { x0: -30, z0: -4, x1: -27, z1: -1, y1: 4.0 },
  { x0: 27, z0: -4, x1: 30, z1: -1, y1: 4.0 },
  // North-west and north-east corner stacks.
  { x0: -30, z0: -20, x1: -27, z1: -17, y1: 2.4 },
  { x0: 27, z0: -20, x1: 30, z1: -17, y1: 2.4 },
];

// Waypoint positions the bots walk between. Links are built automatically:
// two nodes link when they are close and the straight line between them is
// clear of colliders (checked with the boxes grown by a bot radius).
const WAYPOINTS = [
  [0, 18], [0, 12], [-6, 12], [6, 12], [-6, 6], [6, 6], [-6, 0], [6, 0],
  [-16, 6], [16, 6], [-26, 4], [26, 4], [-16, -2], [16, -2],
  [-6, -8], [6, -8], [0, -10], [-14, -14], [14, -14],
  [-24, -14], [24, -14], [-20, -10], [20, -10],
  [0, -18], [-12, -18], [12, -18], [-20, 12], [20, 12],
  [-28, 12], [28, 12], [-10, 16], [10, 16],
];

function buildWaypoints(colliders) {
  const nodes = WAYPOINTS.map(([x, z], i) => ({ id: i, x, z, links: [] }));
  const grown = colliders.map((b) => ({ x0: b.x0 - 0.45, z0: b.z0 - 0.45, x1: b.x1 + 0.45, z1: b.z1 + 0.45, y0: 0, y1: 3 }));
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const dx = a.x - b.x, dz = a.z - b.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > 15 || d < 0.5) continue;
      let clear = true;
      for (const g of grown) {
        if (segmentHitsBox2D(a.x, a.z, b.x, b.z, g)) { clear = false; break; }
      }
      if (clear) { a.links.push(j); b.links.push(i); }
    }
  }
  return nodes;
}

// Breadth-first search over the waypoint graph. Returns an array of node
// ids from the node nearest `from` to the node nearest `to`, or null.
export function findPath(nodes, from, to) {
  let si = 0, ti = 0, sd = 1e9, td = 1e9;
  for (const n of nodes) {
    const d0 = (n.x - from.x) ** 2 + (n.z - from.z) ** 2;
    const d1 = (n.x - to.x) ** 2 + (n.z - to.z) ** 2;
    if (d0 < sd) { sd = d0; si = n.id; }
    if (d1 < td) { td = d1; ti = n.id; }
  }
  const prev = new Array(nodes.length).fill(-1);
  const queue = [si];
  prev[si] = si;
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    if (cur === ti) break;
    for (const next of nodes[cur].links) {
      if (prev[next] === -1) { prev[next] = cur; queue.push(next); }
    }
  }
  if (prev[ti] === -1) return null;
  const path = [];
  let cur = ti;
  while (cur !== si) { path.push(cur); cur = prev[cur]; }
  path.push(si);
  path.reverse();
  return path;
}

export function nearestNode(nodes, x, z) {
  let best = nodes[0], bd = 1e9;
  for (const n of nodes) {
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

function boxMesh(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

export function buildWorld(scene, textures) {
  const colliders = OBSTACLES.map((o) => box2(o.x0, o.z0, o.x1, o.z1, 0, o.y1));
  const waypoints = buildWaypoints(colliders);

  scene.fog = new THREE.Fog(PALETTE.fog, PALETTE.fogNear, PALETTE.fogFar);

  // Dusk sky dome: a big sphere with a vertical gradient, seen from inside.
  {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#241f3d'); g.addColorStop(0.55, '#6b4258'); g.addColorStop(0.8, '#c96a2e'); g.addColorStop(1, '#e08a3e');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(180, 24, 16),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false }),
    );
    scene.add(sky);
  }

  // Lights: a low amber sun from the south-east (it lights the faces the
  // attacker sees while advancing), a violet hemisphere, amber floodlights.
  scene.add(new THREE.HemisphereLight(0x8a7bb8, 0x3a2f28, 1.0));
  const sun = new THREE.DirectionalLight(0xffb347, 1.6);
  sun.position.set(30, 28, 40);
  scene.add(sun);
  const lampPositions = [[-24, -14], [24, -14], [0, 8], [-14, 14], [14, 14]];
  for (const [x, z] of lampPositions) {
    const p = new THREE.PointLight(PALETTE.amberLight, 30, 26, 1.8);
    p.position.set(x, 5.4, z);
    scene.add(p);
  }

  const floorMat = new THREE.MeshStandardMaterial({ map: textures.floor, roughness: 0.95, metalness: 0.05 });
  const wallMat = new THREE.MeshStandardMaterial({ map: textures.wall, roughness: 0.9, metalness: 0.05 });
  const rustMat = new THREE.MeshStandardMaterial({ map: textures.rust, roughness: 0.75, metalness: 0.35 });
  const crateMat = new THREE.MeshStandardMaterial({ map: textures.crate, roughness: 0.8, metalness: 0.2 });
  const hazardMat = new THREE.MeshStandardMaterial({ map: textures.hazard, roughness: 0.85 });
  const darkMat = new THREE.MeshStandardMaterial({ color: PALETTE.metal, roughness: 0.6, metalness: 0.6 });

  // Floor.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(66, 46), floorMat);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // Obstacles as boxes, textured by kind.
  for (const o of OBSTACLES) {
    const w = o.x1 - o.x0, d = o.z1 - o.z0, h = o.y1;
    const cx = (o.x0 + o.x1) / 2, cz = (o.z0 + o.z1) / 2;
    let mat = wallMat;
    if (o.y1 <= 1.5) mat = crateMat;
    else if (o.y1 >= 4.0) mat = rustMat;
    else if (w <= 3.5 && d <= 3.5) mat = crateMat;
    const m = boxMesh(w, h, d, mat, cx, h / 2, cz);
    scene.add(m);
    // A pale cap on tall blocks so the yard reads from above.
    if (h >= 3) {
      const cap = boxMesh(w + 0.08, 0.12, d + 0.08, darkMat, cx, h + 0.06, cz);
      scene.add(cap);
    }
  }

  // Floodlight poles with glowing heads.
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2c2e33, roughness: 0.5, metalness: 0.7 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x332211, emissive: PALETTE.amberLight, emissiveIntensity: 2.2 });
  for (const [x, z] of lampPositions) {
    scene.add(boxMesh(0.25, 5.4, 0.25, poleMat, x, 2.7, z));
    scene.add(boxMesh(0.9, 0.3, 0.5, lampMat, x, 5.5, z));
  }

  // Bomb-site ground markers: a hazard border and a big letter.
  for (const [key, site] of Object.entries(MAP.sites)) {
    const w = site.x1 - site.x0, d = site.z1 - site.z0;
    const border = new THREE.Mesh(new THREE.PlaneGeometry(w, d), hazardMat);
    border.rotation.x = -Math.PI / 2;
    border.position.set(site.cx, 0.02, site.cz);
    border.material = hazardMat.clone();
    border.material.transparent = true; border.material.opacity = 0.35;
    scene.add(border);
    const letter = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 5),
      new THREE.MeshBasicMaterial({ map: textures.siteMarker(key, key === 'A' ? '#3fae6a' : '#e08a2e'), transparent: true, opacity: 0.85, depthWrite: false }),
    );
    letter.rotation.x = -Math.PI / 2;
    letter.position.set(site.cx, 0.04, site.cz);
    scene.add(letter);
  }

  // A few rust barrels and pipes for silhouette (visual only, at the edges).
  const barrelGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.1, 10);
  const barrelSpots = [[-30, 18], [-29, 19], [29, 18], [30, 16], [-10, -20], [11, -20]];
  for (const [x, z] of barrelSpots) {
    const b = new THREE.Mesh(barrelGeo, rustMat);
    b.position.set(x, 0.55, z);
    scene.add(b);
  }

  return { colliders, waypoints, sites: MAP.sites, spawnAtt: MAP.spawnAtt, spawnDef: MAP.spawnDef };
}

// 3D line of sight between two eye points: clear when no collider box
// taller than both eyes blocks the ray.
export function losClear(colliders, x0, y0, z0, x1, y1, z1) {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < 1e-6) return true;
  const ix = dx / dist, iy = dy / dist, iz = dz / dist;
  for (const b of colliders) {
    if (b.y1 <= Math.min(y0, y1) + 0.05) continue;
    if (rayBox(x0, y0, z0, ix, iy, iz, b, dist) >= 0) return false;
  }
  return true;
}

// Nearest wall hit along a ray, or -1.
export function rayWalls(colliders, ox, oy, oz, dx, dy, dz, maxT) {
  let best = -1;
  for (const b of colliders) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, b, maxT);
    if (t >= 0 && (best < 0 || t < best)) best = t;
  }
  return best;
}

export function pointInSite(site, x, z) {
  return x >= site.x0 && x <= site.x1 && z >= site.z0 && z <= site.z1;
}
