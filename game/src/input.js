// Input for EMBERLINE: pointer lock mouse-look, WASD movement, crouch, jump,
// reload, weapon slots, grenade, plant/defuse and the buy menu. All state is
// polled by the simulation each fixed step; nothing here fires a shot by
// itself, so the sim stays the single source of truth.
export function createInput(canvas) {
  const input = {
    keys: new Set(),
    lookDX: 0,
    lookDY: 0,
    firing: false,
    locked: false,
    buyOpen: false,
    onKey: null, // (code) => void, set by main.js for one-shot keys
    onBuy: null, // (kind) => void, set by main.js for buy-menu clicks
    onPlay: null, // () => void, start button
  };

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    input.keys.add(e.code);
    if (e.code === 'KeyB') input.buyOpen = !input.buyOpen;
    if (input.onKey) input.onKey(e.code);
    if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => input.keys.delete(e.code));
  window.addEventListener('blur', () => {
    input.keys.clear();
    input.firing = false;
  });

  canvas.addEventListener('click', () => {
    if (!input.locked) {
      canvas.requestPointerLock?.();
    }
  });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
  });
  document.addEventListener('mousemove', (e) => {
    if (!input.locked) return;
    input.lookDX += e.movementX || 0;
    input.lookDY += e.movementY || 0;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) input.firing = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.firing = false;
  });
  // Buy menu buttons (event delegation; the menu is re-rendered by hud.js).
  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-buy]');
    if (btn && input.onBuy) input.onBuy(btn.getAttribute('data-buy'));
    if (e.target.closest?.('#play')) input.onPlay?.();
  });

  return input;
}

// Wish direction in world space from the held keys and the player's yaw.
export function wishDir(input, yaw) {
  let f = 0;
  let s = 0;
  if (input.keys.has('KeyW') || input.keys.has('ArrowUp')) f += 1;
  if (input.keys.has('KeyS') || input.keys.has('ArrowDown')) f -= 1;
  if (input.keys.has('KeyD') || input.keys.has('ArrowRight')) s += 1;
  if (input.keys.has('KeyA') || input.keys.has('ArrowLeft')) s -= 1;
  const slow = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight');
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  return { x: fx * f + rx * s, z: fz * f + rz * s, slow };
}
