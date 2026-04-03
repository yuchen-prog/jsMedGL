// Unit tests for OrientationCube - pure logic (no WebGL)

import { describe, it, expect } from 'vitest';
import type { OrientationCubeConfig } from '@jsmedgl/renderer-3d';
import { DEFAULT_ORIENTATION_CUBE_CONFIG } from '@jsmedgl/renderer-3d';

// Copy of config merging logic from OrientationCube for isolated testing
function mergeConfig(partial: Partial<OrientationCubeConfig>): OrientationCubeConfig {
  return { ...DEFAULT_ORIENTATION_CUBE_CONFIG, ...partial };
}

// Copy of label screen position calculation for testing
function calculateLabelPosition(
  label: 'L' | 'R' | 'A' | 'P' | 'S' | 'I',
  rotationMatrix: Float32Array | number[],
  centerX: number,
  centerY: number,
  cubeSize: number
): { x: number; y: number } {
  const faceCenters: Record<string, [number, number, number]> = {
    L: [-1.15, 0, 0],
    R: [1.15, 0, 0],
    A: [0, 0, 1.15],
    P: [0, 0, -1.15],
    S: [0, 1.15, 0],
    I: [0, -1.15, 0],
  };

  const point = faceCenters[label];
  const x = point[0], y = point[1], z = point[2];

  // Transform by rotation matrix (column-major)
  const rx = rotationMatrix[0] * x + rotationMatrix[4] * y + rotationMatrix[8] * z;
  const ry = rotationMatrix[1] * x + rotationMatrix[5] * y + rotationMatrix[9] * z;

  return {
    x: centerX + rx * cubeSize * 0.35,
    y: centerY - ry * cubeSize * 0.35, // Flip Y
  };
}

describe('OrientationCube Logic', () => {

  // ── Config merging ──

  it('should merge with default config', () => {
    const config = mergeConfig({});
    expect(config.size).toBe(DEFAULT_ORIENTATION_CUBE_CONFIG.size);
    expect(config.position).toBe(DEFAULT_ORIENTATION_CUBE_CONFIG.position);
  });

  it('should override size in config', () => {
    const config = mergeConfig({ size: 150 });
    expect(config.size).toBe(150);
    expect(config.position).toBe('bottom-right');
  });

  it('should override position in config', () => {
    const config = mergeConfig({ position: 'top-left' });
    expect(config.size).toBe(100);
    expect(config.position).toBe('top-left');
  });

  it('should override both size and position', () => {
    const config = mergeConfig({ size: 80, position: 'bottom-left' });
    expect(config.size).toBe(80);
    expect(config.position).toBe('bottom-left');
  });

  // ── Position calculations ──

  it('should calculate label positions with identity matrix', () => {
    const identity = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
    const pos = calculateLabelPosition('R', identity, 100, 100, 100);
    // R label at [1.15, 0, 0] → should be to the right of center
    expect(pos.x).toBeGreaterThan(100);
    expect(pos.y).toBeCloseTo(100);
  });

  it('should flip L label to left of center', () => {
    const identity = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
    const pos = calculateLabelPosition('L', identity, 100, 100, 100);
    expect(pos.x).toBeLessThan(100);
    expect(pos.y).toBeCloseTo(100);
  });

  it('should place S label above center', () => {
    const identity = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
    const pos = calculateLabelPosition('S', identity, 100, 100, 100);
    // S at [0, 1.15, 0], after transform and Y flip:
    // ry = 1.15, y = 100 - 1.15 * 35 = ~60
    expect(pos.y).toBeLessThan(100);
  });

  it('should place I label below center', () => {
    const identity = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
    const pos = calculateLabelPosition('I', identity, 100, 100, 100);
    // I at [0, -1.15, 0], after Y flip:
    // ry = -1.15, y = 100 - (-1.15) * 35 = ~140
    expect(pos.y).toBeGreaterThan(100);
  });

  it('should rotate labels with rotation matrix', () => {
    // 90 degree rotation around Y axis
    const rotY90 = new Float32Array([
      0, 0, 1, 0,
      0, 1, 0, 0,
      -1, 0, 0, 0,
      0, 0, 0, 1,
    ]);
    // R label at [1.15, 0, 0] → after rotation rx=0 (points along +Z, not visible in XY)
    // So x position should be at center (100)
    const posR = calculateLabelPosition('R', rotY90, 100, 100, 100);
    expect(posR.x).toBeCloseTo(100, 0); // At center (viewed from side)
  });

  // ── Config validation ──

  it('should accept minimum size', () => {
    const config = mergeConfig({ size: 50 });
    expect(config.size).toBe(50);
  });

  it('should accept large size', () => {
    const config = mergeConfig({ size: 300 });
    expect(config.size).toBe(300);
  });

  it('should support all four positions', () => {
    const positions: OrientationCubeConfig['position'][] = [
      'bottom-right',
      'bottom-left',
      'top-right',
      'top-left',
    ];
    for (const pos of positions) {
      const config = mergeConfig({ position: pos });
      expect(config.position).toBe(pos);
    }
  });

  // ── Screen position calculation ──

  it('should scale label distance with cube size', () => {
    const identity = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
    const posSmall = calculateLabelPosition('R', identity, 100, 100, 50);
    const posLarge = calculateLabelPosition('R', identity, 100, 100, 200);
    // Larger cube should place label further from center
    expect(Math.abs(posLarge.x - 100)).toBeGreaterThan(Math.abs(posSmall.x - 100));
  });

  it('should offset based on center position', () => {
    const identity = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
    const pos1 = calculateLabelPosition('R', identity, 100, 100, 100);
    const pos2 = calculateLabelPosition('R', identity, 200, 200, 100);
    expect(pos2.x - pos2.y).toBeCloseTo(pos1.x - pos1.y);
  });
});
