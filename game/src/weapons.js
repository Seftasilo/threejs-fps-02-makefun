// Weapons for EMBERLINE. Four original guns, one job each: the rifle is the
// accurate workhorse, the SMG is fast up close, the pistol is the fallback
// everyone starts with, and the frag is the only explosive. Spread and recoil
// punish firing on the move, so stopping to aim pays — the heart of the bounty.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P10 Sidearm', price: 300,
    damage: 26, headMul: 3, rpm: 320, auto: false,
    mag: 12, reserve: 36, reloadS: 1.4,
    spreadBase: 0.011, spreadMove: 0.030, spreadAir: 0.045, spreadShot: 0.004,
    recoil: 0.011, range: 60, tracer: 0xf2e8d8,
  },
  smg: {
    id: 'smg', name: 'Wasp-9', price: 1500,
    damage: 19, headMul: 3, rpm: 780, auto: true,
    mag: 32, reserve: 96, reloadS: 1.9,
    spreadBase: 0.016, spreadMove: 0.038, spreadAir: 0.055, spreadShot: 0.005,
    recoil: 0.008, range: 42, tracer: 0xffc27a,
  },
  rifle: {
    id: 'rifle', name: 'VK-47 Ember', price: 2700,
    damage: 34, headMul: 3, rpm: 600, auto: true,
    mag: 30, reserve: 90, reloadS: 2.4,
    spreadBase: 0.007, spreadMove: 0.026, spreadAir: 0.042, spreadShot: 0.0035,
    recoil: 0.016, range: 80, tracer: 0xff7a2f,
  },
  frag: {
    id: 'frag', name: 'Spark-1 Frag', price: 300,
    damage: 95, headMul: 1, rpm: 60, auto: false,
    mag: 1, reserve: 1, reloadS: 0.8,
    spreadBase: 0, spreadMove: 0, spreadAir: 0, spreadShot: 0,
    recoil: 0, range: 0, tracer: 0xff7a2f,
  },
};

export const BUY_ORDER = ['rifle', 'smg', 'pistol', 'frag'];

// A fresh loadout for one weapon kind: magazine + reserve, nothing shared.
export function createLoadout(kind) {
  const w = WEAPONS[kind];
  return { kind, mag: w.mag, reserve: w.reserve, reloading: 0, cooldown: 0, bloom: 0 };
}

// Current spread (radians) for a shooter: base + movement + air + bloom from
// recent shots. Bloom decays in combat.js after each shot.
export function spreadFor(w, loadout, speed, onGround, crouch) {
  let s = w.spreadBase;
  if (speed > 0.6) s += w.spreadMove * Math.min(1, speed / 5.2);
  if (!onGround) s += w.spreadAir;
  if (crouch) s *= 0.72;
  s += loadout.bloom;
  return s;
}

// View model: a small low-poly gun built from boxes, attached to the camera.
// Built once per weapon kind and reused; no per-frame allocation.
export function buildViewModel(kind) {
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: 0.55, metalness: 0.65 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.35, metalness: 0.85 });
  const ember = new THREE.MeshStandardMaterial({
    color: PALETTE.accent, roughness: 0.4, metalness: 0.3,
    emissive: PALETTE.accent, emissiveIntensity: 0.35,
  });
  const box = (w, h, d, x, y, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  if (kind === 'rifle') {
    box(0.07, 0.1, 0.62, 0, 0, -0.3, dark); // receiver
    box(0.05, 0.05, 0.5, 0, 0.02, -0.55, steel); // barrel
    box(0.06, 0.14, 0.1, 0, -0.08, -0.12, dark); // grip
    box(0.05, 0.12, 0.16, 0, -0.06, -0.32, steel); // magazine, curved look
    box(0.02, 0.03, 0.3, 0, 0.07, -0.42, ember); // ember heat strip
    box(0.04, 0.04, 0.06, 0, 0.06, -0.62, steel); // front sight
  } else if (kind === 'smg') {
    box(0.06, 0.09, 0.42, 0, 0, -0.24, dark);
    box(0.04, 0.04, 0.34, 0, 0.02, -0.42, steel);
    box(0.05, 0.13, 0.08, 0, -0.07, -0.1, dark);
    box(0.04, 0.16, 0.07, 0, -0.05, -0.26, steel);
    box(0.02, 0.02, 0.2, 0, 0.06, -0.34, ember);
  } else if (kind === 'frag') {
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0x3a2f26, roughness: 0.5, metalness: 0.7 }),
    );
    ball.position.set(0, -0.02, -0.28);
    group.add(ball);
    box(0.02, 0.05, 0.02, 0.02, 0.06, -0.28, steel); // pin
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.03, 0.006, 6, 12),
      new THREE.MeshStandardMaterial({ color: PALETTE.accent, roughness: 0.4, metalness: 0.6 }),
    );
    ring.position.set(0.05, 0.06, -0.28);
    group.add(ring);
  } else {
    // pistol
    box(0.05, 0.07, 0.26, 0, 0, -0.2, dark);
    box(0.045, 0.1, 0.07, 0, -0.07, -0.1, dark);
    box(0.02, 0.02, 0.1, 0, 0.045, -0.28, steel);
    box(0.015, 0.015, 0.12, 0, 0.03, -0.18, ember);
  }
  group.position.set(0.24, -0.22, -0.5);
  group.rotation.y = 0.06;
  group.scale.set(0.62, 0.62, 0.62);
  return group;
}
