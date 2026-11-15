// main.js — bootstrap and the game loop. The simulation runs at a fixed
// 60 Hz, kept apart from rendering: updatePlayer, updateBots and
// updateRounds advance the state, the renderer only reads it. Shot visuals
// and sounds flow through queues the state owns, so nothing in the hot loop
// allocates.
import * as THREE from 'three';
import { createState, PHASE, ROUND_TIME, BOMB_TIMER } from './state.js';
import { makeTextures } from './textures.js';
import { buildWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer, updatePlayer, resetPlayer, aimDir, playerSpread, buildViewModel } from './player.js';
import { createBots, updateBots } from './bots.js';
import { createEffects, spawnTracer, spawnMuzzle, spawnBurst, updateEffects } from './effects.js';
import { createHud, updateHud, showBanner, showHitmarker, setOverlay, setBuyOpen } from './hud.js';
import { startMatch, updateRounds, buyItem, explodeGrenade } from './rounds.js';
import { shoot, startReload, updateGrenades, WEAPONS } from './weapons.js';
import {
  initAudio, resumeAudio, setMuted, playShot, playDryFire, playReload,
  playHit, playHurt, playStep, playBeep, playPlant, playExplosion,
  playClick, playBuy, playRoundWin, playRoundLose, playGrenade,
} from './audio.js';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') || 1) || 1;
const shotMode = params.get('shot'); // 'menu' | 'game' | 'buy' | 'site'

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 220);
scene.add(camera);

const textures = makeTextures();
const world = buildWorld(scene, textures);
const S = createState(seed);
S.world = world;
S.shotMode = shotMode;
const player = createPlayer(S);
S.player = player;
createBots(S, scene);
const fx = createEffects(scene);
const input = createInput(renderer.domElement);
const hud = createHud(S);
const viewModel = buildViewModel();
camera.add(viewModel);
initAudio();

hud.onBuy = (id) => { buyItem(S, id); };

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---- Shot modes: deterministic staged scenes for screenshots. ----
function setupShotMode() {
  if (!shotMode || shotMode === 'menu') return;
  startMatch(S);
  if (shotMode === 'game') {
    S.phase = PHASE.LIVE;
    S.phaseTime = ROUND_TIME;
    // Clear view down mid from the attacker spawn, rifle in hand.
    player.x = 0; player.z = 18; player.yaw = 0.05; player.pitch = 0;
    player.loadout.owned.rifle = { mag: 30, reserve: 90 };
    player.loadout.current = 'rifle';
    player.hp = 100000; // the staged scene is for the camera, not the score
    // Three defenders hold mid, facing the player, so the frame has a fight.
    const defs = S.bots.filter((b) => b.team === 'defend');
    defs[0].x = -3; defs[0].z = 7; defs[0].yaw = Math.PI; defs[0].holdX = -3; defs[0].holdZ = 7;
    defs[1].x = 4; defs[1].z = 3; defs[1].yaw = Math.PI; defs[1].holdX = 4; defs[1].holdZ = 3;
    defs[2].x = -1; defs[2].z = -2; defs[2].yaw = Math.PI;
  } else if (shotMode === 'buy') {
    player.money = 8000;
    setBuyOpen(hud, true);
  } else if (shotMode === 'site') {
    S.phase = PHASE.LIVE;
    S.phaseTime = ROUND_TIME;
    S.bomb.state = 'planted';
    S.bomb.site = 'A';
    S.bomb.timer = 32;
    S.bomb.x = -24; S.bomb.z = -14;
    player.x = -18; player.z = -8; player.yaw = 0.785; player.pitch = -0.05;
    player.loadout.owned.rifle = { mag: 30, reserve: 90 };
    player.loadout.current = 'rifle';
    player.hp = 100000; // the staged scene is for the camera, not the score
    const defs = S.bots.filter((b) => b.team === 'defend');
    defs[0].x = -24; defs[0].z = -10; defs[0].yaw = Math.PI; defs[0].holdX = -24; defs[0].holdZ = -10;
    defs[1].x = -20; defs[1].z = -16; defs[1].yaw = Math.PI * 0.75;
  }
  setOverlay(hud, null);
}

// ---- Menu buttons ----
document.getElementById('play').addEventListener('click', () => {
  initAudio(); resumeAudio();
  input.requestLock();
  if (S.phase === PHASE.MENU) startMatch(S);
  setOverlay(hud, null);
  playClick();
});
document.getElementById('again').addEventListener('click', () => {
  startMatch(S);
  setOverlay(hud, null);
  input.requestLock();
});
renderer.domElement.addEventListener('click', () => {
  if (S.phase !== PHASE.MENU && !hud.buyOpen) input.requestLock();
});

const _dir = { x: 0, y: 0, z: 0 };
let prevFiring = false;
let lastPhase = S.phase;

function stepSim(dt) {
  S.time += dt;
  S.tick += 1;
  if (S.phase === PHASE.MENU) return;

  // Player.
  if (player.alive) {
    updatePlayer(S, player, input, dt);
    player.scoped = input.scoped && player.loadout.current === 'sniper';
    player.spreadNow = playerSpread(player);

    // Weapon switching.
    for (let slot = 1; slot <= 5; slot++) {
      if (input.consumePressed('Digit' + slot)) {
        const id = Object.keys(WEAPONS).find((k) => WEAPONS[k].slot === slot);
        if (id && player.loadout.owned[id]) {
          player.loadout.current = id;
          player.reloadT = 0;
          playClick();
        }
      }
    }
    // Buy menu toggle.
    if (input.consumePressed('KeyB') && S.phase === PHASE.BUY) {
      setBuyOpen(hud, !hud.buyOpen);
      playClick();
    }
    // Mute toggle.
    if (input.consumePressed('KeyM')) {
      S.muted = !S.muted;
      setMuted(S.muted);
    }

    // Firing: automatic weapons hold, semi-automatic need a fresh press.
    // In the staged 'game' shot the player fires on their own, so the
    // frame shows live gunfire.
    const def = WEAPONS[player.loadout.current];
    if (def && S.phase === PHASE.LIVE) {
      const wantFire = (input.firing || S.shotMode === 'game') && (def.auto || !prevFiring);
      if (wantFire) {
        aimDir(player, _dir);
        const res = shoot(S, player, _dir.x, _dir.y, _dir.z);
        if (res) {
          if (res.dry) {
            playDryFire();
            // In the staged shot the player keeps firing for the camera.
            if (S.shotMode === 'game') startReload(player);
          } else {
            playShot(def.id, false);
            if (res.hit) showHitmarker(hud, res.kill, S.time);
          }
        }
      }
    }
  }
  prevFiring = input.firing;

  // Bots, rounds, grenades.
  updateBots(S, dt);
  updateRounds(S, input, dt, fx);
  updateGrenades(S, dt, (g) => explodeGrenade(S, g, fx));

  // Round banners on phase change.
  if (S.phase !== lastPhase) {
    if (S.phase === PHASE.ROUND_END && S.roundWinner) {
      const won = S.roundWinner === 'attack';
      showBanner(hud, won ? 'ROUND WON' : 'ROUND LOST', S.roundReason, S.time, 4500);
    } else if (S.phase === PHASE.MATCH_END) {
      const won = S.matchWinner === 'attack';
      document.getElementById('match-title').textContent = won ? 'MATCH WON' : 'MATCH LOST';
      document.getElementById('match-sub').textContent = `Attackers ${S.score.attack} — ${S.score.defend} Defenders`;
      setOverlay(hud, 'match');
    } else if (S.phase === PHASE.BUY) {
      showBanner(hud, `ROUND ${S.roundNumber}`, 'Buy phase — press B for the buy menu', S.time, 3000);
    }
    lastPhase = S.phase;
  }
  if (!player.alive && S.phase === PHASE.LIVE) setOverlay(hud, 'death');
  else if (player.alive && S.phase !== PHASE.MENU && S.phase !== PHASE.MATCH_END) setOverlay(hud, null);

  // Drain shot visuals. Bursts closer than 1.5 m to the camera are skipped:
  // a hit on the player happens at the lens, and a burst there is a pink
  // fog instead of feedback. The hitmarker and the hurt sound carry it.
  const camPos = { x: player.x, y: player.eyeY, z: player.z };
  while (S.shots.length) {
    const sh = S.shots.shift();
    spawnTracer(fx, sh.origin, sh.point, camPos);
    const dirVec = { x: sh.point[0] - sh.origin[0], y: sh.point[1] - sh.origin[1], z: sh.point[2] - sh.origin[2] };
    if (sh.shooter === player) {
      // The player's own flash sits a little downrange and small, so it
      // reads as a flash instead of a wall of light across the lens.
      const dl = Math.hypot(dirVec.x, dirVec.y, dirVec.z) || 1;
      spawnMuzzle(fx, [
        sh.origin[0] + (dirVec.x / dl) * 0.7,
        sh.origin[1] + (dirVec.y / dl) * 0.7,
        sh.origin[2] + (dirVec.z / dl) * 0.7,
      ], dirVec, 0.3);
    } else {
      spawnMuzzle(fx, sh.origin, dirVec, 0.5);
    }
    const dCam = Math.hypot(sh.point[0] - camPos.x, sh.point[1] - camPos.y, sh.point[2] - camPos.z);
    if (dCam > 1.5) {
      if (sh.hit) spawnBurst(fx, sh.point, 0xcc2222, 8, 2, 1);
      else if (sh.wall) spawnBurst(fx, sh.point, 0xaaaaaa, 5, 2, 1);
    }
  }

  // Drain sounds.
  while (S.sounds.length) {
    const s = S.sounds.shift();
    if (s.startsWith('shot:')) {
      const [, w, d] = s.split(':');
      playShot(w, d === '1');
    } else if (s === 'step') playStep(true);
    else if (s === 'stepQuiet') playStep(false);
    else if (s === 'reload') playReload();
    else if (s === 'hurt') playHurt();
    else if (s === 'hitKill') playHit(true);
    else if (s === 'plant') playPlant();
    else if (s === 'explosion') playExplosion();
    else if (s === 'buy') playBuy();
    else if (s === 'roundWin') playRoundWin();
    else if (s === 'roundLose') playRoundLose();
    else if (s === 'grenade') playGrenade();
    else if (s === 'beep') playBeep();
  }
}

function render() {
  // Camera follows the player, with recoil pitch and trauma shake.
  S.shake = Math.max(0, S.shake - 0.02);
  const sh = S.shake * S.shake;
  camera.position.set(player.x, player.eyeY, player.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw + (Math.random() - 0.5) * sh * 0.05;
  camera.rotation.x = player.pitch + player.recoil * 0.02 + (Math.random() - 0.5) * sh * 0.05;
  camera.rotation.z = (Math.random() - 0.5) * sh * 0.02;
  // Scope zoom.
  const wantFov = player.scoped ? 30 : 75;
  if (Math.abs(camera.fov - wantFov) > 0.5) {
    camera.fov += (wantFov - camera.fov) * 0.25;
    camera.updateProjectionMatrix();
  }
  // View-model bob and recoil kick.
  const bob = Math.sin(player.stepT * 6) * 0.008 * Math.min(1, Math.hypot(player.vx, player.vz) / 5);
  viewModel.position.y = -0.22 + bob;
  viewModel.position.z = -0.45 + player.recoil * 0.03;
  viewModel.visible = player.alive;

  // Grenade meshes follow live grenades.
  for (let i = 0; i < fx.grenadeMeshes.length; i++) {
    const m = fx.grenadeMeshes[i];
    if (i < S.grenades.length) {
      const g = S.grenades[i];
      m.visible = true;
      m.position.set(g.x, g.y, g.z);
    } else m.visible = false;
  }

  updateEffects(fx, 1 / 60, S.time);
  updateHud(S, hud, S.time);
  renderer.render(scene, camera);
}

// Fixed-step loop: 60 Hz simulation, render as fast as the display allows.
const STEP = 1 / 60;
let acc = 0;
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;
  acc += dt;
  let n = 0;
  while (acc >= STEP && n < 5) {
    stepSim(STEP);
    acc -= STEP;
    n++;
  }
  if (n === 5) acc = 0;
  render();
}

setupShotMode();
if (!shotMode || shotMode === 'menu') setOverlay(hud, 'menu');
requestAnimationFrame(frame);
