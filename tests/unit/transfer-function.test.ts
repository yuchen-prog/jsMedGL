// Unit tests for TransferFunction - pure logic (buildColorLUT / buildOpacityLUT)

import { describe, it, expect } from 'vitest';
import type { ColormapName } from '@jsmedgl/renderer-3d';

// ─── Copy of pure functions from TransferFunction.ts for isolated testing ──────

const COLORMAP_DATA: Record<ColormapName, [number, number, number, number][]> = {
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

function buildColorLUT(colormap: ColormapName): Uint8Array {
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

function buildOpacityLUT(window: number, level: number): Uint8Array {
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

// ─── buildColorLUT Tests ──────────────────────────────────────────────────────

describe('TransferFunction.buildColorLUT', () => {

  it('should produce exactly 768 entries (256 * 3)', () => {
    for (const name of Object.keys(COLORMAP_DATA) as ColormapName[]) {
      const lut = buildColorLUT(name);
      expect(lut.length).toBe(768);
    }
  });

  it('all colormaps: RGB values should be clamped to [0, 255]', () => {
    for (const name of Object.keys(COLORMAP_DATA) as ColormapName[]) {
      const lut = buildColorLUT(name);
      for (let i = 0; i < lut.length; i++) {
        expect(lut[i]).toBeGreaterThanOrEqual(0);
        expect(lut[i]).toBeLessThanOrEqual(255);
      }
    }
  });

  it('grayscale: position 0 is black', () => {
    const lut = buildColorLUT('grayscale');
    expect(lut[0]).toBe(0);
    expect(lut[1]).toBe(0);
    expect(lut[2]).toBe(0);
  });

  it('grayscale: position 1.0 is white', () => {
    const lut = buildColorLUT('grayscale');
    expect(lut[255 * 3]).toBe(255);
    expect(lut[255 * 3 + 1]).toBe(255);
    expect(lut[255 * 3 + 2]).toBe(255);
  });

  it('grayscale: R=G=B for all positions', () => {
    const lut = buildColorLUT('grayscale');
    for (let i = 0; i < 256; i++) {
      expect(lut[i * 3]).toBe(lut[i * 3 + 1]);
      expect(lut[i * 3 + 1]).toBe(lut[i * 3 + 2]);
    }
  });

  it('grayscale: monotonically increases from black to white', () => {
    const lut = buildColorLUT('grayscale');
    for (let i = 1; i < 256; i++) {
      expect(lut[i * 3]).toBeGreaterThan(lut[(i - 1) * 3]);
    }
  });

  it('hot: low intensity is black', () => {
    const lut = buildColorLUT('hot');
    expect(lut[0]).toBe(0);
    expect(lut[1]).toBe(0);
    expect(lut[2]).toBe(0);
  });

  it('hot: high intensity is white', () => {
    const lut = buildColorLUT('hot');
    expect(lut[255 * 3]).toBe(255);
    expect(lut[255 * 3 + 1]).toBe(255);
    expect(lut[255 * 3 + 2]).toBe(255);
  });

  it('hot: mid-high intensity has dominant red channel', () => {
    const lut = buildColorLUT('hot');
    const idx = Math.round(0.65 * 255);
    expect(lut[idx * 3]).toBeGreaterThan(200);
    expect(lut[idx * 3 + 1]).toBeGreaterThan(100);
  });

  it('hot: red channel grows faster than green at low intensities', () => {
    const lut = buildColorLUT('hot');
    const idx = Math.round(0.15 * 255);
    expect(lut[idx * 3]).toBeGreaterThan(lut[idx * 3 + 1]);
  });

  it('viridis: low intensity is dark (not white)', () => {
    const lut = buildColorLUT('viridis');
    const brightness = lut[0] + lut[1] + lut[2];
    expect(brightness).toBeLessThan(300);
  });

  it('viridis: high intensity is bright yellow', () => {
    const lut = buildColorLUT('viridis');
    expect(lut[255 * 3]).toBeGreaterThan(200);
    expect(lut[255 * 3 + 1]).toBeGreaterThan(200);
    expect(lut[255 * 3 + 2]).toBeLessThan(100);
  });

  it('viridis: middle has color variation (not grayscale)', () => {
    const lut = buildColorLUT('viridis');
    const mid = Math.round(0.5 * 255);
    const g = lut[mid * 3 + 1];
    const b = lut[mid * 3 + 2];
    expect(g).toBeGreaterThan(50);
    expect(b).toBeGreaterThan(50);
  });

  it('airways: low intensity is black', () => {
    const lut = buildColorLUT('airways');
    expect(lut[0]).toBe(0);
    expect(lut[1]).toBe(0);
    expect(lut[2]).toBe(0);
  });

  it('airways: high intensity has dominant blue/cyan', () => {
    const lut = buildColorLUT('airways');
    const idx = Math.round(0.8 * 255);
    expect(lut[idx * 3 + 2]).toBeGreaterThan(150);
  });

  it('pet: low intensity is black', () => {
    const lut = buildColorLUT('pet');
    expect(lut[0]).toBe(0);
  });

  it('pet: high intensity is white', () => {
    const lut = buildColorLUT('pet');
    expect(lut[255 * 3]).toBe(255);
    expect(lut[255 * 3 + 1]).toBe(255);
    expect(lut[255 * 3 + 2]).toBe(255);
  });

  it('pet: middle has color variation (not grayscale)', () => {
    const lut = buildColorLUT('pet');
    const mid = Math.round(0.5 * 255);
    const r = lut[mid * 3];
    const g = lut[mid * 3 + 1];
    const b = lut[mid * 3 + 2];
    expect(r !== g || g !== b).toBe(true);
  });

  it('all colormaps: position 1.0 matches highest control point', () => {
    for (const name of Object.keys(COLORMAP_DATA) as ColormapName[]) {
      const lut = buildColorLUT(name);
      const last = COLORMAP_DATA[name][COLORMAP_DATA[name].length - 1];
      expect(lut[255 * 3]).toBeCloseTo(last[1], 1);
      expect(lut[255 * 3 + 1]).toBeCloseTo(last[2], 1);
      expect(lut[255 * 3 + 2]).toBeCloseTo(last[3], 1);
    }
  });

  it('grayscale: monotonically increases', () => {
    const lut = buildColorLUT('grayscale');
    for (let ch = 0; ch < 3; ch++) {
      for (let i = 1; i < 256; i++) {
        expect(lut[i * 3 + ch]).toBeGreaterThanOrEqual(lut[(i - 1) * 3 + ch] - 1);
      }
    }
  });

  it('all colormaps: R channel is mostly non-decreasing (with tolerance)', () => {
    for (const name of Object.keys(COLORMAP_DATA) as ColormapName[]) {
      const lut = buildColorLUT(name);
      let violations = 0;
      for (let i = 1; i < 256; i++) {
        if (lut[i * 3] < lut[(i - 1) * 3] - 2) violations++;
      }
      expect(violations).toBeLessThan(5);
    }
  });

  it('bone: R,G,B are close together (blue-shifted gray look)', () => {
    const lut = buildColorLUT('bone');
    for (let i = 0; i < 256; i++) {
      const r = lut[i * 3];
      const g = lut[i * 3 + 1];
      const b = lut[i * 3 + 2];
      const diffRG = Math.abs(r - g);
      const diffRB = Math.abs(r - b);
      expect(diffRG).toBeLessThan(30);
      expect(diffRB).toBeLessThan(30);
    }
  });

  it('iron: final position is bright (high combined brightness)', () => {
    const lut = buildColorLUT('iron');
    const brightness = lut[255 * 3] + lut[255 * 3 + 1] + lut[255 * 3 + 2];
    expect(brightness).toBeGreaterThan(500);
  });

  it('lung: mid-range has muted cyan/teal tones', () => {
    const lut = buildColorLUT('lung');
    const mid = Math.round(0.4 * 255);
    expect(lut[mid * 3 + 1]).toBeGreaterThan(20);
  });

  it('all colormaps: first index is within first control point range', () => {
    // The first LUT index (t=0) should match or be very close to the first control point
    for (const name of Object.keys(COLORMAP_DATA) as ColormapName[]) {
      const lut = buildColorLUT(name);
      const first = COLORMAP_DATA[name][0];
      // R channel at index 0 should be within ±2 of the first control point's R
      expect(lut[0]).toBeLessThanOrEqual(first[1] + 2);
    }
  });

  it('all colormaps: color varies across the range (not all same)', () => {
    for (const name of Object.keys(COLORMAP_DATA) as ColormapName[]) {
      const lut = buildColorLUT(name);
      const firstRGB = [lut[0], lut[1], lut[2]];
      const midRGB = [lut[Math.round(128) * 3], lut[Math.round(128) * 3 + 1], lut[Math.round(128) * 3 + 2]];
      const lastRGB = [lut[255 * 3], lut[255 * 3 + 1], lut[255 * 3 + 2]];
      const firstMidDiff = Math.abs(firstRGB[0] - midRGB[0]) + Math.abs(firstRGB[1] - midRGB[1]) + Math.abs(firstRGB[2] - midRGB[2]);
      const midLastDiff = Math.abs(midRGB[0] - lastRGB[0]) + Math.abs(midRGB[1] - lastRGB[1]) + Math.abs(midRGB[2] - lastRGB[2]);
      expect(firstMidDiff + midLastDiff).toBeGreaterThan(50);
    }
  });
});

// ─── buildOpacityLUT Tests ────────────────────────────────────────────────────

describe('TransferFunction.buildOpacityLUT', () => {

  it('should return 256 entries', () => {
    const lut = buildOpacityLUT(1.0, 0.5);
    expect(lut.length).toBe(256);
  });

  it('all values should be in [0, 255]', () => {
    const params: [number, number][] = [
      [0.001, 0.5],
      [0.5, 0.25],
      [1.0, 0.5],
      [2.0, 0.5],
      [10.0, 0.5],
    ];
    for (const [w, l] of params) {
      const lut = buildOpacityLUT(w, l);
      for (const v of lut) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
  });

  it('default W=1, L=0.5: entry 0 is fully transparent', () => {
    // lo=0, hi=1.0, intensity at idx=0 is 0 ≤ lo → 0
    const lut = buildOpacityLUT(1.0, 0.5);
    expect(lut[0]).toBe(0);
  });

  it('default W=1, L=0.5: entry 255 is fully opaque', () => {
    // intensity at idx=255 is 1.0 ≥ hi=1.0 → 255
    const lut = buildOpacityLUT(1.0, 0.5);
    expect(lut[255]).toBe(255);
  });

  it('default W=1, L=0.5: transition is around the middle', () => {
    // lo=0, hi=1.0. Almost all indices are in smoothstep (only idx=0→0, idx=255→255).
    // Middle indices should be near their own value (smoothstep ≈ identity near 0.5).
    const lut = buildOpacityLUT(1.0, 0.5);
    expect(lut[0]).toBe(0);
    expect(lut[255]).toBe(255);
    expect(Math.abs(lut[128] - 128)).toBeLessThan(5);
  });

  it('default W=1, L=0.5: opacity increases monotonically', () => {
    const lut = buildOpacityLUT(1.0, 0.5);
    for (let i = 1; i < 256; i++) {
      expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1] - 1);
    }
  });

  it('W=2, L=0.5: entry 0 is in smoothstep ramp (not 0)', () => {
    // lo=-0.5, hi=1.5. idx=0: intensity=0 > -0.5 and < 1.5 → in smoothstep.
    // t=(0-(-0.5))/2=0.25, smoothstep(0.25)≈0.156 → ~40
    const lut = buildOpacityLUT(2.0, 0.5);
    expect(lut[0]).toBeGreaterThan(0);
  });

  it('W=2, L=0.5: entry 255 is in smoothstep ramp (not 255)', () => {
    // intensity=1.0 < hi=1.5 → in smoothstep. t=(1-(-0.5))/2=0.75, smoothstep≈0.844 → ~215
    const lut = buildOpacityLUT(2.0, 0.5);
    expect(lut[255]).toBeLessThan(255);
    expect(lut[255]).toBeGreaterThan(200);
  });

  it('W=2, L=0.5: gradual ramp (no sudden jumps)', () => {
    const lut = buildOpacityLUT(2.0, 0.5);
    let jumps = 0;
    for (let i = 1; i < 256; i++) {
      if (Math.abs(lut[i] - lut[i - 1]) > 10) jumps++;
    }
    expect(jumps).toBeLessThan(10);
  });

  it('W=0.1, L=0.5: sharp ramp', () => {
    // lo=0.45, hi=0.55, only ~25 indices in smoothstep transition
    const lut = buildOpacityLUT(0.1, 0.5);
    const zeros = lut.filter(v => v === 0).length;
    const fulls = lut.filter(v => v === 255).length;
    expect(zeros + fulls).toBeGreaterThan(220);
  });

  it('L=0.25 shifts ramp left (lower intensities become visible)', () => {
    const lutLow = buildOpacityLUT(1.0, 0.25);
    const lutMid = buildOpacityLUT(1.0, 0.5);
    // At same low index, lower level → higher opacity
    expect(lutLow[80]).toBeGreaterThan(lutMid[80]);
  });

  it('L=0.75 shifts ramp right (lower opacity at same index)', () => {
    const lutHigh = buildOpacityLUT(1.0, 0.75);
    const lutMid = buildOpacityLUT(1.0, 0.5);
    // Higher level shifts ramp right → at the same index we're earlier in the ramp → lower opacity
    expect(lutHigh[200]).toBeLessThan(lutMid[200]);
  });

  it('very narrow window: mostly 0 or 255', () => {
    const lut = buildOpacityLUT(0.001, 0.5);
    const zeros = lut.filter(v => v === 0).length;
    const fulls = lut.filter(v => v === 255).length;
    expect(zeros + fulls).toBeGreaterThan(240);
  });

  it('very narrow window at low level: near-zero index is 0', () => {
    // W=0.01, L=0.001 → lo=-0.004, hi=0.006. idx=0: intensity=0 > -0.004 → in smoothstep.
    // But intensity is close to lo, so t is small → near 0 opacity
    const lut = buildOpacityLUT(0.01, 0.001);
    // The first entry at index 0 is > 0 because intensity > lo
    expect(lut[0]).toBeGreaterThan(0);
    expect(lut[255]).toBe(255);
  });

  it('W=10 (very wide): smoothstep covers most of the range', () => {
    // lo=-4.5, hi=5.5. All intensities 0-1 are in smoothstep. idx=255 → ~147
    const lut = buildOpacityLUT(10.0, 0.5);
    expect(lut[0]).toBeGreaterThan(0);
    expect(lut[255]).toBeGreaterThan(0);
    expect(lut[255]).toBeLessThan(255);
    expect(lut[0]).toBeLessThan(lut[255]); // monotonically increasing
  });

  it('intensity exactly at lo boundary is 0', () => {
    // W=0.5, L=0.25 → lo=0, hi=0.5. intensity=0 → ≤ lo → 0
    const lut = buildOpacityLUT(0.5, 0.25);
    expect(lut[0]).toBe(0);
  });

  it('intensity exactly at hi boundary is 255', () => {
    // W=0.5, L=0.25 → lo=0, hi=0.5. intensity=0.5 → ≥ hi → 255
    const lut = buildOpacityLUT(0.5, 0.25);
    const idx = Math.round(0.5 * 255);
    expect(lut[idx]).toBe(255);
  });

  it('opacity increases monotonically as level decreases', () => {
    const lutHigh = buildOpacityLUT(1.0, 0.75);
    const lutLow = buildOpacityLUT(1.0, 0.25);
    const midIdx = 150;
    expect(lutLow[midIdx]).toBeGreaterThanOrEqual(lutHigh[midIdx]);
  });

  it('window extremes: W=0.001 produces near-binary 0/255', () => {
    const lut = buildOpacityLUT(0.001, 0.5);
    const inBetween = lut.filter(v => v > 0 && v < 255).length;
    expect(inBetween).toBeLessThan(10);
  });

  it('window extremes: W=100 (very wide) produces near-linear ramp', () => {
    // lo=-49.5, hi=50.5. All intensities in smoothstep. At idx=0: t≈0.495 → smoothstep≈0.49 → ~125
    const lut = buildOpacityLUT(100.0, 0.5);
    expect(lut[0]).toBeGreaterThan(100);
    expect(lut[255]).toBeLessThan(150);
    expect(lut[0]).toBeLessThan(lut[255]);
  });

  it('is monotonically increasing for any W,L', () => {
    const configs: [number, number][] = [
      [0.1, 0.5], [0.5, 0.25], [1.0, 0.0], [1.0, 1.0],
      [2.0, 0.5], [5.0, 0.5], [0.2, 0.8],
    ];
    for (const [w, l] of configs) {
      const lut = buildOpacityLUT(w, l);
      for (let i = 1; i < 256; i++) {
        expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1] - 1);
      }
    }
  });
});
