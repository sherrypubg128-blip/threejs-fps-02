// state.js — the one place the game state lives. Every module reads and
// writes this object; nothing else keeps authoritative game state. The
// simulation owns it, the renderer only reads it. Two queues live here:
// events (kill feed, round notes) and sounds, drained once per frame.
import { mulberry32 } from './util.js';

export const TEAM = { ATTACK: 'attack', DEFEND: 'defend' };
export const PHASE = {
  MENU: 'menu',
  BUY: 'buy',
  LIVE: 'live',
  ROUND_END: 'roundEnd',
  MATCH_END: 'matchEnd',
};

export const MATCH_WIN_ROUNDS = 8;
export const ROUND_TIME = 100; // seconds of live play per round
export const BUY_TIME = 12; // seconds of buy phase per round
export const BOMB_TIMER = 40; // seconds from plant to detonation
export const PLANT_TIME = 3; // seconds holding E to plant
export const DEFUSE_TIME = 5; // seconds holding E to defuse

export function createState(seed) {
  return {
    seed,
    rng: mulberry32(seed),
    time: 0,
    tick: 0,
    phase: PHASE.MENU,
    phaseTime: 0, // seconds left in the current phase
    roundNumber: 0,
    score: { attack: 0, defend: 0 },
    lossStreak: { attack: 0, defend: 0 },
    roundWinner: null,
    roundReason: '',
    matchWinner: null,
    // The bomb: 'carried' | 'planted' | 'defused' | 'exploded' | 'dropped'
    bomb: { state: 'carried', carrier: null, site: null, timer: 0, x: 0, z: 0, progress: 0, planter: null, defuser: null },
    player: null, // filled by player.js
    bots: [], // bot entities, filled by bots.js
    combatants: [], // player + bots, for shooting and HUD counts
    grenades: [],
    events: [], // kill feed entries { text, t }
    shots: [], // shot visuals the renderer drains { origin, point, hit, kill, shooter }
    sounds: [], // queued sound names the audio module drains each frame
    shake: 0, // camera trauma 0..1
    kills: { attack: 0, defend: 0 },
    muted: false,
    shotMode: null, // 'menu' | 'game' | 'buy' | 'site' when ?shot= is set
  };
}
