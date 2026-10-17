// Isometric 2:1 maths. The generator's iso8 view looks along world north with a 30° pitch, so a metre east is
// `ppm` px right and a metre north is ppm/2 px up. Tiles are 64×32 diamonds whose edges run along the world
// diagonals: with ppm 32 one tile edge is √2 m (FB-002: there is no tile lock, the ppm is worked out by hand).
export const TILE_W = 64;
export const TILE_H = 32;

/** Ground-plane screen pixels of a tile centre (i to the lower right, j to the lower left). */
export function tileToScreen(i: number, j: number) {
  return { x: (i - j) * (TILE_W / 2), y: (i + j) * (TILE_H / 2) };
}

export function screenToTile(x: number, y: number) {
  return { i: (x / (TILE_W / 2) + y / (TILE_H / 2)) / 2, j: (y / (TILE_H / 2) - x / (TILE_W / 2)) / 2 };
}

/** The generator's 8 direction names, counter-clockwise from east (world angles 0, 45, …). */
export const DIRS8 = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'] as const;
export type Dir8 = (typeof DIRS8)[number];

/** World direction (x east, y north) → nearest of the 8 direction names. */
export function dirFromWorld(dx: number, dy: number): Dir8 {
  const a = Math.atan2(dy, dx);
  const i = Math.round(a / (Math.PI / 4));
  return DIRS8[((i % 8) + 8) % 8];
}

/** Metres in the world (x east, y north) → screen pixel offset. */
export function worldToScreenDelta(dx: number, dy: number, ppm: number) {
  return { x: dx * ppm, y: -dy * ppm * 0.5 };
}

/** Screen pixel offset → world metres. */
export function screenToWorldDelta(sx: number, sy: number, ppm: number) {
  return { x: sx / ppm, y: -sy / (ppm * 0.5) };
}
