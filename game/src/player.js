// player.js — the human player: WASD movement with acceleration and
// friction, crouching, jumping, AABB collision with the map, mouse-look
// camera with recoil, and the first-person view model of the current weapon.
import * as THREE from 'three';
import { clamp, moveWithCollision } from './util.js';
import { WEAPONS, createLoadout, startReload, finishReload, currentSpread } from './weapons.js';

const EYE_STAND = 1.62;
const EYE_CROUCH = 1.05;
const RADIUS = 0.35;
const GRAVITY = 13;
const JUMP_VEL = 4.6;

export function createPlayer(S) {
  const p = {
    id: 'player',
    name: 'You',
    team: 'attack',
    isPlayer: true,
    x: S.world.spawnAtt.x, z: S.world.spawnAtt.z,
    y: 0, vy: 0, vx: 0, vz: 0,
    yaw: 0, pitch: 0,
    eyeY: EYE_STAND,
    hp: 100, armor: 0, alive: true,
    crouched: false, walking: false, scoped: false,
    loadout: createLoadout(),
    fireT: 0, reloadT: 0, bloom: 0, recoil: 0,
    kills: 0, deaths: 0, money: 800,
    stepT: 0, hurtT: 0,
  };
  return p;
}

export function resetPlayer(S, p) {
  p.x = S.world.spawnAtt.x + (S.rng() - 0.5) * 2;
  p.z = S.world.spawnAtt.z + (S.rng() - 0.5) * 2;
  p.y = 0; p.vy = 0; p.vx = 0; p.vz = 0;
  p.yaw = 0; p.pitch = 0;
  p.hp = 100; p.armor = p.loadout.armor || 0;
  p.alive = true;
  p.processed = false;
  p.fireT = 0; p.reloadT = 0; p.bloom = 0; p.recoil = 0;
  p.crouched = false;
}

export function updatePlayer(S, p, input, dt) {
  if (!p.alive) return;
  // Look.
  const [ldx, ldy] = input.consumeLook();
  const sens = p.scoped ? 0.0011 : 0.0023;
  p.yaw -= ldx * sens;
  p.pitch = clamp(p.pitch - ldy * sens, -1.5, 1.5);

  // Recoil recovery and bloom decay.
  p.recoil = Math.max(0, p.recoil - dt * 3.2);
  p.bloom = Math.max(0, p.bloom - dt * 0.09);
  p.fireT = Math.max(0, p.fireT - dt);
  if (p.reloadT > 0) {
    p.reloadT -= dt;
    if (p.reloadT <= 0) finishReload(p);
  }
  p.hurtT = Math.max(0, p.hurtT - dt);

  p.crouched = input.keys.has('crouch');
  p.walking = input.keys.has('walk');
  const def = WEAPONS[p.loadout.current];
  const speedMul = def ? def.speed : 1;
  let maxSpeed = 5.2 * speedMul;
  if (p.crouched) maxSpeed = 2.2;
  else if (p.walking) maxSpeed = 2.8;
  if (p.scoped) maxSpeed = 2.0;

  // Acceleration from input, in camera space.
  let ix = 0, iz = 0;
  if (input.keys.has('forward')) iz -= 1;
  if (input.keys.has('back')) iz += 1;
  if (input.keys.has('left')) ix -= 1;
  if (input.keys.has('right')) ix += 1;
  const ilen = Math.hypot(ix, iz);
  if (ilen > 0) { ix /= ilen; iz /= ilen; }
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  const wx = ix * cos - iz * sin;
  const wz = ix * sin + iz * cos;
  const accel = p.y > 0.01 ? 14 : 42;
  p.vx += wx * accel * dt;
  p.vz += wz * accel * dt;
  // Friction.
  const fr = p.y > 0.01 ? 0.4 : 9;
  const damp = Math.max(0, 1 - fr * dt);
  p.vx *= damp; p.vz *= damp;
  const sp = Math.hypot(p.vx, p.vz);
  if (sp > maxSpeed) { p.vx *= maxSpeed / sp; p.vz *= maxSpeed / sp; }

  // Jump.
  if (input.consumePressed('jump') && p.y <= 0.01) p.vy = JUMP_VEL;
  p.vy -= GRAVITY * dt;
  p.y += p.vy * dt;
  if (p.y < 0) { p.y = 0; p.vy = 0; }

  // Move and collide, axis by axis, so sliding along walls works.
  moveWithCollision(S.world.colliders, p, p.vx * dt, 0);
  moveWithCollision(S.world.colliders, p, 0, p.vz * dt);

  p.eyeY = p.y + (p.crouched ? EYE_CROUCH : EYE_STAND);

  // Footstep sounds on a stride timer.
  if (sp > 1.5 && p.y <= 0.01) {
    p.stepT -= dt * sp;
    if (p.stepT <= 0) { p.stepT = 3.2; S.sounds.push(p.crouched || p.walking ? 'stepQuiet' : 'step'); }
  }

  // Reload key.
  if (input.consumePressed('KeyR')) {
    if (startReload(p)) S.sounds.push('reload');
  }
}

// Aim direction from yaw/pitch, with recoil applied as pitch kick.
export function aimDir(p, out) {
  const pitch = p.pitch + p.recoil * 0.02;
  out.x = -Math.sin(p.yaw) * Math.cos(pitch);
  out.y = Math.sin(pitch);
  out.z = -Math.cos(p.yaw) * Math.cos(pitch);
  return out;
}

export function playerSpread(p) {
  const def = WEAPONS[p.loadout.current];
  return def ? currentSpread(def, p) : 0.02;
}

// Build the first-person view model: a simple gun of boxes parented to the
// camera, recoloured per weapon. Rebuilt when the weapon changes.
export function buildViewModel() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.45, metalness: 0.7 });
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.8, metalness: 0.2 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xd9a520, roughness: 0.5, metalness: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.55), bodyMat);
  body.position.set(0, -0.02, -0.1);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), bodyMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.005, -0.5);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.18, 0.09), gripMat);
  grip.position.set(0, -0.12, 0.08);
  grip.rotation.x = 0.35;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.02), accentMat);
  sight.position.set(0, 0.06, -0.3);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.08), gripMat);
  mag.position.set(0, -0.13, -0.12);
  mag.rotation.x = 0.15;
  g.add(body, barrel, grip, sight, mag);
  g.position.set(0.22, -0.22, -0.45);
  return g;
}
