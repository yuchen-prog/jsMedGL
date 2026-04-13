// Window/Level utilities for jsMedgl
// Shared between renderer-2d and renderer-3d.

import { getDataTypeSize, readVoxel } from '@jsmedgl/parser-nifti';

/**
 * Window/Level settings
 */
export interface WindowLevel {
  window: number;
  level: number;
}

/**
 * Window preset definition
 */
export interface WindowPreset {
  name: string;
  window: number;
  level: number;
}

/**
 * Predefined window/level presets (absolute HU-like values).
 * For 2D rendering, these apply to the normalized 0-255 range.
 */
export const DEFAULT_WINDOW_PRESETS: WindowPreset[] = [
  { name: 'Brain', window: 80, level: 40 },
  { name: 'Bone', window: 2000, level: 500 },
  { name: 'Lung', window: 1500, level: -600 },
  { name: 'Soft Tissue', window: 400, level: 40 },
  { name: 'Liver', window: 150, level: 30 },
];

/**
 * Apply window/level to a raw voxel value, producing a 0-255 normalized output.
 */
export function applyWindowLevel(value: number, window: number, level: number): number {
  const minValue = level - window / 2;
  const maxValue = level + window / 2;
  const range = maxValue - minValue;
  if (range <= 0) return value >= maxValue ? 255 : 0;
  const normalized = ((value - minValue) / range) * 255;
  return Math.max(0, Math.min(255, Math.round(normalized)));
}

/**
 * Compute auto window/level from raw volume data.
 * Uses a sampling approach for performance.
 */
export function computeAutoWindowLevel(
  data: ArrayBuffer,
  datatype: number,
  sampleStep?: number,
): { window: number; level: number } {
  const byteSize = getDataTypeSize(datatype);
  if (byteSize === 0) return { window: 255, level: 128 };

  const numVoxels = data.byteLength / byteSize;
  const step = sampleStep ?? Math.max(1, Math.floor(numVoxels / 10000));

  let vMin = Infinity;
  let vMax = -Infinity;

  for (let i = 0; i < numVoxels; i += step) {
    const v = readVoxel(data, i * byteSize, datatype);
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }

  const window = vMax - vMin;
  const level = (vMax + vMin) / 2;

  return { window: window > 0 ? window : 255, level };
}

/**
 * Build opacity LUT from window/level.
 * Values are in normalized 0-1 range (for 3D transfer functions).
 * Opacity ramp: 0 below window, smoothstep ramp within window, full above.
 */
export function buildOpacityLUT(window: number, level: number): Uint8Array {
  const lut = new Uint8Array(256);
  const halfW = window / 2;
  const lo = level - halfW;
  const hi = level + halfW;

  for (let i = 0; i < 256; i++) {
    const intensity = i / 255;
    if (intensity <= lo) {
      lut[i] = 0;
    } else if (intensity >= hi) {
      lut[i] = 255;
    } else {
      const t = (intensity - lo) / (hi - lo);
      const smooth = t * t * (3 - 2 * t);
      lut[i] = Math.round(smooth * 255);
    }
  }

  return lut;
}
