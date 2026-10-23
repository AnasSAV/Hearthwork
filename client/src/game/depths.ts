/**
 * Render order. Players and houses use their feet / bottom y as depth (0 … map height), map
 * layers under them sit below 0, and the "above" layers (tree tops, lamp heads) and labels
 * go over everything in the world.
 */
export const GROUND_DEPTH = -10;
export const ABOVE_DEPTH = 100_000;
