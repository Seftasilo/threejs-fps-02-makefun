// Combat for EMBERLINE: hitscan rifles with headshots, tracers, and frag
// grenades with gravity, bounce and AoE. All hit tests are analytic ray vs
// axis-aligned box (map boxes and fighter body/head boxes), so the simulation
// never allocates a Raycaster and stays deterministic under a seeded RNG.
import { rayBox, segmentBlocked } from './map.js';
import { pointInBoxes } from './player.js';
import { WEAPONS, spreadFor } from './weapons.js';

// Scratch vectors, reused every shot: the hot loop allocates nothing.
const _o = { x: 0, y: 0, z: 0 };
const _d = { x: 0, y: 0, z: 0 };
const _box = { x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0 };

// Direction from yaw/pitch (three.js convention: yaw 0 faces -z).
export function dirFromYawPitch(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
  return out;
}

// Fire one hitscan bullet from a fighter. Returns 'hit' | 'head' | 'kill' | 'miss'.
// shooter: fighter {actor, weapon(loadout), ...}; G carries map, fighters, rng, fx.
export function fireHitscan(G, shooter) {
  const w = WEAPONS[shooter.loadout.kind];
  const a = shooter.actor;
  const rng = G.rng;
  _o.x = a.x;
  _o.y = a.y + a.eye;
  _o.z = a.z;
  dirFromYawPitch(a.yaw, a.pitch, _d);
  // Spread: two gaussian offsets perpendicular to the view direction.
  const spread = spreadFor(w, shooter.loadout, a.speed, a.onGround, a.crouch);
  const rx = rng.gauss() * spread;
  const ry = rng.gauss() * spread;
  // Right vector and up vector for the spread offsets.
  const cx = Math.cos(a.yaw);
  const cz = -Math.sin(a.yaw);
  _d.x += cx * rx;
  _d.y += ry;
  _d.z += cz * rx;
  const dl = Math.hypot(_d.x, _d.y, _d.z);
  _d.x /= dl;
  _d.y /= dl;
  _d.z /= dl;

  // Nearest wall.
  let wallT = w.range;
  for (let i = 0; i < G.map.boxes.length; i++) {
    const t = rayBox(_o, _d, G.map.boxes[i]);
    if (t >= 0 && t < wallT) wallT = t;
  }

  // Nearest fighter (body or head box), skipping the shooter and dead fighters.
  let hitF = null;
  let hitPart = '';
  let hitT = wallT;
  for (const f of G.fighters) {
    if (f === shooter || !f.alive) continue;
    const fa = f.actor;
    // Body box (everything below the head: the head box is tested apart,
    // so a ray clipping the top of the skull is a headshot, not a body hit).
    _box.x0 = fa.x - 0.36;
    _box.x1 = fa.x + 0.36;
    _box.y0 = fa.y;
    _box.y1 = fa.y + fa.height - 0.28;
    _box.z0 = fa.z - 0.36;
    _box.z1 = fa.z + 0.36;
    const tb = rayBox(_o, _d, _box);
    // Head box (top 0.28 m of the body).
    _box.y0 = fa.y + fa.height - 0.28;
    _box.x0 = fa.x - 0.2;
    _box.x1 = fa.x + 0.2;
    _box.z0 = fa.z - 0.2;
    _box.z1 = fa.z + 0.2;
    const th = rayBox(_o, _d, _box);
    if (th >= 0 && th < hitT) {
      hitF = f;
      hitPart = 'head';
      hitT = th;
    } else if (tb >= 0 && tb < hitT) {
      hitF = f;
      hitPart = 'body';
      hitT = tb;
    }
  }

  const ex = _o.x + _d.x * hitT;
  const ey = _o.y + _d.y * hitT;
  const ez = _o.z + _d.z * hitT;
  G.fx.tracers.push({ x0: _o.x, y0: _o.y, z0: _o.z, x1: ex, y1: ey, z1: ez, color: w.tracer, life: 0.09 });
  G.fx.muzzle = 0.06;
  shooter.loadout.bloom = Math.min(0.03, shooter.loadout.bloom + w.spreadShot);

  if (!hitF) return 'miss';
  const dmg = w.damage * (hitPart === 'head' ? w.headMul : 1);
  const killed = damageFighter(G, hitF, dmg, shooter, hitPart);
  return killed ? 'kill' : hitPart === 'head' ? 'head' : 'hit';
}

// Apply damage with armour absorbing 50% while it lasts. Returns true on kill.
export function damageFighter(G, target, amount, attacker, part) {
  if (!target.alive) return false;
  let rest = amount;
  if (target.armor > 0) {
    const absorbed = Math.min(target.armor, rest * 0.5);
    target.armor -= absorbed;
    rest -= absorbed;
  }
  target.hp -= rest;
  target.lastHitBy = attacker;
  target.lastHitPart = part;
  if (attacker === G.player) G.fx.hitmark = 0.18;
  if (target === G.player) {
    G.fx.hurtFlash = 0.35;
    G.audio.hurt();
  }
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    target.deaths += 1;
    if (attacker) {
      attacker.kills += 1;
      attacker.money += 300; // kill reward
      if (attacker === G.player) G.audio.kill();
    }
    G.killfeed.unshift({
      killer: attacker ? attacker.name : '—',
      victim: target.name,
      head: part === 'head',
      t: G.time,
    });
    if (G.killfeed.length > 5) G.killfeed.pop();
    // Bomb carrier drops the bomb where he fell.
    if (G.bomb.carrier === target) {
      G.bomb.state = 'dropped';
      G.bomb.carrier = null;
      G.bomb.x = target.actor.x;
      G.bomb.z = target.actor.z;
    }
    return true;
  }
  return false;
}

// Throw a frag from a fighter: it leaves the hand with the view direction.
export function throwGrenade(G, owner) {
  const a = owner.actor;
  dirFromYawPitch(a.yaw, a.pitch, _d);
  G.grenades.push({
    x: a.x, y: a.y + a.eye - 0.15, z: a.z,
    vx: _d.x * 13 + a.vx * 0.6,
    vy: _d.y * 13 + 4.2,
    vz: _d.z * 13 + a.vz * 0.6,
    fuse: 1.7, owner,
  });
  owner.loadout.mag = 0;
}

// Grenade physics: gravity, one bounce with damping, fuse explosion.
export function stepGrenades(G, dt) {
  for (let i = G.grenades.length - 1; i >= 0; i--) {
    const g = G.grenades[i];
    g.vy -= 14 * dt;
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    g.z += g.vz * dt;
    if (g.y <= 0.05) {
      g.y = 0.05;
      if (Math.abs(g.vy) > 2) g.vy = -g.vy * 0.42;
      else g.vy = 0;
      g.vx *= 0.6;
      g.vz *= 0.6;
    }
    // Bounce off map boxes: reflect on the axis of least penetration.
    if (pointInBoxes(g.x, g.y, g.z, G.map.boxes)) {
      g.x -= g.vx * dt;
      g.y -= g.vy * dt;
      g.z -= g.vz * dt;
      if (Math.abs(g.vx) >= Math.abs(g.vz)) g.vx = -g.vx * 0.45;
      else g.vz = -g.vz * 0.45;
      g.vy = Math.abs(g.vy) * 0.4;
    }
    g.fuse -= dt;
    if (g.fuse <= 0) {
      explodeGrenade(G, g);
      G.grenades.splice(i, 1);
    }
  }
}

export function explodeGrenade(G, g) {
  G.fx.explosions.push({ x: g.x, y: Math.max(0.4, g.y), z: g.z, life: 0.7, max: 0.7 });
  G.audio.explosion();
  const R = 5.5;
  for (const f of G.fighters) {
    if (!f.alive || f === g.owner) continue;
    const dx = f.actor.x - g.x;
    const dy = f.actor.y + 0.8 - g.y;
    const dz = f.actor.z - g.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > R) continue;
    let dmg = 95 - (75 * dist) / R;
    // Walls shield: halved through cover.
    if (segmentBlocked(g.x, g.y, g.z, f.actor.x, f.actor.y + 0.8, f.actor.z, G.map.boxes)) dmg *= 0.35;
    damageFighter(G, f, dmg, g.owner, 'body');
  }
  // A grenade on the planted bomb detonates it early.
  if (G.bomb.state === 'planted') {
    const dx = G.bomb.x - g.x;
    const dz = G.bomb.z - g.z;
    if (Math.hypot(dx, dz) < 3) G.bomb.fuse = Math.min(G.bomb.fuse, 0.01);
  }
}
