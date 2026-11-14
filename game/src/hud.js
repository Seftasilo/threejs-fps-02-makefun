// HUD for EMBERLINE: health, armour, ammo, timer, score, money, killfeed,
// buy menu, plant/defuse progress, round banner and the start/end overlays.
// The HUD reads the single game state G and writes the DOM; text is only
// rewritten when it changes, so the HUD costs nothing on a quiet frame.
import { WEAPONS } from './weapons.js';

export function createHudState() {
  return {
    plant: 0, defuse: 0,
    banner: null, // {text, sub, t}
    hitmark: 0, hurtFlash: 0, muzzle: 0,
  };
}

const _cache = {};

function el(id) {
  if (!_cache[id]) _cache[id] = document.getElementById(id);
  return _cache[id];
}

function setText(id, value) {
  const node = el(id);
  if (node && node._last !== value) {
    node._last = value;
    node.textContent = value;
  }
}

export function updateHud(G) {
  const p = G.player;
  const r = G.rounds;
  setText('hud-hp', String(Math.max(0, Math.ceil(p.hp))));
  setText('hud-armor', String(Math.ceil(p.armor)));
  const w = WEAPONS[p.weapon];
  setText('hud-weapon', w.name);
  setText('hud-mag', String(p.loadout.mag));
  setText('hud-reserve', '/ ' + String(p.loadout.reserve));
  setText('hud-money', '$' + p.money);
  setText('hud-score', r.score.atk + ' – ' + r.score.def);
  const t = Math.max(0, Math.ceil(r.phase === 'freeze' ? r.phaseT : r.timer));
  const mm = Math.floor(t / 60);
  const ss = String(t % 60).padStart(2, '0');
  setText('hud-timer', mm + ':' + ss);
  setText('hud-round', 'ROUND ' + r.num + ' / ' + 13);
  setText('buy-round', String(r.num));
  setText('hud-phase', r.phase === 'freeze' ? 'FREEZE — BUY (B)' : r.phase === 'live' ? 'LIVE' : 'ROUND OVER');

  // Health bar colour: ember when hurt.
  const hpBar = el('hud-hpbar');
  if (hpBar) {
    const pct = Math.max(0, p.hp) + '%';
    if (hpBar._last !== pct) {
      hpBar._last = pct;
      hpBar.style.width = pct;
      hpBar.style.background = p.hp <= 30 ? '#ff7a2f' : '#f2e8d8';
    }
  }
  // Crosshair spreads with the current weapon spread.
  const ch = el('crosshair');
  if (ch) {
    const gap = 4 + (p.loadout.bloom || 0) * 400 + p.actor.speed * 0.9;
    const v = gap.toFixed(1) + 'px';
    if (ch._last !== v) {
      ch._last = v;
      ch.style.setProperty('--gap', v);
    }
  }
  // Hitmarker / hurt flash.
  const hm = el('hitmarker');
  if (hm) hm.classList.toggle('on', G.fx.hitmark > 0);
  const hurt = el('hurt');
  if (hurt) hurt.style.opacity = G.fx.hurtFlash > 0 ? String(Math.min(0.4, G.fx.hurtFlash)) : '0';

  // Plant / defuse progress.
  const prog = el('progress');
  const progFill = el('progress-fill');
  const progLabel = el('progress-label');
  const pv = Math.max(G.hud.plant, G.hud.defuse);
  if (prog) prog.hidden = pv <= 0;
  if (progFill && pv > 0) progFill.style.width = Math.round(pv * 100) + '%';
  if (progLabel) setText('progress-label', G.hud.plant > 0 ? 'PLANTING…' : 'DEFUSING…');

  // Killfeed (newest first, five max).
  const kf = el('killfeed');
  if (kf) {
    const html = G.killfeed.map((k) => {
      const head = k.head ? ' <span class="head">HEADSHOT</span>' : '';
      return '<div><b>' + esc(k.killer) + '</b> → ' + esc(k.victim) + head + '</div>';
    }).join('');
    if (kf._last !== html) {
      kf._last = html;
      kf.innerHTML = html;
    }
  }

  // Round banner.
  const banner = el('banner');
  if (banner) {
    const b = G.hud.banner;
    if (b && b.t > 0) {
      banner.hidden = false;
      setText('banner-text', b.text);
      setText('banner-sub', b.sub);
    } else {
      banner.hidden = true;
    }
  }

  // Bomb status chip.
  const bomb = el('hud-bomb');
  if (bomb) {
    const bs = G.bomb.state;
    const label = bs === 'planted'
      ? 'BOMB PLANTED — ' + Math.ceil(G.bomb.fuse) + 's'
      : bs === 'carried' && G.bomb.carrier === p
        ? 'YOU CARRY THE BOMB — plant at A or B (hold E)'
        : bs === 'dropped'
          ? 'BOMB DROPPED — pick it up'
          : bs === 'exploded'
            ? 'BOMB DETONATED'
            : bs === 'defused'
              ? 'BOMB DEFUSED'
              : '';
    setText('hud-bomb', label);
    bomb.hidden = label === '';
  }

  // Buy menu (freeze phase, or B toggles it).
  const buy = el('buy');
  if (buy) {
    const open = G.input.buyOpen && r.phase === 'freeze' && !r.matchOver;
    buy.hidden = !open;
    if (open) renderBuy(G);
  }

  // Start / end overlays.
  const start = el('overlay-start');
  if (start) start.hidden = !G.showStart;
  const end = el('overlay-end');
  if (end) {
    end.hidden = !r.matchOver;
    if (r.matchOver) {
      setText('end-title', r.matchWinner === 'atk' ? 'EMBERLINE WINS THE MATCH' : r.matchWinner === 'def' ? 'DEFENDERS WIN THE MATCH' : 'DRAW');
      setText('end-score', r.score.atk + ' – ' + r.score.def);
      setText('end-stats', 'Kills ' + p.kills + ' · Deaths ' + p.deaths + ' · $' + p.money);
    }
  }
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function renderBuy(G) {
  const list = el('buy-list');
  if (!list) return;
  const p = G.player;
  const rows = [];
  for (const kind of ['rifle', 'smg', 'pistol', 'frag']) {
    const w = WEAPONS[kind];
    const owned = kind === 'frag' ? p.grenades > 0 : !!p.weapons[kind];
    const afford = p.money >= w.price;
    rows.push(
      '<button type="button" data-buy="' + kind + '" ' + (owned || !afford ? 'disabled' : '') + '>' +
      '<span class="buy-name">' + w.name + '</span>' +
      '<span class="buy-price">' + (owned ? 'OWNED' : '$' + w.price) + '</span></button>',
    );
  }
  const armorOwned = p.armor >= 100;
  rows.push(
    '<button type="button" data-buy="armor" ' + (armorOwned || p.money < 650 ? 'disabled' : '') + '>' +
    '<span class="buy-name">Kevlar Vest — absorbs 50%</span>' +
    '<span class="buy-price">' + (armorOwned ? 'OWNED' : '$650') + '</span></button>',
  );
  const html = rows.join('');
  if (list._last !== html) {
    list._last = html;
    list.innerHTML = html;
  }
}

// Buy one item for the player. Returns true on success.
export function buyItem(G, kind) {
  const p = G.player;
  if (G.rounds.phase !== 'freeze') return false;
  if (kind === 'armor') {
    if (p.armor >= 100 || p.money < 650) return false;
    p.armor = 100;
    p.money -= 650;
    G.audio.buy();
    return true;
  }
  const w = WEAPONS[kind];
  if (!w || p.money < w.price) return false;
  if (kind === 'frag') {
    if (p.grenades >= 2) return false;
    p.grenades += 1;
    p.money -= w.price;
    G.audio.buy();
    return true;
  }
  if (p.weapons[kind]) return false;
  p.weapons[kind] = { kind, mag: w.mag, reserve: w.reserve, reloading: 0, cooldown: 0, bloom: 0 };
  p.money -= w.price;
  p.weapon = kind;
  p.loadout = p.weapons[kind];
  G.audio.buy();
  return true;
}
