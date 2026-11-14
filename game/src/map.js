// EMBERLINE — Kiln Yard map. One original dusk industrial yard, ~44 x 36 m:
// attacker spawn south (z +15), defender spawn north (z -15), Site A "Furnace"
// west (-16, -10), Site B "Silo" east (16, -10), a mid lane through the kiln
// hall, three lanes plus a north connector. All geometry is axis-aligned boxes
// (plus a few cylinders the renderer draws from the same box list), so the
// simulation, the collision and the line-of-sight test all share one dataset.
//
// Coordinates: x east, z south, y up. A box is {x0,y0,z0,x1,y1,z1,kind}.
// kind: wall | crate | kiln | furnace | silo | pillar | ground (never collided).
export function buildMap() {
  const boxes = [];
  const add = (x0, y0, z0, x1, y1, z1, kind) => {
    boxes.push({ x0, y0, z0, x1, y1, z1, kind });
    return boxes[boxes.length - 1];
  };

  // Perimeter walls (height 4, thick 1).
  add(-22.5, 0, -18.5, 22.5, 4, -17.5, 'wall'); // north
  add(-22.5, 0, 17.5, 22.5, 4, 18.5, 'wall'); // south
  add(-22.5, 0, -18.5, -21.5, 4, 18.5, 'wall'); // west
  add(21.5, 0, -18.5, 22.5, 4, 18.5, 'wall'); // east

  // Kiln hall, centre: two long kiln drums (cylinders in render) on brick bases,
  // with a gap between them as the mid lane.
  add(-7, 0, -4, -3, 1.2, 4, 'kiln'); // west kiln base
  add(3, 0, -4, 7, 1.2, 4, 'kiln'); // east kiln base
  add(-7, 0, -6.5, -3, 3.4, -4, 'wall'); // hall north wall, west half
  add(3, 0, -6.5, 7, 3.4, -4, 'wall'); // hall north wall, east half
  add(-7, 0, 4, -5.4, 3.4, 6.5, 'wall'); // hall south wall, west
  add(5.4, 0, 4, 7, 3.4, 6.5, 'wall'); // hall south wall, east
  // Mid lane runs through the hall gap (x -3..3) and the south doorway (x -5.4..5.4).

  // Site A "Furnace", west: the furnace block itself + cover crates.
  add(-20, 0, -14, -15.5, 4.2, -6, 'furnace'); // furnace block (glowing mouth faces east)
  add(-13.5, 0, -13, -11.5, 1.3, -11, 'crate');
  add(-13.5, 0, -8.5, -11.5, 1.3, -6.5, 'crate');
  add(-19, 0, -4.5, -17, 1.1, -2.5, 'crate');
  add(-10, 0, -15.5, -8, 2.2, -13.5, 'crate'); // tall stack guarding A from mid

  // Site B "Silo", east: two grain silos (cylinders) + crates.
  add(15.5, 0, -14, 20, 5.5, -6, 'silo'); // silo pair footprint (rendered as cylinders)
  add(11.5, 0, -13, 13.5, 1.3, -11, 'crate');
  add(11.5, 0, -8.5, 13.5, 1.3, -6.5, 'crate');
  add(17, 0, -4.5, 19, 1.1, -2.5, 'crate');
  add(8, 0, -15.5, 10, 2.2, -13.5, 'crate'); // tall stack guarding B from mid

  // North connector (behind both sites, z -16..-13 corridor is open; add cover).
  add(-4, 0, -16.5, -2, 1.4, -14.5, 'crate');
  add(2, 0, -16.5, 4, 1.4, -14.5, 'crate');

  // Mid-lane cover: staggered crates and pillars so no lane is a clean crossfire.
  add(-1.5, 0, 8, 1.5, 1.25, 10, 'crate'); // south mid crate
  add(-12, 0, 6, -10, 1.25, 8, 'crate'); // west lane crate
  add(10, 0, 6, 12, 1.25, 8, 'crate'); // east lane crate
  add(-12, 0, -2, -10.4, 3.6, -0.4, 'pillar'); // west pillar
  add(10.4, 0, -2, 12, 3.6, -0.4, 'pillar'); // east pillar
  add(-16, 0, 10, -14, 1.1, 12, 'crate'); // attacker west cover
  add(14, 0, 10, 16, 1.1, 12, 'crate'); // attacker east cover
  add(-2, 0, 12.5, 2, 1.1, 14.5, 'crate'); // attacker spawn cover

  // Waypoint graph: ~24 nodes, one per lane junction and site approach.
  // Links are symmetric; bots path with BFS over this graph.
  const waypoints = [
    { x: 0, z: 15, links: [1, 2, 3] }, // 0 attacker spawn
    { x: -11, z: 13, links: [0, 4, 5] }, // 1 west lane south
    { x: 0, z: 11, links: [0, 6, 7] }, // 2 mid south door
    { x: 11, z: 13, links: [0, 8, 9] }, // 3 east lane south
    { x: -14, z: 9, links: [1, 10] }, // 4 west lane
    { x: -11, z: 2, links: [4, 11, 12] }, // 5 west lane north
    { x: 0, z: 0, links: [2, 13, 14] }, // 6 kiln hall centre
    { x: 0, z: 7, links: [2, 6] }, // 7 mid south inside hall
    { x: 14, z: 9, links: [3, 15] }, // 8 east lane
    { x: 11, z: 2, links: [8, 16, 17] }, // 9 east lane north
    { x: -15, z: -2, links: [5, 18] }, // 10 A approach west
    { x: -11, z: -5, links: [5, 13, 19] }, // 11 west mid junction
    { x: -6, z: -2, links: [11, 6, 20] }, // 12 hall west exit
    { x: -6, z: -8, links: [6, 11, 20, 21] }, // 13 north mid junction
    { x: 6, z: -2, links: [9, 6, 20] }, // 14 hall east exit
    { x: 15, z: -2, links: [9, 22] }, // 15 B approach east
    { x: 11, z: -5, links: [9, 14, 23] }, // 16 east mid junction
    { x: 6, z: -8, links: [14, 13, 21, 23] }, // 17 north mid junction east
    { x: -16, z: -8, links: [10, 19, 20] }, // 18 Site A west edge
    { x: -13, z: -10, links: [11, 18, 21] }, // 19 Site A (plant zone)
    { x: -3, z: -14, links: [12, 13, 18, 22] }, // 20 north connector west
    { x: 0, z: -15, links: [13, 17, 19, 23] }, // 21 defender spawn
    { x: 3, z: -14, links: [15, 17, 20, 22] }, // 22 north connector east
    { x: 13, z: -10, links: [16, 17, 22] }, // 23 Site B (plant zone)
  ];

  return {
    boxes,
    waypoints,
    bounds: { x0: -21.5, x1: 21.5, z0: -17.5, z1: 17.5 },
    sites: {
      A: { name: 'Furnace', x: -13.5, z: -10, r: 4.2 },
      B: { name: 'Silo', x: 13.5, z: -10, r: 4.2 },
    },
    spawns: {
      atk: [
        { x: -4, z: 15.5, yaw: Math.PI }, // facing north (yaw PI looks -z)
        { x: -1.5, z: 16, yaw: Math.PI },
        { x: 1.5, z: 16, yaw: Math.PI },
        { x: 4, z: 15.5, yaw: Math.PI },
        { x: 0, z: 14, yaw: Math.PI },
      ],
      def: [
        { x: -4, z: -15.5, yaw: 0 },
        { x: -1.5, z: -16, yaw: 0 },
        { x: 1.5, z: -16, yaw: 0 },
        { x: 4, z: -15.5, yaw: 0 },
        { x: 0, z: -14, yaw: 0 },
      ],
    },
  };
}

// Ray vs axis-aligned box (slab test). Returns the smallest t >= 0, or -1.
// o, d are {x,y,z} objects; d must be normalised. No allocation.
export function rayBox(o, d, b) {
  let tmin = 0;
  let tmax = Infinity;
  const axes = ['x', 'y', 'z'];
  for (let i = 0; i < 3; i++) {
    const a = axes[i];
    const inv = 1 / d[a];
    let t0 = (b[a + '0'] - o[a]) * inv;
    let t1 = (b[a + '1'] - o[a]) * inv;
    if (inv < 0) {
      const tmp = t0;
      t0 = t1;
      t1 = tmp;
    }
    if (t0 > tmin) tmin = t0;
    if (t1 < tmax) tmax = t1;
    if (tmax < tmin) return -1;
  }
  return tmin;
}

// True when the segment a->b is blocked by any map box (used for bot LOS).
// Tests in 2D at two heights so a low crate blocks a crouched sightline only.
export function segmentBlocked(ax, ay, az, bx, by, bz, boxes) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return false;
  const o = { x: ax, y: ay, z: az };
  const d = { x: dx / len, y: dy / len, z: dz / len };
  for (let i = 0; i < boxes.length; i++) {
    const t = rayBox(o, d, boxes[i]);
    if (t >= 0 && t < len) return true;
  }
  return false;
}

// Breadth-first path over the waypoint graph. Returns an array of waypoint
// indices from the nearest node to `from` to the nearest node to `to`.
export function findPath(map, from, to) {
  const wps = map.waypoints;
  let start = 0;
  let goal = 0;
  let best = Infinity;
  for (let i = 0; i < wps.length; i++) {
    const d = (wps[i].x - from.x) ** 2 + (wps[i].z - from.z) ** 2;
    if (d < best) {
      best = d;
      start = i;
    }
  }
  best = Infinity;
  for (let i = 0; i < wps.length; i++) {
    const d = (wps[i].x - to.x) ** 2 + (wps[i].z - to.z) ** 2;
    if (d < best) {
      best = d;
      goal = i;
    }
  }
  if (start === goal) return [goal];
  const prev = new Array(wps.length).fill(-1);
  const queue = [start];
  prev[start] = start;
  while (queue.length) {
    const cur = queue.shift();
    if (cur === goal) break;
    for (const n of wps[cur].links) {
      if (prev[n] === -1) {
        prev[n] = cur;
        queue.push(n);
      }
    }
  }
  if (prev[goal] === -1) return [goal];
  const path = [];
  let cur = goal;
  while (cur !== start) {
    path.unshift(cur);
    cur = prev[cur];
  }
  path.unshift(start);
  return path;
}
