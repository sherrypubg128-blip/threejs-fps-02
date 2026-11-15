// weapons.js — weapon definitions and the hitscan shooting model.
// Every shot is a ray against walls and against the combatants' head and
// body spheres. Damage falls with range, headshots multiply, and spread and
// recoil grow when the shooter moves or fires fast, so stopping to aim pays.
// A shot returns its result (hit, kill, wall) so the caller can draw the
// tracer, flash the hitmarker and play the sound from one place.
import { raySphere } from './util.js';
import { rayWalls } from './world.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', slot: 1, price: 0,
    damage: 26, headMult: 3.2, interval: 0.18, auto: false,
    mag: 12, reserve: 36, reloadTime: 1.4, spread: 0.011,
    moveSpread: 0.035, recoil: 0.35, range: 60, pellets: 1, speed: 1.0,
  },
  smg: {
    id: 'smg', name: 'VK-9 Ripper', slot: 2, price: 1500,
    damage: 22, headMult: 3.0, interval: 0.077, auto: true,
    mag: 30, reserve: 120, reloadTime: 1.9, spread: 0.02,
    moveSpread: 0.03, recoil: 0.5, range: 45, pellets: 1, speed: 0.98,
  },
  rifle: {
    id: 'rifle', name: 'AR-77 Longshot', slot: 3, price: 2700,
    damage: 33, headMult: 3.5, interval: 0.1, auto: true,
    mag: 30, reserve: 90, reloadTime: 2.2, spread: 0.011,
    moveSpread: 0.032, recoil: 0.8, range: 80, pellets: 1, speed: 0.94,
  },
  shotgun: {
    id: 'shotgun', name: 'M12 Breacher', slot: 4, price: 1200,
    damage: 9, headMult: 2.0, interval: 0.85, auto: false,
    mag: 6, reserve: 24, reloadTime: 2.6, spread: 0.05,
    moveSpread: 0.04, recoil: 1.6, range: 22, pellets: 8, speed: 0.96,
  },
  sniper: {
    id: 'sniper', name: 'L96 Deadeye', slot: 5, price: 4750,
    damage: 95, headMult: 4.0, interval: 1.3, auto: false,
    mag: 5, reserve: 15, reloadTime: 3.0, spread: 0.002,
    moveSpread: 0.06, recoil: 2.2, range: 120, pellets: 1, speed: 0.9, zoom: 2.5,
  },
};

export const GRENADE_PRICE = 300;
export const ARMOR_PRICE = 650;

export function createLoadout() {
  return {
    owned: { pistol: { mag: 12, reserve: 36 } },
    current: 'pistol',
    grenades: 0,
  };
}

// Total spread for a shooter right now: base, plus movement, plus bloom
// from recent shots, minus the steadiness of crouching or walking.
export function currentSpread(weapon, shooter) {
  let s = weapon.spread + shooter.bloom;
  const speed = Math.hypot(shooter.vx || 0, shooter.vz || 0);
  s += weapon.moveSpread * Math.min(1, speed / 5);
  if (shooter.crouched) s *= 0.7;
  if (shooter.walking) s *= 0.85;
  if (shooter.scoped) s *= 0.25;
  return s;
}

// Fire one trigger pull (or one pellet volley). Returns a shot record, or
// null when the weapon cannot fire yet. The caller draws the tracer and
// plays the sound.
export function shoot(S, shooter, dirX, dirY, dirZ) {
  const def = WEAPONS[shooter.loadout.current];
  const state = shooter.loadout.owned[shooter.loadout.current];
  if (!def || !state) return null;
  if (shooter.fireT > 0 || shooter.reloadT > 0 || !shooter.alive) return null;
  if (state.mag <= 0) return { dry: true, weapon: def };
  state.mag -= 1;
  shooter.fireT = def.interval;
  shooter.bloom = Math.min(0.06, shooter.bloom + def.recoil * 0.012);
  shooter.recoil = Math.min(2.2, shooter.recoil + def.recoil);

  const ox = shooter.x, oy = shooter.eyeY, oz = shooter.z;
  const spread = currentSpread(def, shooter);
  let best = null;
  for (let p = 0; p < def.pellets; p++) {
    const rng = S.rng;
    const dx = dirX + (rng() - 0.5) * 2 * spread + (rng() - 0.5) * spread;
    const dy = dirY + (rng() - 0.5) * 2 * spread + (rng() - 0.5) * spread;
    const dz = dirZ + (rng() - 0.5) * 2 * spread + (rng() - 0.5) * spread;
    const len = Math.hypot(dx, dy, dz);
    const ux = dx / len, uy = dy / len, uz = dz / len;
    const wallT = rayWalls(S.world.colliders, ox, oy, oz, ux, uy, uz, def.range);
    let hit = null;
    let hitT = wallT < 0 ? def.range : wallT;
    for (const target of S.combatants) {
      if (target === shooter || !target.alive) continue;
      if (target.team === shooter.team) continue;
      const headT = raySphere(ox, oy, oz, ux, uy, uz, target.x, target.eyeY + 0.08, target.z, 0.24, hitT);
      if (headT >= 0) { hit = { target, head: true, t: headT }; hitT = headT; continue; }
      const chestT = raySphere(ox, oy, oz, ux, uy, uz, target.x, target.eyeY - 0.45, target.z, 0.42, hitT);
      if (chestT >= 0) { hit = { target, head: false, t: chestT }; hitT = chestT; continue; }
      const legT = raySphere(ox, oy, oz, ux, uy, uz, target.x, 0.45, target.z, 0.4, hitT);
      if (legT >= 0) { hit = { target, head: false, t: legT }; hitT = legT; }
    }
    const endX = ox + ux * hitT, endY = oy + uy * hitT, endZ = oz + uz * hitT;
    if (hit) {
      const falloff = Math.max(0.4, 1 - hit.t / (def.range * 1.5));
      let dmg = def.damage * falloff * (hit.head ? def.headMult : 1);
      if (hit.target.armor > 0) {
        const absorbed = Math.min(hit.target.armor, dmg * 0.5);
        hit.target.armor -= absorbed;
        dmg -= absorbed;
      }
      hit.target.hp -= dmg;
      hit.target.lastHitBy = shooter;
      const killed = hit.target.hp <= 0;
      if (killed) hit.target.hp = 0;
      if (!best || hit.t < best.t) {
        best = { hit: true, head: hit.head, kill: killed, target: hit.target, t: hit.t, damage: dmg, point: [endX, endY, endZ], wall: false };
      }
    } else if (!best) {
      best = { hit: false, t: hitT, point: [endX, endY, endZ], wall: wallT >= 0 };
    }
  }
  best.weapon = def;
  best.origin = [ox, oy, oz];
  best.shooter = shooter;
  if (S.shots) S.shots.push(best);
  return best;
}

export function startReload(shooter) {
  const def = WEAPONS[shooter.loadout.current];
  const state = shooter.loadout.owned[shooter.loadout.current];
  if (!def || !state || shooter.reloadT > 0) return false;
  if (state.mag >= def.mag || state.reserve <= 0) return false;
  shooter.reloadT = def.reloadTime;
  return true;
}

export function finishReload(shooter) {
  const def = WEAPONS[shooter.loadout.current];
  const state = shooter.loadout.owned[shooter.loadout.current];
  if (!def || !state) return;
  const need = def.mag - state.mag;
  const take = Math.min(need, state.reserve);
  state.mag += take;
  state.reserve -= take;
}

// Throw a frag grenade from a combatant's eye. It bounces, fuses and bursts.
export function throwGrenade(S, thrower) {
  if (thrower.loadout.grenades <= 0) return false;
  thrower.loadout.grenades -= 1;
  const yaw = thrower.yaw, pitch = thrower.pitch || 0;
  const speed = 13;
  S.grenades.push({
    x: thrower.x, y: thrower.eyeY - 0.2, z: thrower.z,
    vx: -Math.sin(yaw) * Math.cos(pitch) * speed,
    vy: Math.sin(pitch) * speed + 2.5,
    vz: -Math.cos(yaw) * Math.cos(pitch) * speed,
    fuse: 1.6, owner: thrower, exploded: false,
  });
  return true;
}

export function updateGrenades(S, dt, onExplode) {
  for (let i = S.grenades.length - 1; i >= 0; i--) {
    const g = S.grenades[i];
    g.fuse -= dt;
    g.vy -= 14 * dt;
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
    if (g.y < 0.15) { g.y = 0.15; g.vy = -g.vy * 0.35; g.vx *= 0.7; g.vz *= 0.7; }
    if (g.fuse <= 0 && !g.exploded) {
      g.exploded = true;
      onExplode(g);
      S.grenades.splice(i, 1);
    }
  }
}

// Grenade burst: up to 90 damage at the centre, falling to 10 at 6 metres,
// halved through walls.
export function grenadeDamage(S, g) {
  const hits = [];
  for (const c of S.combatants) {
    if (!c.alive) continue;
    const dx = c.x - g.x, dy = (c.eyeY - 0.5) - g.y, dz = c.z - g.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 6) continue;
    let dmg = 90 * (1 - d / 6) + 10;
    // Halved when a wall stands between the burst and the combatant.
    const blocked = !losClearWall(S, g, c);
    if (blocked) dmg *= 0.5;
    if (c.armor > 0) {
      const absorbed = Math.min(c.armor, dmg * 0.5);
      c.armor -= absorbed;
      dmg -= absorbed;
    }
    c.hp -= dmg;
    c.lastHitBy = g.owner;
    if (c.hp <= 0) { c.hp = 0; }
    hits.push({ target: c, kill: c.hp <= 0, damage: dmg });
  }
  return hits;
}

import { losClear } from './world.js';
function losClearWall(S, g, c) {
  return losClear(S.world.colliders, g.x, g.y, g.z, c.x, c.eyeY - 0.5, c.z);
}
