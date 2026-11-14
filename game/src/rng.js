// Seeded randomness for EMBERLINE. One mulberry32 stream drives bot decisions,
// spread, spawn picks and shot-mode demos, so `?seed=N` replays the same round.
// The simulation never calls Math.random: determinism is a feature, not an accident.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed) {
    this.next = mulberry32(seed);
  }
  // Float in [0, 1).
  f() {
    return this.next();
  }
  // Float in [min, max).
  range(min, max) {
    return min + (max - min) * this.next();
  }
  // Integer in [0, n).
  int(n) {
    return (this.next() * n) | 0;
  }
  // One element of a non-empty array.
  pick(arr) {
    return arr[(this.next() * arr.length) | 0];
  }
  // True with probability p.
  chance(p) {
    return this.next() < p;
  }
  // Box-Muller gaussian, mean 0, stddev 1. Used for spread and bot aim error.
  gauss() {
    const u = Math.max(this.next(), 1e-9);
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}
