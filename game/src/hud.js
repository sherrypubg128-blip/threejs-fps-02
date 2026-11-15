// hud.js — the DOM heads-up display: health, armour, ammo, money, timer,
// scores, alive counts, crosshair, hitmarker, kill feed, banners, the buy
// menu and the overlays. Writes are cached so the DOM is only touched when
// a value actually changes.
import { WEAPONS } from './weapons.js';
import { SHOP } from './rounds.js';
import { PHASE, PLANT_TIME } from './state.js';

export function createHud(S) {
  const $ = (id) => document.getElementById(id);
  const hud = {
    root: $('hud'),
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    ammoBox: $('ammo'),
    weaponName: $('weapon-name'),
    healthNum: $('health-num'),
    healthBar: $('health-bar'),
    armorNum: $('armor-num'),
    money: $('money'),
    timer: $('timer'),
    score: $('score'),
    alive: $('alive'),
    killfeed: $('killfeed'),
    banner: $('banner'),
    bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'),
    bombStatus: $('bomb-status'),
    plantBar: $('plant-bar'),
    plantFill: $('plant-fill'),
    vignette: $('vignette'),
    scope: $('scope'),
    menu: $('menu'),
    death: $('death'),
    match: $('match'),
    matchTitle: $('match-title'),
    buyMenu: $('buy-menu'),
    buyItems: $('buy-items'),
    buyMoney: $('buy-money'),
    grenades: $('grenades'),
    cache: {},
    lastEvent: 0,
    bannerUntil: 0,
    hitUntil: 0,
    buyOpen: false,
    onBuy: null,
  };
  // Build the buy menu rows once.
  for (const item of SHOP) {
    const row = document.createElement('div');
    row.className = 'buy-row';
    row.dataset.id = item.id;
    row.innerHTML = `<b>${item.name}</b><span>${item.desc}</span><em>$${item.price}</em>`;
    row.addEventListener('click', () => { if (hud.onBuy) hud.onBuy(item.id); });
    hud.buyItems.appendChild(row);
  }
  return hud;
}

function setText(hud, key, el, value) {
  if (hud.cache[key] !== value) { hud.cache[key] = value; el.textContent = value; }
}

function fmtTime(s) {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export function updateHud(S, hud, now) {
  const p = S.player;
  const def = WEAPONS[p.loadout.current];
  const st = p.loadout.owned[p.loadout.current];

  setText(hud, 'ammoMag', hud.ammoMag, st ? String(st.mag) : '—');
  setText(hud, 'ammoRes', hud.ammoReserve, st ? `/ ${st.reserve}` : '');
  setText(hud, 'weapon', hud.weaponName, def ? def.name : '');
  setText(hud, 'hp', hud.healthNum, String(Math.max(0, Math.min(100, Math.ceil(p.hp)))));
  setText(hud, 'armor', hud.armorNum, String(Math.ceil(p.armor)));
  setText(hud, 'money', hud.money, `$${p.money}`);
  setText(hud, 'gren', hud.grenades, p.loadout.grenades > 0 ? `◉×${p.loadout.grenades}` : '');
  hud.healthBar.style.width = `${Math.max(0, Math.min(100, p.hp))}%`;
  hud.healthBar.style.background = p.hp > 50 ? '#3fae6a' : p.hp > 25 ? '#f0a830' : '#e5484d';
  hud.ammoBox.classList.toggle('empty', !!(st && st.mag === 0));

  const phaseLabel = S.phase === PHASE.BUY ? 'BUY' : S.phase === PHASE.LIVE ? 'LIVE' : S.phase === PHASE.ROUND_END ? 'ROUND END' : '';
  setText(hud, 'timer', hud.timer, `${fmtTime(S.phaseTime)} ${phaseLabel}`);
  setText(hud, 'score', hud.score, `ATT ${S.score.attack} — ${S.score.defend} DEF · R${S.roundNumber}`);
  let att = 0, dfn = 0;
  for (const c of S.combatants) {
    if (!c.alive) continue;
    if (c.team === 'attack') att++;
    else dfn++;
  }
  setText(hud, 'alive', hud.alive, `${att}v${dfn}`);

  // Crosshair gap follows spread; hidden while scoped.
  const spread = p.alive ? (p.spreadNow || 0.012) : 0.012;
  const gap = 4 + spread * 900;
  hud.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
  hud.crosshair.style.display = p.scoped ? 'none' : 'block';
  hud.scope.style.display = p.scoped ? 'block' : 'none';

  // Hitmarker and banner lifetimes.
  hud.hitmarker.classList.toggle('on', now < hud.hitUntil);
  if (now > hud.bannerUntil) hud.banner.classList.add('hidden');

  // Damage vignette: hurt flash plus a low-health pulse.
  const low = p.alive && p.hp < 35 ? 0.25 + 0.15 * Math.sin(now * 5) : 0;
  hud.vignette.style.opacity = String(Math.min(0.85, p.hurtT * 1.4 + low));

  // Bomb status line (hidden on the menu, before the match starts).
  const b = S.bomb;
  let bombText = '';
  if (S.phase !== PHASE.MENU) {
    if (b.state === 'planted') bombText = `💣 BOMB PLANTED ${b.site} — ${b.timer.toFixed(0)}s`;
    else if (b.state === 'carried' && b.carrier === p) bombText = '💣 You carry the bomb — hold E at A or B';
    else if (b.state === 'carried' && b.carrier) bombText = `💣 ${b.carrier.name} carries the bomb`;
    else if (b.state === 'dropped') bombText = '💣 Bomb dropped — pick it up';
    else if (b.state === 'defused') bombText = 'Bomb defused';
  }
  setText(hud, 'bomb', hud.bombStatus, bombText);

  // Plant progress bar.
  if (b.progress > 0) {
    hud.plantBar.style.display = 'block';
    hud.plantFill.style.width = `${(b.progress / PLANT_TIME) * 100}%`;
  } else {
    hud.plantBar.style.display = 'none';
  }

  // Kill feed: drain new events.
  while (hud.lastEvent < S.events.length) {
    const ev = S.events[hud.lastEvent++];
    const div = document.createElement('div');
    div.textContent = ev.text;
    hud.killfeed.prepend(div);
    while (hud.killfeed.children.length > 5) hud.killfeed.lastChild.remove();
  }
  for (const child of hud.killfeed.children) {
    child.style.opacity = now - S.time > 6 ? '0' : '1';
  }

  // Buy menu money and affordability.
  if (hud.buyOpen) {
    setText(hud, 'buyMoney', hud.buyMoney, `$${p.money}`);
    for (const row of hud.buyItems.children) {
      const item = SHOP.find((s) => s.id === row.dataset.id);
      const owned = item.kind === 'weapon' && p.loadout.owned[item.id];
      row.classList.toggle('cant', p.money < item.price && !owned);
      row.classList.toggle('owned', !!owned);
    }
  }
}

export function showBanner(hud, title, sub, now, ms = 4000) {
  hud.bannerTitle.textContent = title;
  hud.bannerSub.textContent = sub || '';
  hud.banner.classList.remove('hidden');
  hud.bannerUntil = now + ms / 1000;
}

export function showHitmarker(hud, kill, now) {
  hud.hitmarker.classList.toggle('kill', kill);
  hud.hitUntil = now + 0.14;
}

export function setOverlay(hud, which) {
  // which: 'menu' | 'death' | 'match' | null
  hud.menu.classList.toggle('hidden', which !== 'menu');
  hud.death.classList.toggle('hidden', which !== 'death');
  hud.match.classList.toggle('hidden', which !== 'match');
}

export function setBuyOpen(hud, open) {
  hud.buyOpen = open;
  hud.buyMenu.classList.toggle('hidden', !open);
}
