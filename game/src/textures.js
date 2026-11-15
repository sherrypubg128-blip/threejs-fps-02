// textures.js — every texture in Foundry Yard is drawn once on a canvas at
// load time. No image files, no network: concrete, rust, hazard stripes,
// crate faces and a site marker, all from the same dusk palette. Canvases
// are 256x256 (sites 128x128) and repeat-wrapped, so one texture covers a
// whole wall without stretching.
import { PALETTE } from './palette.js';
import * as THREE from 'three';

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  return [c, c.getContext('2d')];
}

function speckle(ctx, size, n, colors, rng) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[(rng() * colors.length) | 0];
    ctx.globalAlpha = 0.08 + rng() * 0.16;
    const s = 1 + rng() * 3;
    ctx.fillRect(rng() * size, rng() * size, s, s);
  }
  ctx.globalAlpha = 1;
}

function toTexture(c, repeat = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Deterministic texture RNG so the map looks the same every load.
function texRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeTextures() {
  const rng = texRng(1337);
  const out = {};

  // Yard floor: stained concrete with expansion joints.
  {
    const [c, ctx] = canvas(256);
    ctx.fillStyle = '#6f6a63'; ctx.fillRect(0, 0, 256, 256);
    speckle(ctx, 256, 900, ['#7d7871', '#5d5955', '#8a8580', '#4e4a46'], rng);
    ctx.strokeStyle = 'rgba(30,28,26,0.55)'; ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * 64, 0); ctx.lineTo(i * 64, 256); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * 64); ctx.lineTo(256, i * 64); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(40,36,32,0.25)';
    for (let i = 0; i < 12; i++) ctx.fillRect(rng() * 256, rng() * 256, 20 + rng() * 50, 8 + rng() * 20);
    out.floor = toTexture(c, 8);
  }

  // Wall concrete: pale, panelled, with grime at the base.
  {
    const [c, ctx] = canvas(256);
    ctx.fillStyle = '#8a8580'; ctx.fillRect(0, 0, 256, 256);
    speckle(ctx, 256, 700, ['#98938c', '#77726c', '#6a655f'], rng);
    ctx.strokeStyle = 'rgba(40,38,34,0.4)'; ctx.lineWidth = 2;
    ctx.strokeRect(4, 4, 248, 248);
    ctx.beginPath(); ctx.moveTo(0, 128); ctx.lineTo(256, 128); ctx.stroke();
    const grad = ctx.createLinearGradient(0, 180, 0, 256);
    grad.addColorStop(0, 'rgba(30,26,22,0)'); grad.addColorStop(1, 'rgba(30,26,22,0.45)');
    ctx.fillStyle = grad; ctx.fillRect(0, 180, 256, 76);
    out.wall = toTexture(c, 2);
  }

  // Corrugated rust metal for containers and doors.
  {
    const [c, ctx] = canvas(256);
    ctx.fillStyle = '#7a4023'; ctx.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 16) {
      ctx.fillStyle = (x / 16) % 2 ? 'rgba(0,0,0,0.22)' : 'rgba(255,180,120,0.10)';
      ctx.fillRect(x, 0, 8, 256);
    }
    speckle(ctx, 256, 500, ['#5e3018', '#96522c', '#4a2412'], rng);
    ctx.fillStyle = 'rgba(20,14,10,0.35)'; ctx.fillRect(0, 240, 256, 16);
    out.rust = toTexture(c, 2);
  }

  // Crate: stencilled metal panels with edge wear.
  {
    const [c, ctx] = canvas(256);
    ctx.fillStyle = '#51606b'; ctx.fillRect(0, 0, 256, 256);
    speckle(ctx, 256, 500, ['#5d6e79', '#42525d', '#6b7c88'], rng);
    ctx.strokeStyle = 'rgba(20,24,28,0.6)'; ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, 240, 240);
    ctx.beginPath(); ctx.moveTo(8, 8); ctx.lineTo(248, 248); ctx.moveTo(248, 8); ctx.lineTo(8, 248); ctx.stroke();
    ctx.fillStyle = 'rgba(217,165,32,0.85)';
    ctx.font = 'bold 28px monospace'; ctx.textAlign = 'center';
    ctx.fillText('FY-07', 128, 140);
    out.crate = toTexture(c, 1);
  }

  // Hazard stripes for site thresholds and the plant zone edge.
  {
    const [c, ctx] = canvas(128);
    ctx.fillStyle = '#d9a520'; ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#1c1a18';
    for (let i = -128; i < 256; i += 32) {
      ctx.beginPath();
      ctx.moveTo(i, 128); ctx.lineTo(i + 16, 128); ctx.lineTo(i + 16 + 128, 0); ctx.lineTo(i + 128, 0);
      ctx.closePath(); ctx.fill();
    }
    out.hazard = toTexture(c, 1);
  }

  // Bomb-site marker: a big letter on the ground, drawn as a texture.
  out.siteMarker = (letter, color) => {
    const [c, ctx] = canvas(256);
    ctx.clearRect(0, 0, 256, 256);
    ctx.strokeStyle = color; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(128, 128, 100, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = color; ctx.font = 'bold 150px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(letter, 128, 136);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };

  return out;
}
