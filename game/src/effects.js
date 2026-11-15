// effects.js — tracers, impact particles, muzzle flashes and explosions.
// Everything is pooled and preallocated: the render loop never creates
// objects. The simulation calls the spawn functions; update() advances them.
import * as THREE from 'three';

const MAX_TRACERS = 24;
const MAX_PARTICLES = 320;

// Soft round sprite for impact particles: a radial dot, never a square,
// so bursts read as sparks and dust instead of confetti.
function makeDotTexture() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export function createEffects(scene) {
  const fx = { scene, tracers: [], particles: null, pData: [], flash: null, flashLight: null, bombMesh: null, explosion: null };

  // Tracer pool: thin stretched boxes, additive.
  const tracerGeo = new THREE.BoxGeometry(0.025, 0.025, 1);
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  for (let i = 0; i < MAX_TRACERS; i++) {
    const m = new THREE.Mesh(tracerGeo, tracerMat);
    m.visible = false;
    scene.add(m);
    fx.tracers.push({ mesh: m, life: 0 });
  }

  // Particle pool: one Points cloud, positions and colours written in place.
  const pos = new Float32Array(MAX_PARTICLES * 3);
  const col = new Float32Array(MAX_PARTICLES * 3);
  for (let i = 0; i < MAX_PARTICLES; i++) pos[i * 3 + 1] = -100;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, map: makeDotTexture() });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  fx.particles = points;
  for (let i = 0; i < MAX_PARTICLES; i++) {
    fx.pData.push({ life: 0, vx: 0, vy: 0, vz: 0 });
  }
  fx.pNext = 0;

  // Muzzle flash: a small additive plane plus a light, reused by everyone.
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffc861, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  fx.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), flashMat);
  fx.flash.visible = false;
  scene.add(fx.flash);
  fx.flashLight = new THREE.PointLight(0xffb347, 0, 12, 1.8);
  scene.add(fx.flashLight);

  // Explosion shell: an expanding transparent sphere.
  const expMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  fx.explosion = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), expMat);
  fx.explosion.visible = false;
  scene.add(fx.explosion);
  fx.explosionLight = new THREE.PointLight(0xff7a2a, 0, 30, 1.6);
  scene.add(fx.explosionLight);
  fx.explosionT = 0;

  // The planted bomb: a dark box with a blinking red light.
  const bomb = new THREE.Group();
  const bombBody = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.22, 0.3), new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.4, metalness: 0.6 }));
  const bombLight = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.1), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
  bombLight.position.set(0, 0.14, 0);
  bomb.add(bombBody, bombLight);
  bomb.visible = false;
  scene.add(bomb);
  fx.bombMesh = bomb;
  fx.bombLight = bombLight;

  // Grenade meshes, one per live grenade.
  fx.grenadeMeshes = [];
  const gGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const gMat = new THREE.MeshStandardMaterial({ color: 0x2e4a2e, roughness: 0.5, metalness: 0.5 });
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(gGeo, gMat);
    m.visible = false;
    scene.add(m);
    fx.grenadeMeshes.push(m);
  }

  return fx;
}

const _v = new THREE.Vector3();

export function spawnTracer(fx, from, to, cam) {
  const t = fx.tracers.find((x) => x.life <= 0) || fx.tracers[0];
  // Keep the tracer out of the camera. A streak whose ray passes close to
  // the lens looks like a wide bright band, not a bullet. Two cases:
  // incoming fire (origin far away) ends 2.5 m before it passes the camera;
  // the player's own fire, which starts at the lens, only has its end
  // pulled back to 1.2 m. If nothing sensible is left, draw nothing.
  let ex = to[0], ey = to[1], ez = to[2];
  const len0 = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) || 1;
  const ux = (to[0] - from[0]) / len0, uy = (to[1] - from[1]) / len0, uz = (to[2] - from[2]) / len0;
  if (cam) {
    const ocx = cam.x - from[0], ocy = cam.y - from[1], ocz = cam.z - from[2];
    const dOrigin = Math.hypot(ocx, ocy, ocz);
    let tMin = ocx * ux + ocy * uy + ocz * uz;
    tMin = Math.max(0, Math.min(len0, tMin));
    const dMin = Math.hypot(
      cam.x - (from[0] + ux * tMin),
      cam.y - (from[1] + uy * tMin),
      cam.z - (from[2] + uz * tMin),
    );
    if (dOrigin > 2 && dMin < 1.0) {
      const endT = tMin - 2.5;
      if (endT < 0.5) return;
      ex = from[0] + ux * endT; ey = from[1] + uy * endT; ez = from[2] + uz * endT;
    } else if (dMin < 1.2) {
      const d = Math.hypot(ex - cam.x, ey - cam.y, ez - cam.z);
      if (d < 1.2) {
        const back = Math.min(1.2 - d + 0.1, len0 - 0.1);
        if (back <= 0) return;
        ex -= ux * back; ey -= uy * back; ez -= uz * back;
      }
    }
  }
  _v.set((from[0] + ex) / 2, (from[1] + ey) / 2, (from[2] + ez) / 2);
  t.mesh.position.copy(_v);
  t.mesh.lookAt(ex, ey, ez);
  const len = Math.hypot(ex - from[0], ey - from[1], ez - from[2]);
  t.mesh.scale.set(1, 1, Math.max(0.1, len));
  t.mesh.visible = true;
  t.life = 0.07;
}

export function spawnBurst(fx, point, color, count, speed, up = 2) {
  const pos = fx.particles.geometry.attributes.position.array;
  const col = fx.particles.geometry.attributes.color.array;
  const r = ((color >> 16) & 255) / 255, g = ((color >> 8) & 255) / 255, b = (color & 255) / 255;
  for (let n = 0; n < count; n++) {
    const i = fx.pNext;
    fx.pNext = (fx.pNext + 1) % MAX_PARTICLES;
    const d = fx.pData[i];
    d.life = 0.35 + Math.random() * 0.4;
    const th = Math.random() * Math.PI * 2, ph = Math.random() * Math.PI;
    const sp = speed * (0.4 + Math.random() * 0.8);
    d.vx = Math.sin(ph) * Math.cos(th) * sp;
    d.vy = Math.cos(ph) * sp * 0.6 + up;
    d.vz = Math.sin(ph) * Math.sin(th) * sp;
    pos[i * 3] = point[0]; pos[i * 3 + 1] = point[1]; pos[i * 3 + 2] = point[2];
    col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
  }
  fx.particles.geometry.attributes.position.needsUpdate = true;
  fx.particles.geometry.attributes.color.needsUpdate = true;
}

export function spawnMuzzle(fx, pos, dir, size = 0.5) {
  // dir is the shot direction; normalise it first, so the flash sits half
  // a metre from the muzzle instead of halfway to whatever was hit.
  // size scales the shared flash plane: the player's own flash uses a
  // small one, so it reads as a flash instead of a wall of light.
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const ux = dir.x / len, uy = dir.y / len, uz = dir.z / len;
  fx.flash.position.set(pos[0] + ux * 0.5, pos[1] + uy * 0.5, pos[2] + uz * 0.5);
  fx.flash.lookAt(pos[0] + ux * 2, pos[1] + uy * 2, pos[2] + uz * 2);
  fx.flash.scale.setScalar(size / 0.5);
  fx.flash.visible = true;
  fx.flash.material.opacity = 0.95;
  fx.flashLight.position.set(pos[0], pos[1], pos[2]);
  fx.flashLight.intensity = 14;
}

export function spawnExplosion(fx, pos) {
  fx.explosion.position.set(pos[0], pos[1], pos[2]);
  fx.explosion.visible = true;
  fx.explosionT = 0.7;
  fx.explosionLight.position.set(pos[0], pos[1] + 1, pos[2]);
  fx.explosionLight.intensity = 60;
  spawnBurst(fx, pos, 0xff7a2a, 60, 7, 4);
  spawnBurst(fx, pos, 0x333333, 40, 4, 5);
}

export function setBombMesh(fx, x, z, visible) {
  fx.bombMesh.position.set(x, 0.12, z);
  fx.bombMesh.visible = visible;
}

export function updateEffects(fx, dt, time) {
  for (const t of fx.tracers) {
    if (t.life > 0) {
      t.life -= dt;
      if (t.life <= 0) t.mesh.visible = false;
    }
  }
  const pos = fx.particles.geometry.attributes.position.array;
  let any = false;
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const d = fx.pData[i];
    if (d.life <= 0) continue;
    any = true;
    d.life -= dt;
    d.vy -= 9 * dt;
    pos[i * 3] += d.vx * dt;
    pos[i * 3 + 1] += d.vy * dt;
    pos[i * 3 + 2] += d.vz * dt;
    if (d.life <= 0 || pos[i * 3 + 1] < 0.02) {
      d.life = 0;
      pos[i * 3 + 1] = -100;
    }
  }
  if (any) fx.particles.geometry.attributes.position.needsUpdate = true;
  if (fx.flash.visible) {
    fx.flash.material.opacity -= dt * 14;
    fx.flashLight.intensity = Math.max(0, fx.flashLight.intensity - dt * 220);
    if (fx.flash.material.opacity <= 0) fx.flash.visible = false;
  }
  if (fx.explosionT > 0) {
    fx.explosionT -= dt;
    const k = 1 - fx.explosionT / 0.7;
    fx.explosion.scale.setScalar(1 + k * 9);
    fx.explosion.material.opacity = 0.55 * (1 - k);
    fx.explosionLight.intensity = Math.max(0, fx.explosionLight.intensity - dt * 120);
    if (fx.explosionT <= 0) fx.explosion.visible = false;
  }
  if (fx.bombMesh.visible) {
    fx.bombLight.material.color.setHex(Math.sin(time * 10) > 0 ? 0xff2222 : 0x440000);
  }
}
