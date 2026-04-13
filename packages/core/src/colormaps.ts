// Colormap definitions and LUT generation for jsMedgl
// Shared between renderer-2d and renderer-3d.

/**
 * Available colormap names
 */
export type ColormapName =
  | 'grayscale'
  | 'hot'
  | 'bone'
  | 'iron'
  | 'viridis'
  | 'airways'
  | 'angiography'
  | 'pet'
  | 'soft_tissue'
  | 'lung';

/**
 * Colormap control point: [position (0-1), R, G, B]
 */
type ColormapControlPoint = [number, number, number, number];

/**
 * Colormap data: array of [position, R, G, B] control points.
 * Interpolated to fill a 256-entry LUT.
 */
const COLORMAP_DATA: Record<ColormapName, ColormapControlPoint[]> = {
  grayscale: [
    [0.0, 0, 0, 0],
    [1.0, 255, 255, 255],
  ],
  hot: [
    [0.0, 0, 0, 0],
    [0.3, 255, 0, 0],
    [0.6, 255, 255, 0],
    [1.0, 255, 255, 255],
  ],
  bone: [
    [0.0, 0, 0, 0],
    [0.3, 80, 80, 90],
    [0.6, 160, 160, 170],
    [1.0, 255, 255, 255],
  ],
  iron: [
    [0.0, 0, 0, 20],
    [0.25, 30, 0, 120],
    [0.5, 200, 0, 0],
    [0.75, 255, 200, 0],
    [1.0, 255, 255, 255],
  ],
  viridis: [
    [0.0, 68, 1, 84],
    [0.25, 59, 82, 139],
    [0.5, 33, 145, 140],
    [0.75, 94, 201, 98],
    [1.0, 253, 231, 37],
  ],
  airways: [
    [0.0, 0, 0, 0],
    [0.2, 0, 40, 60],
    [0.5, 0, 120, 160],
    [0.8, 100, 200, 230],
    [1.0, 220, 255, 255],
  ],
  angiography: [
    [0.0, 0, 0, 0],
    [0.2, 80, 80, 80],
    [0.4, 200, 200, 200],
    [0.6, 255, 100, 50],
    [0.8, 255, 180, 0],
    [1.0, 255, 255, 100],
  ],
  pet: [
    [0.0, 0, 0, 0],
    [0.15, 50, 0, 80],
    [0.3, 0, 0, 180],
    [0.45, 0, 120, 200],
    [0.6, 0, 200, 80],
    [0.75, 200, 220, 0],
    [0.9, 255, 80, 0],
    [1.0, 255, 255, 255],
  ],
  soft_tissue: [
    [0.0, 0, 0, 0],
    [0.3, 60, 40, 35],
    [0.6, 160, 130, 110],
    [1.0, 255, 240, 225],
  ],
  lung: [
    [0.0, 0, 0, 0],
    [0.15, 0, 30, 30],
    [0.4, 50, 90, 90],
    [0.7, 150, 160, 160],
    [1.0, 255, 255, 255],
  ],
};

/**
 * Get the raw colormap control points for a given colormap name.
 */
export function getColormapData(name: ColormapName): ColormapControlPoint[] {
  return COLORMAP_DATA[name];
}

/**
 * Interpolate colormap control points into a 256-entry RGB array (768 bytes).
 */
export function buildColorLUT(colormap: ColormapName): Uint8Array {
  const controlPoints = COLORMAP_DATA[colormap];
  const lut = new Uint8Array(256 * 3);

  for (let i = 0; i < 256; i++) {
    const t = i / 255;

    let lo = controlPoints[0];
    let hi = controlPoints[controlPoints.length - 1];

    for (let j = 0; j < controlPoints.length - 1; j++) {
      if (t >= controlPoints[j][0] && t <= controlPoints[j + 1][0]) {
        lo = controlPoints[j];
        hi = controlPoints[j + 1];
        break;
      }
    }

    const range = hi[0] - lo[0];
    const f = range > 0 ? (t - lo[0]) / range : 0;

    lut[i * 3 + 0] = Math.round(lo[1] + (hi[1] - lo[1]) * f);
    lut[i * 3 + 1] = Math.round(lo[2] + (hi[2] - lo[2]) * f);
    lut[i * 3 + 2] = Math.round(lo[3] + (hi[3] - lo[3]) * f);
  }

  return lut;
}

/**
 * Get all available colormap names.
 */
export function getColormapNames(): ColormapName[] {
  return Object.keys(COLORMAP_DATA) as ColormapName[];
}
