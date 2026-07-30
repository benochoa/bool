// Each photo snaps to the nearest of these standard ratios (width / height),
// independently — one photo's shape never affects another's.
export const STANDARD_ASPECT_RATIOS = [
  2 / 3,  // 0.667  portrait (tall)
  3 / 4,  // 0.750
  4 / 5,  // 0.800
  1,      // 1.000  square
  5 / 4,  // 1.250
  4 / 3,  // 1.333
  3 / 2,  // 1.500  landscape (wide)
];

// Card shape before any photo exists (empty edit slots).
export const DEFAULT_ASPECT = 1;

export function snapToStandardAspect(raw: number): number {
  return STANDARD_ASPECT_RATIOS.reduce((best, r) =>
    Math.abs(r - raw) < Math.abs(best - raw) ? r : best
  );
}
