# Foundry Yard — a three.js tactical FPS

A round-based tactical shooter in the Counter-Strike style, built on three.js
0.187.0 with no build step and no network requests. You are the point player
of a five-person attack squad pushing into the Foundry Yard, an industrial
yard with two bomb sites, a mid lane and long sightlines. Plant the bomb at
site A or site B, or eliminate the defending squad — then do it again, richer,
with the money you earned.

## How to play

Serve `game/` with any static server and open `index.html` in desktop Chrome:

```
node serve.ts        # serves game/ on http://localhost:8080
```

Click to play (pointer lock). Drag to look if pointer lock is unavailable.

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look |
| Click | Fire |
| Right click | Scope (sniper only) |
| R | Reload |
| 1–5 | Pistol / SMG / Rifle / Shotgun / Sniper |
| G | Throw frag grenade |
| Ctrl | Crouch |
| Shift | Walk (quieter, steadier aim) |
| Space | Jump |
| B | Buy menu (buy phase) |
| E (hold) | Plant / defuse the bomb |
| M | Mute |

## The game

- **Rounds.** 5v5, first to 8 round wins takes the match. A round ends on
  elimination, bomb detonation, defusal, or the timer running out. Every round
  starts with a 12-second buy phase.
- **Money.** Kills pay $300, round wins $3,250, losses $1,900 and rising.
  Spend it in the buy menu: rifle, SMG, shotgun, sniper, frag grenades and
  body armour.
- **Gunplay.** Hitscan weapons with headshots worth more than body shots,
  recoil and spread that punish firing on the move, reloads and finite
  ammunition. Stopping to aim pays.
- **Bots.** Four friendly attackers and five defending bots run waypoint
  routes, hold angles, react to what they see and hear, plant and defuse.
  The carrier plants at A or B; the defenders converge when the bomb goes down.
- **Map.** Foundry Yard: two bomb sites, mid lane, crates, catwalks and
  sightlines, lit at dusk in concrete, rust and amber.

## Structure

- `game/index.html` — canvas, HUD and import map
- `game/src/main.js` — bootstrap and the fixed-step game loop
- `game/src/state.js` — the one place the game state lives
- `game/src/world.js` — the map, colliders, waypoints and bomb sites
- `game/src/player.js` — movement, collision, camera and health
- `game/src/weapons.js` — weapon definitions, firing, recoil and spread
- `game/src/bots.js` — bot AI: routes, vision, hearing, combat, objective
- `game/src/rounds.js` — round flow, economy, buy menu and the bomb
- `game/src/effects.js` — tracers, particles, muzzle flash, explosions
- `game/src/hud.js` — HUD, kill feed, banners and menus
- `game/src/audio.js` — synthesised WebAudio sound, no audio files
- `game/src/input.js` — keyboard, mouse and pointer lock
- `game/src/textures.js` — procedural canvas textures, no image files
- `game/src/util.js` — seeded RNG, vectors and collision maths
- `game/src/palette.js` — the dusk-industrial palette

The simulation runs at a fixed 60 Hz, kept apart from rendering, and the
render loop never allocates in its hot paths. All art is procedural geometry
and canvas textures; all sound is synthesised. Nothing is loaded from the
network.

## Development

Open `game/index.html` with a `?shot=` parameter to stage a scene for a
screenshot: `menu` (the title screen), `game` (a round already live, mid
lane, bots in sight), `buy` (the buy menu open) and `site` (the bomb planted
at site A). `?seed=` sets the simulation seed. These parameters are a dev
aid and ship in the game; they change nothing about normal play.
