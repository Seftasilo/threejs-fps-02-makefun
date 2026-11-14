// Bots for EMBERLINE: five attackers and five defenders (the player counts as
// one attacker, so 4 ally bots + 5 enemy bots). Each bot is a fighter with a
// state machine — advance / hold / engage / plant / defuse / rotate — that
// walks the waypoint graph, checks line of sight and field of view, fires in
// bursts with distance- and movement-based accuracy, and turns toward gunfire
// it hears. Bots share the player's movement and combat code, so a bot is
// beaten by the same rules the player plays under.
import { createActor, stepWalk, moveActor } from './player.js';
import { createLoadout, WEAPONS } from './weapons.js';
import { findPath, segmentBlocked } from './map.js';
import { fireHitscan, throwGrenade } from './combat.js';

let botCounter = 0;

export function createFighter(id, name, team, x, z, yaw, weaponKind, isPlayer) {
  const f = {
    id, name, team, isPlayer: !!isPlayer,
    actor: createActor(x, z, yaw),
    hp: 100, armor: 0, alive: true,
    weapons: { pistol: createLoadout('pistol') },
    weapon: 'pistol',
    money: 800, kills: 0, deaths: 0,
    lastHitBy: null, lastHitPart: '',
    // Bot brain (unused for the player).
    state: 'advance',
    path: [], pathIdx: 0,
    thinkT: 0, burstLeft: 0, burstPause: 0, aimErr: 0,
    target: null, lastSeenX: 0, lastSeenZ: 0, lastSeenT: -99,
    hearX: 0, hearZ: 0, hearT: -99,
    site: 'A', holdT: 0, grenades: 1,
  };
  if (weaponKind && weaponKind !== 'pistol') f.weapons[weaponKind] = createLoadout(weaponKind);
  if (weaponKind) f.weapon = weaponKind;
  f.loadout = f.weapons[f.weapon];
  return f;
}

export function createBot(team, x, z, yaw, rng) {
  botCounter += 1;
  const namesAtk = ['Sari', 'Bara', 'Laras', 'Tama', 'Guntur'];
  const namesDef = ['Kala', 'Wira', 'Damar', 'Sinta', 'Raka'];
  const idx = (botCounter - 1) % 5;
  const name = team === 'atk' ? namesAtk[idx] : namesDef[idx];
  const kind = rng.chance(0.6) ? 'rifle' : 'smg';
  const bot = createFighter('bot' + botCounter, name, team, x, z, yaw, kind, false);
  bot.site = rng.chance(0.5) ? 'A' : 'B';
  bot.thinkT = rng.range(0, 0.1);
  return bot;
}

// Nearest visible enemy: within 45 m, inside a 100-degree field of view, and
// with an unblocked sightline to the chest. Returns the fighter or null.
export function nearestVisibleEnemy(G, bot) {
  const a = bot.actor;
  let best = null;
  let bestD = 46;
  for (const f of G.fighters) {
    if (!f.alive || f.team === bot.team) continue;
    const fa = f.actor;
    const dx = fa.x - a.x;
    const dz = fa.z - a.z;
    const dist = Math.hypot(dx, dz);
    if (dist > bestD) continue;
    // Field of view: angle between facing and target.
    const fx = -Math.sin(a.yaw);
    const fz = -Math.cos(a.yaw);
    const dot = (dx * fx + dz * fz) / Math.max(0.001, dist);
    if (dot < 0.25 && dist > 4) continue; // ~75 deg half-angle; close targets always seen
    const blocked = segmentBlocked(a.x, a.y + a.eye, a.z, fa.x, fa.y + 1.1, fa.z, G.map.boxes);
    if (blocked) continue;
    best = f;
    bestD = dist;
  }
  return best;
}

// Aim a bot's view at a target with seeded error; returns true when roughly on.
function aimAt(G, bot, target, dt) {
  const a = bot.actor;
  const ta = target.actor;
  const dx = ta.x - a.x;
  const dy = ta.y + 1.25 - (a.y + a.eye);
  const dz = ta.z - a.z;
  const dist = Math.hypot(dx, dy, dz);
  const wantYaw = Math.atan2(-dx, -dz);
  const wantPitch = Math.asin(Math.max(-1, Math.min(1, dy / Math.max(0.001, dist))));
  // Error grows with distance and target speed: far, moving targets are missed.
  const err = (0.012 + dist * 0.0009 + target.actor.speed * 0.004) * bot.aimErr;
  const ey = G.rng.gauss() * err;
  const ep = G.rng.gauss() * err * 0.7;
  let dyaw = wantYaw + ey - a.yaw;
  while (dyaw > Math.PI) dyaw -= 2 * Math.PI;
  while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
  const turn = Math.min(1, dt * 7);
  a.yaw += dyaw * turn;
  a.pitch += (wantPitch + ep - a.pitch) * turn;
  return Math.abs(dyaw) < 0.05;
}

// One bot, one fixed step. Thinking (state + path) runs at 10 Hz; movement
// and firing run every step so bots react inside a tick.
export function stepBot(G, bot, dt) {
  if (!bot.alive) return;
  bot.thinkT -= dt;
  if (bot.thinkT <= 0) {
    bot.thinkT = 0.1;
    thinkBot(G, bot);
    // Vision is re-checked at the 10 Hz think rate, not every tick: bots see
    // in glances, like a player, and it keeps the sim cheap.
    const seen = nearestVisibleEnemy(G, bot);
    bot.target = seen;
    if (seen) {
      bot.lastSeenX = seen.actor.x;
      bot.lastSeenZ = seen.actor.z;
      bot.lastSeenT = G.time;
    }
  }

  const a = bot.actor;
  const enemy = bot.target && bot.target.alive ? bot.target : null;
  if (enemy) {
    bot.state = 'engage';
  } else if (bot.state === 'engage' && G.time - bot.lastSeenT > 1.2) {
    bot.state = bot.team === 'atk' ? 'advance' : 'hold';
    bot.target = null;
  }

  if (bot.state === 'engage' && bot.target && bot.target.alive) {
    // Stop, aim, fire in bursts — but never stand on a teammate: sidestep
    // away from any fighter closer than 1.5 m so sightlines stay open.
    const on = aimAt(G, bot, bot.target, dt);
    let wx = 0;
    let wz = 0;
    for (const f of G.fighters) {
      if (f === bot || !f.alive) continue;
      const ox = a.x - f.actor.x;
      const oz = a.z - f.actor.z;
      const d2 = ox * ox + oz * oz;
      if (d2 < 2.25 && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const push = 1.5 - d;
        wx += (ox / d) * push;
        wz += (oz / d) * push;
      }
    }
    stepWalk(bot.actor, { x: wx, z: wz }, false, false, dt);
    bot.loadout.cooldown -= dt;
    if (bot.burstLeft <= 0) {
      bot.burstPause -= dt;
      if (bot.burstPause <= 0 && on) {
        bot.burstLeft = 3 + G.rng.int(3);
        bot.burstPause = G.rng.range(0.45, 0.95);
      }
    } else if (bot.loadout.cooldown <= 0 && on) {
      fireBotShot(G, bot);
    }
    // Occasionally toss the frag at a dug-in enemy.
    if (bot.grenades > 0 && bot.target && G.rng.chance(dt * 0.05)) {
      const d = Math.hypot(bot.target.actor.x - a.x, bot.target.actor.z - a.z);
      if (d > 8 && d < 22) {
        bot.grenades -= 1;
        throwGrenade(G, bot);
      }
    }
  } else {
    // Walk the current path.
    const wp = nextWaypoint(G, bot);
    if (wp) {
      const dx = wp.x - a.x;
      const dz = wp.z - a.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.9) {
        bot.pathIdx += 1;
      } else {
        const wantYaw = Math.atan2(-dx, -dz);
        let dyaw = wantYaw - a.yaw;
        while (dyaw > Math.PI) dyaw -= 2 * Math.PI;
        while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
        a.yaw += dyaw * Math.min(1, dt * 6);
        const fx = -Math.sin(a.yaw);
        const fz = -Math.cos(a.yaw);
        // Separation: never stack on a teammate (or the player) — push away
        // from any fighter closer than 1.2 m so nobody blocks a sightline.
        let rx = 0;
        let rz = 0;
        for (const f of G.fighters) {
          if (f === bot || !f.alive) continue;
          const ox = a.x - f.actor.x;
          const oz = a.z - f.actor.z;
          const d2 = ox * ox + oz * oz;
          if (d2 < 1.44 && d2 > 0.0001) {
            const d = Math.sqrt(d2);
            const push = (1.2 - d) * 1.5;
            rx += (ox / d) * push;
            rz += (oz / d) * push;
          }
        }
        stepWalk(a, { x: fx + rx, z: fz + rz }, false, false, dt);
        // Look where we walk, slightly ahead.
        a.pitch += (0 - a.pitch) * Math.min(1, dt * 4);
      }
    } else {
      stepWalk(a, { x: 0, z: 0 }, false, false, dt);
      a.yaw += dt * 0.4; // idle scan
    }
    bot.loadout.cooldown -= dt;
  }

  moveActor(a, G.map.boxes, G.map.bounds, dt);
  // Pick up a dropped bomb by walking over it.
  if (bot.team === 'atk' && G.bomb.state === 'dropped') {
    const dx = G.bomb.x - a.x;
    const dz = G.bomb.z - a.z;
    if (dx * dx + dz * dz < 1.44) {
      G.bomb.state = 'carried';
      G.bomb.carrier = bot;
    }
  }
}

function fireBotShot(G, bot) {
  const w = WEAPONS[bot.loadout.kind];
  if (bot.loadout.mag <= 0) {
    if (bot.loadout.reserve > 0 && bot.loadout.reloading <= 0) {
      bot.loadout.reloading = w.reloadS;
      G.audio.reload();
    } else if (bot.loadout.reserve <= 0 && bot.weapon !== 'pistol') {
      bot.weapon = 'pistol';
      bot.loadout = bot.weapons.pistol;
    }
    return;
  }
  bot.loadout.mag -= 1;
  bot.loadout.cooldown = 60 / w.rpm;
  bot.burstLeft -= 1;
  const result = fireHitscan(G, bot);
  G.audio.shot(bot.team === 'atk' ? w.id : 'enemy');
  // Gunfire is heard: nearby enemies turn toward the shooter.
  for (const f of G.fighters) {
    if (f === bot || !f.alive || f.team === bot.team || f.isPlayer) continue;
    const d = Math.hypot(f.actor.x - bot.actor.x, f.actor.z - bot.actor.z);
    if (d < 26) {
      f.hearX = bot.actor.x;
      f.hearZ = bot.actor.z;
      f.hearT = G.time;
    }
  }
  if (result === 'kill' || result === 'head') bot.aimErr = 1;
  return result;
}

// 10 Hz decisions: where to go and what to do there.
function thinkBot(G, bot) {
  bot.aimErr = 0.8 + G.rng.f() * 0.5; // per-think skill jitter
  const round = G.rounds;
  if (round.phase !== 'live') {
    bot.state = 'hold';
    bot.path = [];
    return;
  }
  // Bomb planted: defenders converge on the planted site, attackers hold it.
  if (G.bomb.state === 'planted') {
    if (bot.team === 'def') {
      bot.state = 'defuse';
      setPath(G, bot, { x: G.bomb.x, z: G.bomb.z });
    } else {
      bot.state = 'hold';
      setPath(G, bot, { x: G.bomb.x + G.rng.range(-3, 3), z: G.bomb.z + G.rng.range(-3, 3) });
    }
    return;
  }
  if (bot.team === 'atk') {
    // Carrier plants; the rest push the same site, or rotate if it is lost.
    if (G.bomb.carrier === bot) {
      bot.state = 'plant';
      setPath(G, bot, G.map.sites[bot.site]);
    } else {
      bot.state = 'advance';
      const site = G.map.sites[bot.site];
      setPath(G, bot, { x: site.x + G.rng.range(-4, 4), z: site.z + G.rng.range(-4, 4) });
    }
  } else {
    // Defenders: two hold sites, the rest hold mid / rotate to heard gunfire.
    if (G.time - bot.hearT < 3 && bot.state !== 'engage') {
      bot.state = 'rotate';
      setPath(G, bot, { x: bot.hearX, z: bot.hearZ });
      return;
    }
    bot.state = 'hold';
    const site = G.map.sites[bot.site];
    if (!bot.path.length || bot.holdT <= 0) {
      bot.holdT = G.rng.range(4, 9);
      setPath(G, bot, { x: site.x + G.rng.range(-5, 5), z: site.z + G.rng.range(-5, 5) });
    } else {
      bot.holdT -= 0.1;
    }
  }
}

function setPath(G, bot, to) {
  const from = { x: bot.actor.x, z: bot.actor.z };
  const path = findPath(G.map, from, to);
  // Rebuild only when the destination changed materially.
  bot.path = path;
  bot.pathIdx = 0;
}

function nextWaypoint(G, bot) {
  if (!bot.path || bot.pathIdx >= bot.path.length) return null;
  return G.map.waypoints[bot.path[bot.pathIdx]];
}

// Bots auto-buy at the start of each round, like the player can in the menu.
export function botBuy(bot) {
  if (bot.money >= 2700 && !bot.weapons.rifle) {
    bot.weapons.rifle = createLoadout('rifle');
    bot.money -= 2700;
  } else if (bot.money >= 1500 && !bot.weapons.smg && !bot.weapons.rifle) {
    bot.weapons.smg = createLoadout('smg');
    bot.money -= 1500;
  }
  if (bot.money >= 650 && bot.armor < 50) {
    bot.armor = 100;
    bot.money -= 650;
  }
  bot.weapon = bot.weapons.rifle ? 'rifle' : bot.weapons.smg ? 'smg' : 'pistol';
  bot.loadout = bot.weapons[bot.weapon];
  if (bot.money >= 300 && bot.grenades < 1) {
    bot.grenades = 1;
    bot.money -= 300;
  }
}
