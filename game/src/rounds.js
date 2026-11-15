// rounds.js — round flow, economy, the buy menu and the bomb.
// A match is first to 8 round wins. Each round: a 12 s buy phase, live play
// until elimination, detonation, defusal or the timer, then a 5 s banner and
// the next round. The player carries the bomb at round start and plants it
// by holding E inside a site; defenders defuse by standing at a planted
// bomb. Losing pays less than winning, with a small loss-streak bonus.
import { PHASE, MATCH_WIN_ROUNDS, ROUND_TIME, BUY_TIME, BOMB_TIMER, PLANT_TIME, DEFUSE_TIME, TEAM } from './state.js';
import { WEAPONS, GRENADE_PRICE, ARMOR_PRICE, createLoadout, grenadeDamage, throwGrenade } from './weapons.js';
import { resetPlayer } from './player.js';
import { resetBots, processDeaths } from './bots.js';
import { pointInSite } from './world.js';
import { spawnExplosion, spawnBurst, setBombMesh } from './effects.js';

export const SHOP = [
  { id: 'rifle', name: 'AR-77 Longshot', kind: 'weapon', price: 2700, desc: 'Accurate automatic rifle' },
  { id: 'smg', name: 'VK-9 Ripper', kind: 'weapon', price: 1500, desc: 'Fast close-quarters SMG' },
  { id: 'shotgun', name: 'M12 Breacher', kind: 'weapon', price: 1200, desc: 'Eight-pellet pump shotgun' },
  { id: 'sniper', name: 'L96 Deadeye', kind: 'weapon', price: 4750, desc: 'One-shot sniper, scope on right click' },
  { id: 'grenade', name: 'Frag grenade', kind: 'grenade', price: 300, desc: 'Timed burst, 6 m radius' },
  { id: 'armor', name: 'Body armour', kind: 'armor', price: 650, desc: 'Halves damage until it breaks' },
];

export function startMatch(S) {
  S.score.attack = 0; S.score.defend = 0;
  S.lossStreak.attack = 0; S.lossStreak.defend = 0;
  S.roundNumber = 0;
  S.matchWinner = null;
  S.player.loadout = createLoadout();
  S.player.loadout.armor = 0;
  S.player.money = 800;
  startRound(S);
}

export function startRound(S) {
  S.roundNumber += 1;
  S.phase = PHASE.BUY;
  S.phaseTime = BUY_TIME;
  S.roundWinner = null;
  S.roundReason = '';
  S.bomb = { state: 'carried', carrier: S.player, site: null, timer: 0, x: 0, z: 0, progress: 0, planter: null, defuser: null };
  resetPlayer(S, S.player);
  resetBots(S);
  S.grenades.length = 0;
  S.events.length = 0;
  S.events.push({ text: `Round ${S.roundNumber} — plant the bomb at A or B`, t: S.time });
}

export function buyItem(S, id) {
  const p = S.player;
  const item = SHOP.find((s) => s.id === id);
  if (!item || S.phase !== PHASE.BUY) return false;
  if (p.money < item.price) return false;
  if (item.kind === 'weapon') {
    if (p.loadout.owned[id]) return false;
    p.money -= item.price;
    p.loadout.owned[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
    p.loadout.current = id;
  } else if (item.kind === 'grenade') {
    if (p.loadout.grenades >= 2) return false;
    p.money -= item.price;
    p.loadout.grenades += 1;
  } else if (item.kind === 'armor') {
    if (p.armor >= 100) return false;
    p.money -= item.price;
    p.armor = 100;
    p.loadout.armor = 100;
  }
  S.sounds.push('buy');
  return true;
}

function aliveCount(S, team) {
  let n = 0;
  for (const c of S.combatants) if (c.alive && c.team === team) n++;
  return n;
}

function endRound(S, winner, reason) {
  S.phase = PHASE.ROUND_END;
  S.phaseTime = 5;
  S.roundWinner = winner;
  S.roundReason = reason;
  S.score[winner] += 1;
  const loser = winner === TEAM.ATTACK ? TEAM.DEFEND : TEAM.ATTACK;
  S.lossStreak[winner] = 0;
  S.lossStreak[loser] += 1;
  // Economy: winners take $3,250, losers $1,900 plus $500 per straight loss.
  const loserPay = Math.min(3400, 1900 + 500 * (S.lossStreak[loser] - 1));
  for (const c of S.combatants) {
    if (c.team === winner) c.money = (c.money || 0) + 3250;
    else c.money = (c.money || 0) + loserPay;
  }
  S.sounds.push(winner === TEAM.ATTACK ? 'roundWin' : 'roundLose');
  S.events.push({ text: reason, t: S.time });
  if (S.score[winner] >= MATCH_WIN_ROUNDS) {
    S.matchWinner = winner;
  }
}

// Player bomb handling: plant by holding E at a site while carrying the
// bomb. The planted bomb's countdown runs whether or not the player lives.
function updatePlayerBomb(S, input, dt) {
  const p = S.player;
  const bomb = S.bomb;
  if (bomb.state === 'planted') {
    bomb.timer -= dt;
    if (bomb.timer <= 0) {
      bomb.state = 'exploded';
      S.events.push({ text: 'The bomb detonated', t: S.time });
      S.sounds.push('explosion');
    }
    return;
  }
  if (!p.alive || S.phase !== PHASE.LIVE) { bomb.progress = 0; return; }
  if (bomb.state === 'carried' && bomb.carrier === p) {
    const site = Object.entries(S.world.sites).find(([, s]) => pointInSite(s, p.x, p.z));
    if (site && input.keys.has('use')) {
      bomb.progress += dt;
      bomb.site = site[0];
      if (bomb.progress >= PLANT_TIME) {
        bomb.state = 'planted';
        bomb.timer = BOMB_TIMER;
        bomb.x = p.x; bomb.z = p.z;
        bomb.planter = p;
        bomb.progress = 0;
        p.money += 300;
        S.sounds.push('plant');
        S.events.push({ text: 'Bomb planted at site ' + bomb.site, t: S.time });
      }
    } else {
      bomb.progress = 0;
    }
  }
}

export function updateRounds(S, input, dt, fx) {
  const p = S.player;

  // Grenade throws.
  if (S.phase === PHASE.LIVE && p.alive && input.consumePressed('KeyG')) {
    if (throwGrenade(S, p)) S.sounds.push('grenade');
  }

  if (S.phase === PHASE.BUY) {
    S.phaseTime -= dt;
    if (S.phaseTime <= 0) {
      S.phase = PHASE.LIVE;
      S.phaseTime = ROUND_TIME;
      S.events.push({ text: 'Round live — good luck', t: S.time });
    }
    return;
  }

  if (S.phase === PHASE.LIVE) {
    S.phaseTime -= dt;
    updatePlayerBomb(S, input, dt);
    processDeaths(S);

    // Bomb mesh follows the planted bomb.
    if (S.bomb.state === 'planted' && fx) setBombMesh(fx, S.bomb.x, S.bomb.z, true);
    else if (fx) setBombMesh(fx, 0, 0, false);

    const attAlive = aliveCount(S, TEAM.ATTACK);
    const defAlive = aliveCount(S, TEAM.DEFEND);
    if (S.bomb.state === 'exploded') {
      if (fx) spawnExplosion(fx, [S.bomb.x, 0.5, S.bomb.z]);
      S.shake = 1;
      endRound(S, TEAM.ATTACK, 'Bomb detonated — attackers take the round');
    } else if (S.bomb.state === 'defused') {
      endRound(S, TEAM.DEFEND, 'Bomb defused — defenders take the round');
    } else if (attAlive === 0 && S.bomb.state !== 'planted') {
      endRound(S, TEAM.DEFEND, 'Attackers eliminated — defenders take the round');
    } else if (attAlive === 0 && S.bomb.state === 'planted') {
      // Attackers all dead with the bomb down: defenders win only if the
      // timer runs out; the round continues while they defuse.
      if (defAlive === 0) endRound(S, TEAM.ATTACK, 'Defenders eliminated — attackers take the round');
    } else if (defAlive === 0) {
      endRound(S, TEAM.ATTACK, 'Defenders eliminated — attackers take the round');
    } else if (S.phaseTime <= 0) {
      if (S.bomb.state === 'planted') {
        // Timer already handled by the bomb countdown; this is a fallback.
        endRound(S, TEAM.ATTACK, 'Time expired with the bomb down — attackers take the round');
      } else {
        endRound(S, TEAM.DEFEND, 'Time expired — defenders take the round');
      }
    }
    return;
  }

  if (S.phase === PHASE.ROUND_END) {
    S.phaseTime -= dt;
    if (S.phaseTime <= 0) {
      if (S.matchWinner) {
        S.phase = PHASE.MATCH_END;
      } else {
        startRound(S);
      }
    }
  }
}

// Grenade bursts resolve through this hook from main.js.
export function explodeGrenade(S, g, fx) {
  const hits = grenadeDamage(S, g);
  if (fx) {
    spawnExplosion(fx, [g.x, g.y, g.z]);
    spawnBurst(fx, [g.x, g.y, g.z], 0xffa040, 30, 5, 3);
  }
  S.shake = Math.max(S.shake, 0.7);
  S.sounds.push('explosion');
  for (const h of hits) {
    if (h.kill && h.target.isPlayer) S.sounds.push('hurt');
  }
  processDeaths(S);
}
