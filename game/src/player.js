// Player (and bot) movement: acceleration, friction, crouch, jump and
// axis-separated AABB collision against the map boxes. One function moves any
// actor; bots reuse it so movement rules are identical for both teams.
export const STAND_HEIGHT = 1.7;
export const CROUCH_HEIGHT = 1.1;
export const HALF = 0.36; // body half-width
export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.05;

export function createActor(x, z, yaw) {
  return {
    x, z, y: 0, // y is feet height above the ground plane
    vx: 0, vz: 0, vy: 0,
    yaw, pitch: 0,
    crouch: false,
    onGround: true,
    height: STAND_HEIGHT,
    eye: EYE_STAND,
    speed: 0, // horizontal speed, for spread / HUD
  };
}

// Move an actor by its velocity for dt, sliding along boxes one axis at a time.
// Mutates a, writes a.onGround. No allocation.
export function moveActor(a, boxes, bounds, dt) {
  // X axis
  a.x += a.vx * dt;
  resolveAxis(a, boxes, 'x');
  // Z axis
  a.z += a.vz * dt;
  resolveAxis(a, boxes, 'z');
  // Y axis (gravity / jump)
  a.y += a.vy * dt;
  if (a.y <= 0) {
    a.y = 0;
    a.vy = 0;
    a.onGround = true;
  } else {
    a.onGround = false;
  }
  // World bounds
  if (a.x < bounds.x0 + HALF) a.x = bounds.x0 + HALF;
  if (a.x > bounds.x1 - HALF) a.x = bounds.x1 - HALF;
  if (a.z < bounds.z0 + HALF) a.z = bounds.z0 + HALF;
  if (a.z > bounds.z1 - HALF) a.z = bounds.z1 - HALF;
}

function resolveAxis(a, boxes, axis) {
  const minX = a.x - HALF;
  const maxX = a.x + HALF;
  const minZ = a.z - HALF;
  const maxZ = a.z + HALF;
  const minY = a.y;
  const maxY = a.y + a.height;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.y1 <= 0.05) continue; // ground-level trim never blocks
    if (maxX <= b.x0 || minX >= b.x1) continue;
    if (maxZ <= b.z0 || minZ >= b.z1) continue;
    if (maxY <= b.y0 || minY >= b.y1) continue;
    // Overlap: push back out along the moving axis.
    if (axis === 'x') {
      if (a.vx > 0) a.x = b.x0 - HALF;
      else if (a.vx < 0) a.x = b.x1 + HALF;
      a.vx = 0;
    } else {
      if (a.vz > 0) a.z = b.z0 - HALF;
      else if (a.vz < 0) a.z = b.z1 + HALF;
      a.vz = 0;
    }
  }
}

// Shared walk model: accel toward a wish direction, friction when no input,
// slower while crouched or walking (Shift), air control reduced.
// wish: {x, z} unit-ish direction in world space. Returns nothing; mutates a.
export function stepWalk(a, wish, wantCrouch, wantJump, dt) {
  const targetHeight = wantCrouch ? CROUCH_HEIGHT : STAND_HEIGHT;
  a.height += (targetHeight - a.height) * Math.min(1, dt * 14);
  a.eye = a.height <= 1.35 ? EYE_CROUCH : EYE_STAND;
  a.crouch = a.height < 1.4;

  const walkMul = wantCrouch ? 0.45 : 1;
  const maxSpeed = 5.2 * walkMul;
  const accel = a.onGround ? 42 : 12;
  const friction = a.onGround ? 10 : 0.4;

  const wx = wish.x;
  const wz = wish.z;
  const wl = Math.hypot(wx, wz);
  if (wl > 0.001) {
    const nx = wx / wl;
    const nz = wz / wl;
    a.vx += nx * accel * dt;
    a.vz += nz * accel * dt;
  } else {
    const f = Math.max(0, 1 - friction * dt);
    a.vx *= f;
    a.vz *= f;
  }
  // Clamp horizontal speed.
  const sp = Math.hypot(a.vx, a.vz);
  if (sp > maxSpeed) {
    const s = maxSpeed / sp;
    a.vx *= s;
    a.vz *= s;
  }
  a.speed = Math.hypot(a.vx, a.vz);

  // Gravity + jump.
  a.vy -= 22 * dt;
  if (wantJump && a.onGround) {
    a.vy = 7.2;
    a.onGround = false;
  }
  if (a.vy < -18) a.vy = -18;
}

// True when point (x, y, z) sits inside any map box (grenade / explosion tests).
export function pointInBoxes(x, y, z, boxes) {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && z >= b.z0 && z <= b.z1) return true;
  }
  return false;
}
