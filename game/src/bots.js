// bots.js — the nine bots: four friendly attackers, five defenders. Each bot
// navigates the waypoint graph, holds angles, fights with reaction time and
// imperfect aim, reacts to sound, and plays the objective: the carrier
// plants at a site, the defenders converge and defuse. All decisions run on
// the simulation tick; rendering only reads the result.
import * as THREE from 'three';
import { clamp, moveWithCollision, randRange } from './util.js';
import { losClear, nearestNode, findPath, pointInSite } from './world.js';
import { WEAPONS, shoot, startReload, finishReload } from './weapons.js';
import { PALETTE } from './palette.js';
import { PLANT_TIME, DEFUSE_TIME, BOMB_TIMER, PHASE, TEAM } from './state.js';

const FRIENDLY_NAMES = ['Vex', 'Mara', 'Ivo', 'Kess'];
const ENEMY_NAMES = ['Rook', 'Fang', 'Hale', 'Onyx', 'Dusk'];
const EYE = 1.55;

function makeBotMesh(team) {
  const g = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: team === TEAM.ATTACK ? 0x2e4a6b : 0x6b2e2e, roughness: 0.85 });
  const vest = new THREE.MeshStandardMaterial({ color: team === TEAM.ATTACK ? PALETTE.attacker : PALETTE.defender, roughness: 0.6 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a586, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.5, metalness: 0.4 });
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.75, 0.18), cloth);
  legL.position.set(-0.11, 0.375, 0);
  const legR = legL.clone();
  legR.position.x = 0.11;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), cloth);
  torso.position.y = 1.06;
  const vestM = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.4, 0.34), vest);
  vestM.position.y = 1.1;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), skin);
  head.position.y = 1.55;
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.34), dark);
  helmet.position.y = 1.68;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.62), dark);
  gun.position.set(0.2, 1.15, -0.3);
  g.add(legL, legR, torso, vestM, head, helmet, gun);
  g.userData = { legL, legR, gun };
  // Health bar: two thin boxes above the head, always facing the camera.
  const barBg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.07, 0.01), new THREE.MeshBasicMaterial({ color: 0x111111 }));
  barBg.position.y = 1.95;
  const barFg = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.05, 0.012), new THREE.MeshBasicMaterial({ color: team === TEAM.ATTACK ? PALETTE.attacker : PALETTE.defender }));
  barFg.position.y = 1.95;
  barFg.position.z = 0.004;
  g.add(barBg, barFg);
  g.userData.barFg = barFg;
  return g;
}

export function createBots(S, scene) {
  const bots = [];
  for (let i = 0; i < 4; i++) {
    bots.push(makeBot(S, FRIENDLY_NAMES[i], TEAM.ATTACK, scene, 0.62 + i * 0.05));
  }
  for (let i = 0; i < 5; i++) {
    bots.push(makeBot(S, ENEMY_NAMES[i], TEAM.DEFEND, scene, 0.6 + i * 0.05));
  }
  S.bots = bots;
  S.combatants = [S.player, ...bots];
  return bots;
}

function makeBot(S, name, team, scene, skill) {
  const mesh = makeBotMesh(team);
  scene.add(mesh);
  return {
    id: 'bot-' + name, name, team, isPlayer: false,
    x: 0, z: 0, y: 0, vy: 0, vx: 0, vz: 0,
    yaw: 0, pitch: 0, eyeY: EYE,
    hp: 100, armor: 0, alive: true,
    crouched: false, walking: false, scoped: false,
    loadout: null, fireT: 0, reloadT: 0, bloom: 0, recoil: 0,
    skill, reaction: randRange(S.rng, 0.25, 0.5),
    state: 'route', path: null, pathI: 0,
    target: null, acquireT: 0, lastSeen: null,
    hearT: 0, hearX: 0, hearZ: 0,
    burstLeft: 0, burstPause: 0,
    strafeDir: 1, strafeT: 0,
    thinkT: 0, walkPhase: 0,
    role: 'support', site: 'A', holdX: 0, holdZ: 0, holdYaw: 0,
    channelT: 0, channelKind: null,
    mesh, kills: 0,
  };
}

export function resetBots(S) {
  const rng = S.rng;
  const sitePick = rng() < 0.5 ? 'A' : 'B';
  let ai = 0, di = 0;
  for (const b of S.bots) {
    b.hp = 100; b.armor = 0; b.alive = true;
    b.processed = false;
    b.fireT = 0; b.reloadT = 0; b.bloom = 0; b.recoil = 0;
    b.target = null; b.lastSeen = null; b.channelT = 0; b.channelKind = null;
    b.state = 'route'; b.path = null; b.pathI = 0;
    b.mesh.visible = true;
    b.mesh.rotation.set(0, 0, 0);
    b.mesh.position.y = 0;
    b.loadout = { owned: {}, current: 'rifle', grenades: 0 };
    if (b.team === TEAM.ATTACK) {
      const defs = ['rifle', 'rifle', 'smg', 'rifle'];
      const w = defs[ai % 4];
      b.loadout.owned[w] = { mag: WEAPONS[w].mag, reserve: WEAPONS[w].reserve };
      b.loadout.current = w;
      b.role = ai === 0 ? 'carrier' : 'support';
      b.lane = ai === 2 ? 'mid' : 'site';
      b.site = sitePick;
      b.x = S.world.spawnAtt.x + (ai - 1.5) * 1.6;
      b.z = S.world.spawnAtt.z + (ai % 2) * 1.6;
      b.yaw = Math.PI; // face north, toward the sites
      ai++;
    } else {
      const defs = ['rifle', 'rifle', 'sniper', 'smg', 'rifle'];
      const w = defs[di % 5];
      b.loadout.owned[w] = { mag: WEAPONS[w].mag, reserve: WEAPONS[w].reserve };
      b.loadout.current = w;
      b.role = 'holder';
      b.site = di < 2 ? 'A' : di < 4 ? 'B' : 'mid';
      b.x = S.world.spawnDef.x + (di - 2) * 1.6;
      b.z = S.world.spawnDef.z - (di % 2) * 1.6;
      b.yaw = 0; // face south
      di++;
    }
    b.mesh.position.set(b.x, 0, b.z);
    b.mesh.rotation.y = b.yaw;
    b.eyeY = EYE;
    if (b.team === TEAM.DEFEND) {
      if (b.site === 'A') { b.holdX = -20 + rng() * 4; b.holdZ = -10 + rng() * 4; }
      else if (b.site === 'B') { b.holdX = 20 + rng() * 4; b.holdZ = -10 + rng() * 4; }
      else { b.holdX = (rng() - 0.5) * 8; b.holdZ = -6 + rng() * 4; }
      b.holdYaw = Math.atan2(-(b.holdX - 0), -(b.holdZ - 18));
    }
  }
}

// A bot hears a shot: remember where, investigate if idle.
export function botHearsShot(S, x, z) {
  for (const b of S.bots) {
    if (!b.alive) continue;
    const d = Math.hypot(b.x - x, b.z - z);
    if (d < 26) { b.hearT = S.time; b.hearX = x; b.hearZ = z; }
  }
}

function pickTarget(S, b) {
  let best = null, bestScore = 1e9;
  for (const c of S.combatants) {
    if (c === b || !c.alive || c.team === b.team) continue;
    const dx = c.x - b.x, dz = c.z - b.z;
    const d = Math.hypot(dx, dz);
    if (d > 48) continue;
    // In front: within a 110-degree cone.
    const ang = Math.atan2(-dx, -dz);
    let diff = ang - b.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) > 1.0 && d > 6) continue;
    if (!losClear(S.world.colliders, b.x, b.eyeY, b.z, c.x, c.eyeY, c.z)) continue;
    const score = d + (c.isPlayer ? -4 : 0);
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best;
}

function aimAt(S, b, target, out) {
  // Ideal direction to the target's chest, plus an error that grows with
  // distance, target speed and the bot's own movement, and shrinks with skill.
  const tx = target.x, ty = target.eyeY - 0.35, tz = target.z;
  let dx = tx - b.x, dy = ty - b.eyeY, dz = tz - b.z;
  const len = Math.hypot(dx, dy, dz);
  dx /= len; dy /= len; dz /= len;
  const tSpeed = Math.hypot(target.vx || 0, target.vz || 0);
  const bSpeed = Math.hypot(b.vx, b.vz);
  const err = (1 - b.skill) * 0.055 + len * 0.0009 + tSpeed * 0.004 + bSpeed * 0.012;
  const rx = (S.rng() - 0.5) * 2 * err, ry = (S.rng() - 0.5) * 2 * err;
  // Perturb in a plane perpendicular to the aim direction.
  const px = -dz, pz = dx;
  out.x = dx + px * rx;
  out.y = dy + ry;
  out.z = dz + pz * rx;
  const l2 = Math.hypot(out.x, out.y, out.z);
  out.x /= l2; out.y /= l2; out.z /= l2;
  return out;
}

const _dir = { x: 0, y: 0, z: 0 };

function botFire(S, b) {
  if (b.fireT > 0 || b.reloadT > 0) return;
  const def = WEAPONS[b.loadout.current];
  const st = b.loadout.owned[b.loadout.current];
  if (!st) return;
  if (st.mag <= 0) {
    if (startReload(b)) S.sounds.push('reload');
    return;
  }
  if (b.burstLeft <= 0) {
    if (b.burstPause > 0) return;
    b.burstLeft = def.auto ? 3 + ((S.rng() * 3) | 0) : 1;
  }
  b.burstLeft -= 1;
  if (b.burstLeft === 0) b.burstPause = def.auto ? 0.35 + S.rng() * 0.4 : 0;
  aimAt(S, b, b.target, _dir);
  const res = shoot(S, b, _dir.x, _dir.y, _dir.z);
  if (res) {
    S.sounds.push('shot:' + def.id + ':' + (b.isPlayer ? 0 : 1));
    botHearsShot(S, b.x, b.z);
    if (res.hit && res.target.isPlayer) S.sounds.push('hurt');
    if (res.hit) {
      // The shooter learns exactly where the target is.
      b.lastSeen = { x: res.target.x, z: res.target.z, t: S.time };
    }
  }
}

function steerTo(S, b, tx, tz, speed, dt) {
  const dx = tx - b.x, dz = tz - b.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.4) return true;
  const ux = dx / d, uz = dz / d;
  const targetYaw = Math.atan2(-ux, -uz);
  let dy = targetYaw - b.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  b.yaw += clamp(dy, -3.2 * dt, 3.2 * dt);
  b.vx = ux * speed; b.vz = uz * speed;
  moveWithCollision(S.world.colliders, b, b.vx * dt, 0);
  moveWithCollision(S.world.colliders, b, 0, b.vz * dt);
  b.walkPhase += dt * speed * 1.6;
  return d < 0.6;
}

function followPath(S, b, speed, dt) {
  if (!b.path || b.pathI >= b.path.length) return true;
  const node = S.world.waypoints[b.path[b.pathI]];
  if (steerTo(S, b, node.x, node.z, speed, dt)) b.pathI += 1;
  return b.pathI >= b.path.length;
}

function setPath(S, b, tx, tz) {
  b.path = findPath(S.world.waypoints, { x: b.x, z: b.z }, { x: tx, z: tz });
  b.pathI = b.path ? 1 : 0;
}

export function updateBots(S, dt) {
  for (const b of S.bots) {
    if (!b.alive) continue;
    b.thinkT -= dt;
    b.burstPause = Math.max(0, b.burstPause - dt);
    b.fireT = Math.max(0, b.fireT - dt);
    b.recoil = Math.max(0, b.recoil - dt * 3.2);
    b.bloom = Math.max(0, b.bloom - dt * 0.09);
    if (b.reloadT > 0) {
      b.reloadT -= dt;
      if (b.reloadT <= 0) finishReload(b);
    }

    // Think at 10 Hz: pick a target and a state. Bots hold fire outside
    // live play (buy phase, round end).
    if (b.thinkT <= 0) {
      b.thinkT = 0.1;
      const seen = S.phase === PHASE.LIVE ? pickTarget(S, b) : null;
      if (seen) {
        if (b.target !== seen) { b.acquireT = S.time + b.reaction; }
        b.target = seen;
        b.lastSeen = { x: seen.x, z: seen.z, t: S.time };
      } else if (b.target && S.time - (b.lastSeen ? b.lastSeen.t : 0) > 1.2) {
        b.target = null;
      }
      decide(S, b);
    }

    // Act. A channel breaks the moment an enemy is seen.
    if (b.channelKind && b.target) { b.channelKind = null; b.channelT = 0; }
    if (b.target && S.time >= b.acquireT) {
      // Face the target and fight.
      const dx = b.target.x - b.x, dz = b.target.z - b.z;
      const want = Math.atan2(-dx, -dz);
      let dy = want - b.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      b.yaw += clamp(dy, -4 * dt, 4 * dt);
      // Strafe while fighting.
      b.strafeT -= dt;
      if (b.strafeT <= 0) { b.strafeT = 0.7 + S.rng() * 0.8; b.strafeDir *= -1; }
      const sx = Math.cos(b.yaw) * b.strafeDir, sz = -Math.sin(b.yaw) * b.strafeDir;
      b.vx = sx * 1.6; b.vz = sz * 1.6;
      moveWithCollision(S.world.colliders, b, b.vx * dt, 0);
      moveWithCollision(S.world.colliders, b, 0, b.vz * dt);
      botFire(S, b);
    } else if (b.channelKind) {
      // Planting or defusing: stand still.
      b.vx = 0; b.vz = 0;
    } else if (b.state === 'hold') {
      // Hold an angle: stand at the hold spot, slowly scanning.
      if (Math.hypot(b.holdX - b.x, b.holdZ - b.z) > 0.8) {
        steerTo(S, b, b.holdX, b.holdZ, 3.2, dt);
      } else {
        b.vx = 0; b.vz = 0;
        b.yaw += Math.sin(S.time * 0.4 + b.x) * 0.0012;
      }
    } else {
      // Route: follow the path.
      const speed = b.state === 'retreat' ? 4.6 : 4.0;
      if (followPath(S, b, speed, dt) && b.state === 'route') b.state = 'hold';
      // Investigate a heard shot when idle.
      if (S.time - b.hearT < 2 && !b.target && b.state === 'hold') {
        setPath(S, b, b.hearX, b.hearZ);
        b.state = 'route';
      }
    }

    // Sync the mesh.
    b.mesh.position.set(b.x, 0, b.z);
    b.mesh.rotation.y = b.yaw;
    const moving = Math.hypot(b.vx, b.vz) > 0.5;
    const swing = moving ? Math.sin(b.walkPhase) * 0.45 : 0;
    b.mesh.userData.legL.rotation.x = swing;
    b.mesh.userData.legR.rotation.x = -swing;
    b.mesh.userData.barFg.scale.x = Math.max(0.01, b.hp / 100);
    b.mesh.userData.barFg.position.x = -0.29 * (1 - b.hp / 100);
  }
}

function decide(S, b) {
  const bomb = S.bomb;
  if (b.team === TEAM.DEFEND) {
    if (bomb.state === 'planted') {
      // Converge on the planted site; defuse when close and the site is clear.
      const site = S.world.sites[bomb.site];
      const d = Math.hypot(site.cx - b.x, site.cz - b.z);
      if (d < 2.2 && !b.target) {
        b.channelKind = 'defuse';
        b.channelT += 0.1;
        if (b.channelT >= DEFUSE_TIME) {
          bomb.state = 'defused';
          b.channelT = 0; b.channelKind = null;
        }
        return;
      }
      b.channelKind = null; b.channelT = 0;
      if (b.state !== 'route' || !b.path) setPath(S, b, site.cx, site.cz);
      b.state = 'route';
      return;
    }
    // No bomb down: hold the assigned site or mid.
    if (b.state !== 'hold' && b.state !== 'route') b.state = 'hold';
    if (b.state === 'hold' && Math.hypot(b.holdX - b.x, b.holdZ - b.z) > 12) {
      setPath(S, b, b.holdX, b.holdZ);
      b.state = 'route';
    }
    return;
  }

  // Attackers.
  if (bomb.state === 'planted') {
    // Hold the site.
    const site = S.world.sites[bomb.site];
    if (Math.hypot(site.cx - b.x, site.cz - b.z) > 6) {
      setPath(S, b, site.cx, site.cz);
      b.state = 'route';
    } else b.state = 'hold';
    return;
  }
  if (b.role === 'carrier' && bomb.carrier === b) {
    const site = S.world.sites[b.site];
    const d = Math.hypot(site.cx - b.x, site.cz - b.z);
    if (d < 2.4 && !b.target) {
      b.channelKind = 'plant';
      b.channelT += 0.1;
      if (b.channelT >= PLANT_TIME) {
        bomb.state = 'planted';
        bomb.site = b.site;
        bomb.timer = BOMB_TIMER;
        bomb.planter = b;
        b.channelT = 0; b.channelKind = null;
        S.sounds.push('plant');
      }
      return;
    }
    b.channelKind = null; b.channelT = 0;
    if (b.state !== 'route' || !b.path) setPath(S, b, site.cx, site.cz);
    b.state = 'route';
    return;
  }
  // Support attackers: push the same site, or run mid to split the defence.
  const site = S.world.sites[b.site];
  const tx = b.lane === 'mid' ? 0 : site.cx;
  const tz = b.lane === 'mid' ? 0 : site.cz;
  if (b.state !== 'route' || !b.path) setPath(S, b, tx, tz);
  b.state = 'route';
}

// Deaths are processed centrally each tick: fall over, drop the bomb,
// feed the kill feed, and count the kill. The killer is whoever last hit
// the victim (recorded by shoot() and grenadeDamage()).
export function processDeaths(S) {
  for (const c of S.combatants) {
    if (!c.alive || c.hp > 0) continue;
    if (c.processed) continue;
    c.processed = true;
    c.alive = false;
    c.deaths = (c.deaths || 0) + 1;
    const killer = c.lastHitBy || null;
    c.lastHitBy = null;
    if (killer) {
      killer.kills = (killer.kills || 0) + 1;
      S.events.push({ text: `${killer.name} ▸ ${c.name}`, t: S.time });
      if (killer.isPlayer) {
        killer.money = (killer.money || 0) + 300;
        S.sounds.push('hitKill');
      }
    } else {
      S.events.push({ text: `${c.name} died`, t: S.time });
    }
    if (c === S.bomb.carrier) {
      S.bomb.carrier = null;
      S.bomb.state = 'dropped';
      S.bomb.x = c.x; S.bomb.z = c.z;
    }
    if (!c.isPlayer && c.mesh) {
      c.mesh.rotation.x = -Math.PI / 2;
      c.mesh.position.y = 0.25;
    }
    if (c.isPlayer) S.sounds.push('hurt');
  }
  // A dropped bomb is picked up by the nearest living attacker.
  if (S.bomb.state === 'dropped') {
    let best = null, bd = 2.2;
    for (const c of S.combatants) {
      if (!c.alive || c.team !== TEAM.ATTACK) continue;
      const d = Math.hypot(c.x - S.bomb.x, c.z - S.bomb.z);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) {
      S.bomb.carrier = best;
      S.bomb.state = 'carried';
      if (best.isPlayer) S.events.push({ text: 'You picked up the bomb', t: S.time });
      else best.role = 'carrier';
    }
  }
}
