# EMBERLINE — Kiln Yard

A round-based tactical FPS in the style Counter-Strike made famous, built on
three.js 0.187.0 (vendored, static files, no network). Original map, names,
art and sounds — nothing copied from any commercial game.

## The game

You are **EMBERLINE**, attacking a dusk industrial kiln yard at 5v5. Plant the
bomb at **Site A — Furnace** or **Site B — Silo**, or eliminate all five
defenders. Rounds last 100 seconds, first to 7 wins the match.

- **Map** — Kiln Yard, ~44×36 m: attacker spawn south, defender spawn north,
  mid lane through the kiln hall, three lanes plus a north connector, crates
  and pillars breaking every sightline.
- **Gunplay** — Rifle VK-47 Ember ($2700), SMG Wasp-9 ($1500), Pistol P10
  Sidearm ($300), Frag Spark-1 ($300). Hitscan with headshots ×3, recoil and
  spread that punish firing on the move; acceleration, friction, crouch, jump
  and box collision, so stopping to aim pays.
- **Tactics** — Bomb plant (hold E, 4 s) / defuse (hold E, 5 s, 40 s fuse),
  round economy ($800 start, +$300 kill, +$3000 win, +$1900 loss, +$300
  plant), buy menu (B) in the 8 s freeze time, armour that absorbs 50%.
  Bots advance, hold, engage, plant, defuse and rotate; they follow a
  24-node waypoint graph, check line of sight and field of view, fire in
  bursts with distance-based accuracy, and turn toward gunfire they hear.
- **Look** — Dusk palette (canvas #171310, ember #ff7a2f, steel-blue
  defenders #7fb3d5), glowing furnace mouth, kiln drums, grain silos, yard
  lamps, tracers, muzzle flash and explosions. All sound is synthesised
  WebAudio — no audio assets.
- **Code** — One module per job (`game/src/`): `palette`, `rng` (seeded
  mulberry32), `audio`, `map` (colliders + waypoint graph), `player`
  (movement + collision), `weapons`, `bots`, `combat` (hitscan + grenades),
  `bomb`, `rounds`, `hud`, `input`, `main` (boot + loop + render). Fixed-step
  60 Hz simulation kept apart from rendering; no allocation in the hot loop.

## Play

```sh
node serve.ts   # then open http://localhost:8080
```

Click to play (pointer lock). `WASD` move, mouse look, click fire, `R`
reload, `1/2/3` weapons, `4` frag, `Shift` walk slow, `Ctrl`/`C` crouch,
`Space` jump, `E` hold to plant/defuse, `B` buy menu.

Screenshot modes are deterministic: `?shot=start|play|end&seed=N` renders a
title view, 8 s of live combat, or the match screen, and sets
`window.__shotReady` when drawn.

## Hand in

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` copies `game/` and `screenshots/` to the output directory and
writes `dossier.json` with the kit's `vendor/makefun-threejs.ts`.
