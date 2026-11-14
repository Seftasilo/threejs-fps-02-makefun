// The bomb for EMBERLINE: carried, dropped, planted (40 s fuse) or defused.
// Planting takes 4 s holding E inside a site; defusing takes 5 s. Bots plant
// and defuse on their own when the state machine puts them there; the player
// plants/defuses by holding E. Round outcomes are reported through
// G.roundEnd, which rounds.js consumes.
export function createBomb() {
  return {
    state: 'carried', // carried | dropped | planting | planted | defused | exploded
    carrier: null,
    x: 0, z: 0,
    site: null,
    plantProgress: 0,
    defuseProgress: 0,
    fuse: 40,
    beepT: 0,
  };
}

function siteAt(G, x, z) {
  for (const key of ['A', 'B']) {
    const s = G.map.sites[key];
    const dx = x - s.x;
    const dz = z - s.z;
    if (dx * dx + dz * dz < s.r * s.r) return key;
  }
  return null;
}

export function stepBomb(G, dt) {
  const b = G.bomb;
  if (G.rounds.phase !== 'live') return;

  if (b.state === 'carried' || b.state === 'planting') {
    const carrier = b.carrier;
    if (!carrier || !carrier.alive) {
      if (b.state === 'planting') b.state = 'carried';
      return;
    }
    const site = siteAt(G, carrier.actor.x, carrier.actor.z);
    const wantsPlant = carrier.isPlayer
      ? G.input.keys.has('KeyE') && !G.input.buyOpen
      : carrier.state === 'plant' && site;
    if (site && wantsPlant) {
      b.state = 'planting';
      b.site = site;
      b.plantProgress += dt;
      if (carrier.isPlayer) G.hud.plant = b.plantProgress / 4;
      if (b.plantProgress >= 4) {
        b.state = 'planted';
        b.x = carrier.actor.x;
        b.z = carrier.actor.z;
        b.fuse = 40;
        b.plantProgress = 0;
        carrier.money += 300; // plant reward
        G.audio.plantTick();
        G.killfeed.unshift({ killer: 'BOMB', victim: 'planted at Site ' + site, head: false, t: G.time });
        if (G.killfeed.length > 5) G.killfeed.pop();
      }
    } else {
      if (b.state === 'planting') b.state = 'carried';
      b.plantProgress = Math.max(0, b.plantProgress - dt * 2);
      if (carrier.isPlayer) G.hud.plant = 0;
    }
    return;
  }

  if (b.state === 'planted') {
    b.fuse -= dt;
    b.beepT -= dt;
    if (b.beepT <= 0) {
      b.beepT = b.fuse < 10 ? 0.5 : 1;
      G.audio.beep();
    }
    // Defuse: a defender standing on the bomb, holding E (player) or in
    // defuse state (bot), for 5 s.
    let defuser = null;
    for (const f of G.fighters) {
      if (!f.alive || f.team !== 'def') continue;
      const dx = f.actor.x - b.x;
      const dz = f.actor.z - b.z;
      if (dx * dx + dz * dz > 2.25) continue;
      const wants = f.isPlayer ? G.input.keys.has('KeyE') : f.state === 'defuse';
      if (wants) {
        defuser = f;
        break;
      }
    }
    if (defuser) {
      b.defuseProgress += dt;
      if (defuser.isPlayer) G.hud.defuse = b.defuseProgress / 5;
      if (b.defuseProgress >= 5) {
        b.state = 'defused';
        b.defuseProgress = 0;
        G.roundEnd = { winner: 'def', reason: 'bomb defused' };
        return;
      }
    } else {
      b.defuseProgress = Math.max(0, b.defuseProgress - dt * 2);
      if (G.player) G.hud.defuse = 0;
    }
    if (b.fuse <= 0) {
      b.state = 'exploded';
      G.fx.explosions.push({ x: b.x, y: 0.6, z: b.z, life: 1.2, max: 1.2 });
      G.audio.explosion();
      // The blast kills everyone still on the site.
      for (const f of G.fighters) {
        if (!f.alive) continue;
        const dx = f.actor.x - b.x;
        const dz = f.actor.z - b.z;
        if (dx * dx + dz * dz < 49) {
          f.hp = 0;
          f.alive = false;
          f.deaths += 1;
        }
      }
      G.roundEnd = { winner: 'atk', reason: 'bomb detonated' };
    }
  }
}
