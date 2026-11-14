// EMBERLINE — Kiln Yard: boot, fixed-step loop, rendering and screenshot modes.
// The simulation runs at a fixed 60 Hz, kept apart from rendering: the sim
// only mutates plain state in G, and the renderer only reads it. No object is
// allocated in the hot loop — tracers, explosions and bot meshes come from
// fixed pools built once at boot.
//
// Screenshot modes (deterministic, seeded): ?shot=start shows the title over
// a cinematic view of the yard; ?shot=play fast-forwards 3 s of live combat
// with an autopilot driving the player; ?shot=end fast-forwards until a round
// ends and shows the match screen. Each sets window.__shotReady once drawn.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { Rng } from './rng.js';
import { AudioBus } from './audio.js';
import { buildMap, findPath } from './map.js';
import { createActor, stepWalk, moveActor, EYE_STAND } from './player.js';
import { WEAPONS, createLoadout, buildViewModel } from './weapons.js';
import { createFighter, createBot, stepBot, botBuy, nearestVisibleEnemy } from './bots.js';
import { fireHitscan, throwGrenade, stepGrenades } from './combat.js';
import { createBomb, stepBomb } from './bomb.js';
import { createRounds, stepRounds } from './rounds.js';
import { createHudState, updateHud, buyItem } from './hud.js';
import { createInput, wishDir } from './input.js';

const STEP = 1 / 60;
const params = new URLSearchParams(location.search);
const SHOT = params.get('shot') || '';
const SEED = Number(params.get('seed') || '1') || 1;
const SHOT_MODE = SHOT === 'start' || SHOT === 'play' || SHOT === 'end';

// ---- Game state (one place, plain data) ------------------------------------
const G = {
  time: 0,
  seed: SEED,
  rng: new Rng(SEED),
  map: buildMap(),
  audio: new AudioBus(),
  fighters: [],
  player: null,
  bomb: createBomb(),
  rounds: createRounds(),
  grenades: [],
  killfeed: [],
  fx: { tracers: [], explosions: [], hitmark: 0, hurtFlash: 0, muzzle: 0 },
  hud: createHudState(),
  input: null,
  roundEnd: null,
  showStart: !SHOT_MODE || SHOT === 'start',
  started: SHOT_MODE && SHOT !== 'start',
  cinematic: SHOT === 'start',
  shotDone: false,
};

function spawnFighters() {
  const map = G.map;
  const player = createFighter('you', 'YOU', 'atk', map.spawns.atk[0].x, map.spawns.atk[0].z, map.spawns.atk[0].yaw, 'pistol', true);
  player.money = 800;
  player.grenades = 0;
  G.player = player;
  G.fighters = [player];
  for (let i = 1; i < 5; i++) {
    const s = map.spawns.atk[i];
    G.fighters.push(createBot('atk', s.x, s.z, s.yaw, G.rng));
  }
  for (let i = 0; i < 5; i++) {
    const s = map.spawns.def[i];
    G.fighters.push(createBot('def', s.x, s.z, s.yaw, G.rng));
  }
  G.bomb.carrier = player;
  G.bomb.state = 'carried';
}

export function resetRound() {
  const map = G.map;
  const atkSpawns = map.spawns.atk;
  const defSpawns = map.spawns.def;
  let ai = 0;
  let di = 0;
  for (const f of G.fighters) {
    const s = f.team === 'atk' ? atkSpawns[ai++] : defSpawns[di++];
    f.actor.x = s.x;
    f.actor.z = s.z;
    f.actor.y = 0;
    f.actor.vx = 0;
    f.actor.vz = 0;
    f.actor.vy = 0;
    f.actor.yaw = s.yaw;
    f.actor.pitch = 0;
    f.hp = 100;
    f.alive = true;
    f.loadout.reloading = 0;
    f.loadout.bloom = 0;
    f.path = [];
    f.pathIdx = 0;
    f.target = null;
    f.state = 'advance';
    if (!f.isPlayer) {
      botBuy(f);
      f.site = G.rng.chance(0.5) ? 'A' : 'B';
    }
  }
  G.bomb = createBomb();
  G.bomb.carrier = G.player;
  G.grenades.length = 0;
  G.fx.tracers.length = 0;
  G.fx.explosions.length = 0;
  G.roundEnd = null;
  G.rounds.phase = 'freeze';
  G.rounds.phaseT = 8;
  G.rounds.timer = 100;
  G.hud.banner = null;
  G.input.buyOpen = false;
}
G.resetRound = resetRound;

// ---- Rendering --------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.skyTop);
scene.fog = new THREE.Fog(0x2a1c12, 30, 90);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 220);
camera.rotation.order = 'YXZ';

const hemi = new THREE.HemisphereLight(0x9a7a5e, 0x241812, 1.5);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xff9a4d, 2.4);
sun.position.set(-18, 26, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -30;
sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30;
sun.shadow.camera.bottom = -30;
scene.add(sun);
const furnaceLight = new THREE.PointLight(0xff5a1a, 60, 22, 1.8);
furnaceLight.position.set(-14.5, 2, -10);
scene.add(furnaceLight);

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#261d15';
  ctx.fillRect(0, 0, 256, 256);
  const rng = new Rng(7);
  for (let i = 0; i < 900; i++) {
    const v = rng.range(0, 1);
    ctx.fillStyle = v < 0.5 ? 'rgba(72,58,44,0.3)' : 'rgba(0,0,0,0.2)';
    ctx.fillRect(rng.int(256), rng.int(256), rng.range(2, 9), rng.range(2, 9));
  }
  ctx.strokeStyle = 'rgba(58,47,38,0.6)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 64, 0);
    ctx.lineTo(i * 64, 256);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * 64);
    ctx.lineTo(256, i * 64);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(11, 9);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(46, 38),
  new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95, metalness: 0.05 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const MATS = {
  wall: new THREE.MeshStandardMaterial({ color: 0x372b1f, roughness: 0.9 }),
  crate: new THREE.MeshStandardMaterial({ color: 0x463723, roughness: 0.85 }),
  kiln: new THREE.MeshStandardMaterial({ color: 0x33261c, roughness: 0.8, metalness: 0.2 }),
  furnace: new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 0.7, metalness: 0.4 }),
  silo: new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.45, metalness: 0.75 }),
  pillar: new THREE.MeshStandardMaterial({ color: 0x2e241b, roughness: 0.85 }),
};

for (const b of G.map.boxes) {
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  const d = b.z1 - b.z0;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), MATS[b.kind] || MATS.wall);
  mesh.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
  mesh.castShadow = h > 1.4;
  mesh.receiveShadow = true;
  scene.add(mesh);
  if (b.kind === 'kiln') {
    // The kiln drum: a horizontal cylinder riding on its brick base.
    const drum = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 1.5, d - 0.4, 20),
      new THREE.MeshStandardMaterial({ color: 0x54402e, roughness: 0.55, metalness: 0.5 }),
    );
    drum.rotation.x = Math.PI / 2;
    drum.position.set((b.x0 + b.x1) / 2, b.y1 + 1.1, (b.z0 + b.z1) / 2);
    drum.castShadow = true;
    scene.add(drum);
  }
  if (b.kind === 'silo') {
    for (const cz of [-12, -8]) {
      const silo = new THREE.Mesh(
        new THREE.CylinderGeometry(2.15, 2.15, 5.5, 20),
        MATS.silo,
      );
      silo.position.set(17.7, 2.75, cz);
      silo.castShadow = true;
      scene.add(silo);
      const cap = new THREE.Mesh(
        new THREE.ConeGeometry(2.15, 1.1, 20),
        new THREE.MeshStandardMaterial({ color: 0x5a4a38, roughness: 0.5, metalness: 0.6 }),
      );
      cap.position.set(17.7, 6.05, cz);
      scene.add(cap);
    }
  }
  if (b.kind === 'furnace') {
    // Glowing furnace mouth on the east face.
    const mouth = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x1a0d06, emissive: PALETTE.furnace, emissiveIntensity: 2.2 }),
    );
    mouth.position.set(b.x1 + 0.02, 1.6, -10);
    mouth.rotation.y = Math.PI / 2;
    scene.add(mouth);
  }
}

// Yard lamps: two warm pools of light over the mid lane.
for (const [lx, lz] of [[-11, 2], [11, 2]]) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 4.6, 8), MATS.pillar);
  pole.position.set(lx, 2.3, lz);
  scene.add(pole);
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x201409, emissive: PALETTE.lamp, emissiveIntensity: 3 }),
  );
  bulb.position.set(lx, 4.7, lz);
  scene.add(bulb);
  const light = new THREE.PointLight(0xffc27a, 18, 16, 1.8);
  light.position.set(lx, 4.6, lz);
  scene.add(light);
}

// ---- Fighters ---------------------------------------------------------------
const fighterMeshes = new Map();
function buildFighterMesh(f) {
  const group = new THREE.Group();
  // Muted uniforms with a bright visor stripe: readable at distance, but a
  // teammate point-blank does not read as a flat orange wall.
  const teamColor = f.team === 'atk' ? 0x7a4a26 : 0x33505e;
  const visorColor = f.team === 'atk' ? PALETTE.accent : PALETTE.foe;
  const cloth = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x241c16, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.66, 1.05, 0.36), cloth);
  body.position.y = 0.88;
  body.castShadow = true;
  group.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.34, 0.36), dark);
  head.position.y = 1.58;
  head.castShadow = true;
  group.add(head);
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.08, 0.05),
    new THREE.MeshStandardMaterial({ color: visorColor, emissive: visorColor, emissiveIntensity: 0.9 }),
  );
  visor.position.set(0, 1.6, -0.19);
  group.add(visor);
  for (const s of [-0.16, 0.16]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.36, 0.26), dark);
    leg.position.set(s, 0.18, 0);
    group.add(leg);
  }
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.7), dark);
  gun.position.set(0.2, 1.15, -0.4);
  group.add(gun);
  // Bomb satchel, shown only while this fighter carries the bomb.
  const satchel = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.22, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x1a120c, emissive: PALETTE.accent, emissiveIntensity: 0.6 }),
  );
  satchel.position.set(0, 1.0, 0.24);
  satchel.visible = false;
  satchel.name = 'satchel';
  group.add(satchel);
  scene.add(group);
  fighterMeshes.set(f.id, group);
  return group;
}

// View model (the player's gun, attached to the camera).
let viewModel = null;
let viewModelKind = '';
function refreshViewModel() {
  const p = G.player;
  if (viewModelKind === p.weapon) return;
  if (viewModel) {
    camera.remove(viewModel);
    viewModel = null;
  }
  viewModel = buildViewModel(p.weapon);
  viewModelKind = p.weapon;
  camera.add(viewModel);
  scene.add(camera);
}

// Tracer pool: 24 reusable lines.
const tracerPool = [];
for (let i = 0; i < 24; i++) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff7a2f, transparent: true, opacity: 0 }));
  line.frustumCulled = false;
  scene.add(line);
  tracerPool.push({ line, life: 0 });
}
let tracerIdx = 0;
function spawnTracer(t) {
  const slot = tracerPool[tracerIdx];
  tracerIdx = (tracerIdx + 1) % tracerPool.length;
  const pos = slot.line.geometry.attributes.position.array;
  pos[0] = t.x0;
  pos[1] = t.y0;
  pos[2] = t.z0;
  pos[3] = t.x1;
  pos[4] = t.y1;
  pos[5] = t.z1;
  slot.line.geometry.attributes.position.needsUpdate = true;
  slot.line.material.color.setHex(t.color);
  slot.line.material.opacity = 0.95;
  slot.life = t.life;
}

// Explosion pool: 4 reusable fireballs + one shared light.
const explosionPool = [];
for (let i = 0; i < 4; i++) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xff7a2f, transparent: true, opacity: 0 }),
  );
  mesh.visible = false;
  scene.add(mesh);
  explosionPool.push({ mesh, life: 0, max: 1 });
}
let explosionIdx = 0;
const boomLight = new THREE.PointLight(0xff7a2f, 0, 18, 1.6);
scene.add(boomLight);

// Grenade meshes (pool of 3).
const grenadeMeshes = [];
for (let i = 0; i < 3; i++) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x3a2f26, roughness: 0.4, metalness: 0.8 }),
  );
  m.visible = false;
  scene.add(m);
  grenadeMeshes.push(m);
}

// Bomb mesh on the ground (dropped / planted).
const bombMesh = new THREE.Group();
const bombBox = new THREE.Mesh(
  new THREE.BoxGeometry(0.34, 0.2, 0.24),
  new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 0.5, metalness: 0.6 }),
);
bombMesh.add(bombBox);
const bombBlink = new THREE.Mesh(
  new THREE.SphereGeometry(0.05, 8, 6),
  new THREE.MeshBasicMaterial({ color: 0xff7a2f }),
);
bombBlink.position.y = 0.14;
bombMesh.add(bombBlink);
bombMesh.visible = false;
scene.add(bombMesh);

// Muzzle flash: a small emissive quad at the view-model barrel tip.
const flash = new THREE.Mesh(
  new THREE.PlaneGeometry(0.16, 0.16),
  new THREE.MeshBasicMaterial({ color: 0xffc27a, transparent: true, opacity: 0, side: THREE.DoubleSide }),
);
flash.position.set(0.24, -0.15, -0.85);
camera.add(flash);

// ---- Simulation -------------------------------------------------------------
let prevFiring = false;

function stepFighterCommon(f, dt) {
  const l = f.loadout;
  if (l.cooldown > 0) l.cooldown -= dt;
  if (l.bloom > 0) l.bloom *= Math.exp(-dt * 5);
  if (l.reloading > 0) {
    l.reloading -= dt;
    if (l.reloading <= 0) {
      const w = WEAPONS[l.kind];
      const need = w.mag - l.mag;
      const take = Math.min(need, l.reserve);
      l.mag += take;
      l.reserve -= take;
    }
  }
}

function startReload(f) {
  const l = f.loadout;
  const w = WEAPONS[l.kind];
  if (l.reloading > 0 || l.mag >= w.mag || l.reserve <= 0) return;
  l.reloading = w.reloadS;
  if (f.isPlayer) G.audio.reload();
}

function playerShoot(dt) {
  const p = G.player;
  const l = p.loadout;
  const w = WEAPONS[l.kind];
  const wantFire = G.input.firing || G.autopilotFire;
  const edge = wantFire && !prevFiring;
  prevFiring = wantFire;
  if (l.reloading > 0 || !wantFire) return;
  if (!w.auto && !edge) return;
  if (l.cooldown > 0) return;
  if (l.mag <= 0) {
    if (l.reserve > 0) startReload(p);
    else G.audio.dry();
    l.cooldown = 0.25;
    return;
  }
  l.mag -= 1;
  l.cooldown = 60 / w.rpm;
  const result = fireHitscan(G, p);
  G.audio.shot(w.id);
  p.actor.pitch += w.recoil * (p.actor.crouch ? 0.7 : 1);
  if (result === 'hit' || result === 'head') G.audio.hit();
}

function stepPlayer(dt) {
  const p = G.player;
  const a = p.actor;
  const input = G.input;
  // Mouse look.
  a.yaw -= input.lookDX * 0.0022;
  a.pitch -= input.lookDY * 0.0022;
  input.lookDX = 0;
  input.lookDY = 0;
  if (a.pitch > 1.5) a.pitch = 1.5;
  if (a.pitch < -1.5) a.pitch = -1.5;
  // Movement (autopilot overrides the keys in shot modes).
  const wish = G.autopilot ? G.autopilotWish : wishDir(input, a.yaw);
  const crouch = input.keys.has('ControlLeft') || input.keys.has('KeyC') || !!G.autopilotCrouch;
  const jump = input.keys.has('Space');
  stepWalk(a, wish, crouch, jump, dt);
  if (wish.slow) {
    a.vx *= 0.55;
    a.vz *= 0.55;
  }
  moveActor(a, G.map.boxes, G.map.bounds, dt);
  // Footstep ticks.
  if (a.speed > 2 && a.onGround) {
    p._stepT = (p._stepT || 0) - dt;
    if (p._stepT <= 0) {
      p._stepT = 0.42;
      G.audio.step();
    }
  }
  playerShoot(dt);
}

function onKey(code) {
  const p = G.player;
  if (code === 'KeyR') startReload(p);
  if (code === 'Digit1' && p.weapons.pistol) {
    p.weapon = 'pistol';
    p.loadout = p.weapons.pistol;
  }
  if (code === 'Digit2' && p.weapons.smg) {
    p.weapon = 'smg';
    p.loadout = p.weapons.smg;
  }
  if (code === 'Digit3' && p.weapons.rifle) {
    p.weapon = 'rifle';
    p.loadout = p.weapons.rifle;
  }
  if (code === 'Digit4' && p.grenades > 0) {
    p.grenades -= 1;
    throwGrenade(G, p);
    G.audio.shot('pistol');
  }
}

function stepSim(dt) {
  G.time += dt;
  if (G.hud.banner) {
    G.hud.banner.t -= dt;
    if (G.hud.banner.t <= 0) G.hud.banner = null;
  }
  if (G.fx.hitmark > 0) G.fx.hitmark -= dt;
  if (G.fx.hurtFlash > 0) G.fx.hurtFlash -= dt;
  if (G.fx.muzzle > 0) G.fx.muzzle -= dt;

  stepRounds(G, dt);
  if (G.rounds.phase === 'live' && G.started) {
    if (G.player.alive) stepPlayer(dt);
    for (const f of G.fighters) {
      if (!f.isPlayer) stepBot(G, f, dt);
    }
    stepBomb(G, dt);
    stepGrenades(G, dt);
  }
  for (const f of G.fighters) stepFighterCommon(f, dt);
  // Decay tracers / explosions in sim time so screenshots are deterministic.
  for (const t of G.fx.tracers) t.life -= dt;
  for (const e of G.fx.explosions) e.life -= dt;
  G.fx.tracers = G.fx.tracers.filter((t) => t.life > 0);
  G.fx.explosions = G.fx.explosions.filter((e) => e.life > 0);
}

// Autopilot: drives the player in ?shot=play and ?shot=end so the screenshots
// show real combat. Aim at the nearest visible enemy, walk toward the fight,
// fire in bursts.
function autopilot() {
  const p = G.player;
  if (!p.alive) {
    G.autopilotFire = false;
    G.autopilotWish = { x: 0, z: 0, slow: false };
    return;
  }
  // Reload early, like a player topping up between fights, so the magazine
  // is rarely caught empty on camera.
  if (p.loadout.mag <= 10 && p.loadout.reserve > 0 && p.loadout.reloading <= 0) startReload(p);
  const enemy = nearestVisibleEnemy(G, p);
  if (enemy) {
    G.autopilotCrouch = true;
    const a = p.actor;
    const ta = enemy.actor;
    const dx = ta.x - a.x;
    const dy = ta.y + 1.25 - (a.y + a.eye);
    const dz = ta.z - a.z;
    const dist = Math.hypot(dx, dy, dz);
    a.yaw = Math.atan2(-dx, -dz);
    a.pitch = Math.asin(Math.max(-1, Math.min(1, dy / Math.max(0.001, dist))));
    // Burst fire: hold the trigger about half the time, like a player
    // tapping in bursts instead of spraying the whole magazine.
    G.autopilotFire = Math.sin(G.time * 2.2) > -0.2;
    // Strafe slightly while firing, and backpedal a step, like a real player
    // peeking: a moving, retreating target is harder to hit than a statue.
    const strafe = Math.sin(G.time * 1.7) > 0 ? 1 : -1;
    G.autopilotWish = {
      x: Math.cos(a.yaw) * strafe * 0.4 + Math.sin(a.yaw) * 0.5,
      z: -Math.sin(a.yaw) * strafe * 0.4 + Math.cos(a.yaw) * 0.5,
      slow: true,
    };
  } else {
    G.autopilotFire = false;
    G.autopilotCrouch = false;
    // No enemy in sight: walk the waypoint graph toward the north-mid
    // junction, exactly like the bots do, instead of pushing straight at the
    // site and hugging the first wall in the way. The junction has sightlines
    // down both lanes and across the kiln hall, so the shot shows the map.
    if (!G.autoPath || G.autoPathIdx >= G.autoPath.length) {
      G.autoPath = findPath(G.map, { x: p.actor.x, z: p.actor.z }, { x: -6, z: -8 });
      G.autoPathIdx = 0;
    }
    const wp = G.map.waypoints[G.autoPath[G.autoPathIdx]];
    const dx = wp.x - p.actor.x;
    const dz = wp.z - p.actor.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.9) {
      G.autoPathIdx += 1;
      G.autopilotWish = { x: 0, z: 0, slow: false };
      return;
    }
    p.actor.yaw = Math.atan2(-dx, -dz);
    p.actor.pitch = 0;
    G.autopilotWish = { x: -Math.sin(p.actor.yaw), z: -Math.cos(p.actor.yaw), slow: false };
  }
}

// ---- Frame ------------------------------------------------------------------
let last = performance.now();
let acc = 0;
let framesRendered = 0;

function render() {
  const p = G.player;
  const a = p.actor;
  refreshViewModel();
  if (G.cinematic) {
    camera.position.set(0, 9, 23);
    camera.lookAt(0, 1.2, -6);
  } else {
    camera.position.set(a.x, a.y + a.eye, a.z);
    camera.rotation.y = a.yaw;
    camera.rotation.x = a.pitch;
    camera.rotation.z = 0;
  }
  // View-model recoil kick + muzzle flash.
  if (viewModel) {
    const kick = G.fx.muzzle > 0 ? 0.04 : 0;
    viewModel.position.z = -0.5 + kick;
    viewModel.rotation.x = G.fx.muzzle > 0 ? 0.06 : 0;
  }
  flash.material.opacity = G.fx.muzzle > 0 ? 0.9 : 0;
  // Fighters. The player's own mesh is never drawn: the camera sits where
  // their head is, and their visor would fill the screen from 19 cm away.
  for (const f of G.fighters) {
    if (f === G.player) {
      const pm = fighterMeshes.get(f.id);
      if (pm) pm.visible = false;
      continue;
    }
    let mesh = fighterMeshes.get(f.id);
    if (!mesh) mesh = buildFighterMesh(f);
    const fa = f.actor;
    mesh.visible = f.alive || f.deaths >= 0;
    if (!f.alive) {
      // Fallen: lying flat, fading into the yard.
      mesh.position.set(fa.x, 0.12, fa.z);
      mesh.rotation.set(-Math.PI / 2, fa.yaw, 0);
      mesh.scale.set(1, 1, 1);
    } else {
      mesh.position.set(fa.x, fa.y, fa.z);
      mesh.rotation.set(0, fa.yaw, 0);
      mesh.scale.y = fa.height / 1.7;
    }
    mesh.visible = true;
    const satchel = mesh.getObjectByName('satchel');
    if (satchel) satchel.visible = G.bomb.carrier === f && G.bomb.state !== 'planted';
  }
  // Tracers.
  for (const t of G.fx.tracers) spawnTracer(t);
  for (const slot of tracerPool) {
    if (slot.life > 0) {
      slot.life -= 1 / 60;
      slot.line.material.opacity = Math.max(0, slot.life / 0.09) * 0.95;
    } else {
      slot.line.material.opacity = 0;
    }
  }
  // Explosions.
  for (const e of G.fx.explosions) {
    const slot = explosionPool[explosionIdx];
    explosionIdx = (explosionIdx + 1) % explosionPool.length;
    slot.mesh.visible = true;
    slot.mesh.position.set(e.x, e.y, e.z);
    slot.life = e.life;
    slot.max = e.max;
  }
  let boom = 0;
  for (const slot of explosionPool) {
    if (slot.life > 0) {
      slot.life -= 1 / 60;
      const k = 1 - slot.life / slot.max;
      const s = 0.5 + k * 4.5;
      slot.mesh.scale.set(s, s, s);
      // A fireball the camera sits inside would read as a flat orange wall
      // in a still: fade it to a tint instead when the camera is inside it.
      const dCam = camera.position.distanceTo(slot.mesh.position);
      const inside = dCam < s ? 0.12 : 1;
      slot.mesh.material.opacity = Math.max(0, 1 - k) * 0.85 * inside;
      boom = Math.max(boom, (1 - k) * 120);
    } else {
      slot.mesh.visible = false;
    }
  }
  boomLight.intensity = boom;
  if (G.fx.explosions.length) {
    const e = G.fx.explosions[0];
    boomLight.position.set(e.x, e.y + 1, e.z);
  }
  // Grenades.
  for (let i = 0; i < grenadeMeshes.length; i++) {
    const g = G.grenades[i];
    grenadeMeshes[i].visible = !!g;
    if (g) grenadeMeshes[i].position.set(g.x, g.y, g.z);
  }
  // Bomb on the ground.
  const b = G.bomb;
  bombMesh.visible = b.state === 'dropped' || b.state === 'planted';
  if (bombMesh.visible) {
    bombMesh.position.set(b.x, 0.12, b.z);
    bombBlink.material.color.setHex(b.state === 'planted' && Math.floor(G.time * 2) % 2 === 0 ? 0xff2a1a : 0xff7a2f);
  }
  // Furnace glow breathes with the round.
  furnaceLight.intensity = 55 + Math.sin(G.time * 1.3) * 8;

  renderer.render(scene, camera);
  framesRendered += 1;
  if (SHOT_MODE && !G.shotDone && framesRendered >= 3) {
    G.shotDone = true;
    window.__shotReady = true;
  }
}

function frame(now) {
  const dtMs = Math.min(100, now - last);
  last = now;
  if (!G.rounds.matchOver || SHOT_MODE) {
    acc += dtMs / 1000;
    let n = 0;
    while (acc >= STEP && n < 5) {
      if (G.autopilot) autopilot();
      stepSim(STEP);
      acc -= STEP;
      n += 1;
    }
    if (n === 5) acc = 0;
  }
  updateHud(G);
  render();
  requestAnimationFrame(frame);
}

// ---- Boot -------------------------------------------------------------------
spawnFighters();
G.input = createInput(renderer.domElement);
G.input.onKey = onKey;
G.input.onBuy = (kind) => buyItem(G, kind);
G.input.onPlay = () => {
  G.showStart = false;
  G.started = true;
  G.audio.ensure();
  renderer.domElement.requestPointerLock?.();
};
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
window.addEventListener('pointerdown', () => G.audio.ensure(), { once: true });

// Buy menu opens automatically at the start of every freeze phase.
const _origReset = G.resetRound;
G.resetRound = () => {
  _origReset();
  G.input.buyOpen = true;
};

// Shot modes: fast-forward the sim deterministically before the first frame.
if (SHOT === 'start') {
  // Title screen over a cinematic yard view; freeze phase, nobody moves,
  // and the clock never runs, so the cover always shows 0:08 FREEZE.
  G.showStart = true;
  G.started = false;
  G.freezeClock = true;
} else if (SHOT === 'play') {
  G.showStart = false;
  G.started = true;
  G.autopilot = true;
  // Buy the player a rifle for the screenshot, like a real round-2 buy.
  // (buyItem only works during the freeze phase, so buy before going live.)
  G.player.money = 3000;
  buyItem(G, 'rifle');
  G.player.money = 1200;
  G.player.armor = 100; // bought with the round-2 money, like a real player
  G.rounds.phase = 'live';
  G.rounds.phaseT = 0;
  G.rounds.timer = 100;
  for (const f of G.fighters) if (!f.isPlayer) botBuy(f);
  // Fast-forward up to 3 s of live combat, stopping early if the round ends.
  let ff = 0;
  while (ff < 3 * 60 && G.rounds.phase === 'live') {
    autopilot();
    stepSim(STEP);
    ff += 1;
  }
  // Step through freeze/over until a live round is running again, close the
  // buy menu, then fight 1 more second so the shot shows live combat, not
  // the buy screen; if that second ended the round, step through once more.
  let guard = 0;
  while (G.rounds.phase !== 'live' && guard < 20 * 60) {
    stepSim(STEP);
    guard += 1;
  }
  G.input.buyOpen = false;
  for (let i = 0; i < 1 * 60; i++) {
    autopilot();
    stepSim(STEP);
  }
  guard = 0;
  while (G.rounds.phase !== 'live' && guard < 20 * 60) {
    stepSim(STEP);
    guard += 1;
  }
  G.input.buyOpen = false;
  document.title = 'PLAY phase=' + G.rounds.phase + ' phaseT=' + G.rounds.phaseT.toFixed(2) + ' guard=' + guard + ' score=' + G.rounds.score.atk + '-' + G.rounds.score.def + ' hp=' + Math.ceil(G.player.hp) + ' num=' + G.rounds.num;
} else if (SHOT === 'end') {
  G.showStart = false;
  G.started = true;
  G.autopilot = true;
  G.rounds.phase = 'live';
  G.rounds.phaseT = 0;
  // Fast-forward a short match (first to 3, max 5 rounds) so the end screen
  // shows a real scoreline, then present the match screen.
  let steps = 0;
  let sinceRoundStart = 0;
  let forcedThisRound = false;
  while (steps < 400 * 60) {
    autopilot();
    stepSim(STEP);
    steps += 1;
    sinceRoundStart += 1;
    const s = G.rounds.score;
    if (s.atk >= 3 || s.def >= 3 || s.atk + s.def >= 5) break;
    if (G.rounds.phase === 'live' && sinceRoundStart > 45 * 60 && !forcedThisRound) {
      // Guarantee the round ends: the bomb goes off at Site A. Once per
      // round only — re-arming it every step would reset its fuse forever.
      forcedThisRound = true;
      G.bomb.state = 'planted';
      G.bomb.x = G.map.sites.A.x;
      G.bomb.z = G.map.sites.A.z;
      G.bomb.fuse = 0.05;
    }
    if (G.rounds.phase === 'freeze') {
      sinceRoundStart = 0;
      forcedThisRound = false;
    }
  }
  // Let the 'over' banner finish, then present the match screen.
  let tail = 0;
  while (G.rounds.phase === 'over' && tail < 6 * 60) {
    stepSim(STEP);
    tail += 1;
  }
  G.rounds.matchOver = true;
  G.rounds.matchWinner = G.rounds.score.atk >= G.rounds.score.def ? 'atk' : 'def';
  document.title = 'END steps=' + steps + ' score=' + G.rounds.score.atk + '-' + G.rounds.score.def + ' round=' + G.rounds.num + ' phase=' + G.rounds.phase + ' bomb=' + G.bomb.state;
}

requestAnimationFrame(frame);
