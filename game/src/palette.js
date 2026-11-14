// EMBERLINE — Kiln Yard: the palette. Six colours carry the whole look, so every
// material, light and HUD element names one of these and nothing else.
export const PALETTE = {
  canvas: 0x171310, // page / sky backdrop
  surface: 0x241c16, // panels, crates, kiln brick
  hairline: 0x3a2f26, // edges, seams, HUD hairlines
  ink: 0xf2e8d8, // text, crosshair, tracer core
  muted: 0xa08b74, // secondary text, distant steel
  accent: 0xff7a2f, // ember orange: attackers, muzzle, bomb, buy highlights
  foe: 0x7fb3d5, // steel blue: defenders
  ally: 0xff7a2f, // allies wear the ember accent
  ground: 0x1d1712, // yard floor
  skyTop: 0x2a1f1a, // dusk gradient top
  skyBottom: 0x4a2c1c, // dusk gradient bottom (ember haze at the horizon)
  furnace: 0xff5a1a, // furnace mouth glow
  lamp: 0xffc27a, // yard lamps
};

// CSS twins of the same six, for index.html and the HUD.
export const CSS = {
  canvas: '#171310',
  surface: '#241c16',
  hairline: '#3a2f26',
  ink: '#f2e8d8',
  muted: '#a08b74',
  accent: '#ff7a2f',
  foe: '#7fb3d5',
};
