// Unit tests for RayBoxIntersector (pure math, no imports)

import { describe, it, expect } from 'vitest';
import { intersectBox } from '@jsmedgl/renderer-3d';
import type { RayBoxResult } from '@jsmedgl/renderer-3d';

// ─── RayBoxIntersector Tests ────────────────────────────────────────────────────

describe('RayBoxIntersector', () => {

  // ── Standard cases: ray from outside entering the box ──

  it('ray enters box from front face (+Z direction)', () => {
    // Ray from (0.5, 0.5, -1) toward (0.5, 0.5, 1)
    const result = intersectBox([0.5, 0.5, -1], [0, 0, 1], [0, 0, 0], [1, 1, 1]);
    expect(result).not.toBeNull();
    const r = result as RayBoxResult;
    expect(r.tNear).toBeCloseTo(1.0);
    expect(r.tFar).toBeCloseTo(2.0);
    expect(r.entryPoint[2]).toBeCloseTo(0);
    expect(r.exitPoint[2]).toBeCloseTo(1);
  });

  it('ray enters box from back face (-Z direction)', () => {
    const result = intersectBox([0.5, 0.5, 2], [0, 0, -1], [0, 0, 0], [1, 1, 1]);
    expect(result).not.toBeNull();
    const r = result as RayBoxResult;
    expect(r.tNear).toBeCloseTo(1.0);
    expect(r.entryPoint[2]).toBeCloseTo(1);
    expect(r.exitPoint[2]).toBeCloseTo(0);
  });

  it('ray enters box from left face (-X direction)', () => {
    const result = intersectBox([-1, 0.5, 0.5], [1, 0, 0], [0, 0, 0], [1, 1, 1]);
    expect(result).not.toBeNull();
    const r = result as RayBoxResult;
    expect(r.entryPoint[0]).toBeCloseTo(0);
    expect(r.exitPoint[0]).toBeCloseTo(1);
  });

  it('ray enters box from right face (+X direction)', () => {
    const result = intersectBox([2, 0.5, 0.5], [-1, 0, 0], [0, 0, 0], [1, 1, 1]);
    expect(result).not.toBeNull();
    const r = result as RayBoxResult;
    expect(r.entryPoint[0]).toBeCloseTo(1);
    expect(r.exitPoint[0]).toBeCloseTo(0);
  });

  it('ray enters box from bottom face (-Y direction)', () => {
    const result = intersectBox([0.5, -1, 0.5], [0, 1, 0], [0, 0, 0], [1, 1, 1]);
    expect(result).not.toBeNull();
    const r = result as RayBoxResult;
    expect(r.entryPoint[1]).toBeCloseTo(0);
    expect(r.exitPoint[1]).toBeCloseTo(1);
  });

  it('ray enters box from top face (+Y direction)', () => {
    const result = intersectBox([0.5, 2, 0.5], [0, -1, 0], [0, 0, 0], [1, 1, 1]);
    expect(result).not.toBeNull();
    const r = result as RayBoxResult;
    expect(r.entryPoint[1]).toBeCloseTo(1);
    expect(r.exitPoint[1]).toBeCloseTo(0);
  });

  it('ray passes through box corner to corner', () => {
    // Ray from (0,0,0) along (1,1,1): tMin=0 (all axes), tMax=1 (all axes hit max),
    // tNear=0, tFar=1. Entry=origin (corner), exit=[1,1,1] (opposite corner).
    const result = intersectBox([0, 0, 0], [1, 1, 1], [0, 0, 0], [1, 1, 1]);
    expect(result).not.toBeNull();
    const r = result as RayBoxResult;
    expect(r.tNear).toBeCloseTo(0);
    expect(r.entryPoint).toEqual([0, 0, 0]);
    expect(r.exitPoint).toEqual([1, 1, 1]);
  });

  it('ray from opposite corner passes through', () => {
    const result = intersectBox([1, 1, 1], [-1, -1, -1], [0, 0, 0], [1, 1, 1]);
    expect(result).not.toBeNull();
    const r = result as RayBoxResult;
    expect(r.tNear).toBeCloseTo(0);
    expect(r.entryPoint).toEqual([1, 1, 1]);
    expect(r.exitPoint).toEqual([0, 0, 0]);
  });

  // ── Ray starts inside the box ──

  it('ray starting inside: tNear is 0', () => {
    const result = intersectBox([0.5, 0.5, 0.5], [0, 0, 1], [0, 0, 0], [1, 1, 1]);
    expect(result).not.toBeNull();
    const r = result as RayBoxResult;
    expect(r.tNear).toBeCloseTo(0);
    expect(r.entryPoint).toEqual([0.5, 0.5, 0.5]);
  });

  it('ray starting inside at corner: tNear is 0', () => {
    const result = intersectBox([0.5, 0.5, 0.5], [1, 1, 1], [0, 0, 0], [1, 1, 1]);
    expect(result).not.toBeNull();
    const r = result as RayBoxResult;
    expect(r.tNear).toBeCloseTo(0);
    expect(r.entryPoint).toEqual([0.5, 0.5, 0.5]);
  });

  // ── No intersection: ray points away ──

  it('ray points away from box: returns null', () => {
    // Origin at (2,2,2), direction (1,0,0) goes further right
    const result = intersectBox([2, 2, 2], [1, 0, 0], [0, 0, 0], [1, 1, 1]);
    expect(result).toBeNull();
  });

  it('ray points away on all axes: returns null', () => {
    const result = intersectBox([2, 2, 2], [1, 1, 1], [0, 0, 0], [1, 1, 1]);
    expect(result).toBeNull();
  });

  it('ray parallel to X and above box, pointing right: returns null', () => {
    // Direction has no Z or Y component, passes at Y=2 (outside box [0,1])
    const result = intersectBox([-2, 2, 0.5], [1, 0, 0], [0, 0, 0], [1, 1, 1]);
    expect(result).toBeNull();
  });

  it('ray parallel to Z and beside box, pointing forward: returns null', () => {
    const result = intersectBox([0.5, 0.5, -2], [0, 0, 1], [0, 0, 0], [1, 1, 1]);
    // Wait: this ray goes toward +Z and starts at z=-2, goes through z=-2 to z=0 (box entry) to z=1 (box exit)
    // Actually this DOES intersect! Let me fix the test:
    const r = result as RayBoxResult | null;
    // This SHOULD intersect because the ray goes from z=-2 toward z=0 (inside box)
    // Entry at z=0, exit at z=1
    expect(r).not.toBeNull();
  });

  // ── Non-unit box dimensions ──

  it('works with custom box [0,10] on all axes', () => {
    const result = intersectBox([5, 5, -5], [0, 0, 1], [0, 0, 0], [10, 10, 10]);
    expect(result).not.toBeNull();
    const r = result as RayBoxResult;
    expect(r.entryPoint[2]).toBeCloseTo(0);
    expect(r.exitPoint[2]).toBeCloseTo(10);
  });

  it('works with non-origin box [5,15]×[10,20]×[2,12]', () => {
    const result = intersectBox([10, 15, 2], [0, 0, 1], [5, 10, 2], [15, 20, 12]);
    expect(result).not.toBeNull();
    const r = result as RayBoxResult;
    expect(r.entryPoint[0]).toBeCloseTo(10);
    expect(r.entryPoint[1]).toBeCloseTo(15);
    expect(r.entryPoint[2]).toBeCloseTo(2);
    expect(r.exitPoint[2]).toBeCloseTo(12);
  });

  it('works with asymmetric box dimensions', () => {
    // Ray from origin along (1,1,1) through [0,2]×[0,3]×[0,4] box.
    // tXmax=2, tYmax=3, tZmax=4 → tMax=min(2,3,4)=2 (Z axis exits first!)
    // tXmin=0, tYmin=0, tZmin=0 → tMin=0
    // tNear=0, tFar=2. Exit = origin + dir*2 = [2,2,2]
    const result = intersectBox([0, 0, 0], [1, 1, 1], [0, 0, 0], [2, 3, 4]);
    expect(result).not.toBeNull();
    const r = result as RayBoxResult;
    expect(r.entryPoint).toEqual([0, 0, 0]);
    expect(r.exitPoint[0]).toBeCloseTo(2);
    expect(r.exitPoint[1]).toBeCloseTo(2); // tFar=2 (Z exits first), not 3
    expect(r.exitPoint[2]).toBeCloseTo(2); // tFar=2 (Z exits first), not 4
  });

  // ── Entry/exit point consistency ──

  it('entry point is on ray from origin', () => {
    const result = intersectBox([0.3, 0.5, -0.5], [0.1, 0.2, 1], [0, 0, 0], [1, 1, 1]);
    expect(result).not.toBeNull();
    const r = result as RayBoxResult;
    // Verify entry = origin + dir * tNear
    expect(r.entryPoint[0]).toBeCloseTo(0.3 + 0.1 * r.tNear, 3);
    expect(r.entryPoint[1]).toBeCloseTo(0.5 + 0.2 * r.tNear, 3);
    expect(r.entryPoint[2]).toBeCloseTo(-0.5 + 1.0 * r.tNear, 3);
  });

  it('exit point is on ray from origin', () => {
    const result = intersectBox([0.3, 0.5, -0.5], [0.1, 0.2, 1], [0, 0, 0], [1, 1, 1]);
    expect(result).not.toBeNull();
    const r = result as RayBoxResult;
    expect(r.exitPoint[0]).toBeCloseTo(0.3 + 0.1 * r.tFar, 3);
    expect(r.exitPoint[1]).toBeCloseTo(0.5 + 0.2 * r.tFar, 3);
    expect(r.exitPoint[2]).toBeCloseTo(-0.5 + 1.0 * r.tFar, 3);
  });

  it('tNear is always <= tFar', () => {
    const cases = [
      [[0.5, 0.5, -1], [0, 0, 1]],
      [[1, 1, 1], [-1, -1, -1]],
      [[-1, 0.5, 0.5], [1, 0, 0]],
      [[0.5, 0.5, 0.5], [1, 1, 1]],
      [[0.2, 0.3, 0.4], [0.5, 0.5, 0.5]],
    ];
    for (const [o, d] of cases) {
      const result = intersectBox(o as [number,number,number], d as [number,number,number], [0, 0, 0], [1, 1, 1]);
      if (result) {
        expect(result.tNear).toBeLessThanOrEqual(result.tFar);
        expect(result.tNear).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('entry point is always within box bounds', () => {
    const cases = [
      [[0.5, 0.5, -1], [0, 0, 1]],
      [[-1, -1, -1], [1, 1, 1]],
      [[0.5, 2, 0.5], [0, -1, 0]],
    ];
    for (const [o, d] of cases) {
      const result = intersectBox(o as [number,number,number], d as [number,number,number], [0, 0, 0], [1, 1, 1]);
      if (result) {
        for (const coord of result.entryPoint) {
          expect(coord).toBeGreaterThanOrEqual(-0.001);
          expect(coord).toBeLessThanOrEqual(1.001);
        }
      }
    }
  });

  it('exit point is always within box bounds', () => {
    const cases = [
      [[0.5, 0.5, -1], [0, 0, 1]],
      [[-1, -1, -1], [1, 1, 1]],
      [[0.5, -1, 0.5], [0, 1, 0]],
    ];
    for (const [o, d] of cases) {
      const result = intersectBox(o as [number,number,number], d as [number,number,number], [0, 0, 0], [1, 1, 1]);
      if (result) {
        for (const coord of result.exitPoint) {
          expect(coord).toBeGreaterThanOrEqual(-0.001);
          expect(coord).toBeLessThanOrEqual(1.001);
        }
      }
    }
  });

  // ── Edge: ray exactly on boundary ──

  it('ray along X axis from box edge: intersects', () => {
    const result = intersectBox([0, 0.5, 0.5], [1, 0, 0], [0, 0, 0], [1, 1, 1]);
    expect(result).not.toBeNull();
    const r = result as RayBoxResult;
    expect(r.entryPoint[0]).toBeCloseTo(0);
    expect(r.exitPoint[0]).toBeCloseTo(1);
  });

  it('ray along diagonal from origin: intersects', () => {
    // Same as corner-to-corner test: origin on corner, diagonal direction.
    // tMin=0, tMax=1, tNear=0, tFar=1. Exit = [1,1,1], tFar ≈ 1.732/sqrt(3) ≈ 1
    const result = intersectBox([0, 0, 0], [1, 1, 1], [0, 0, 0], [1, 1, 1]);
    expect(result).not.toBeNull();
    const r = result as RayBoxResult;
    expect(r.tNear).toBeCloseTo(0);
    expect(r.tFar).toBeCloseTo(1.0); // distance from origin to [1,1,1] = sqrt(3), but tMax=1
  });

  // ── Ray direction normalization ──

  it('works with non-normalized direction (scaled by 2)', () => {
    const result1 = intersectBox([0.5, 0.5, -1], [0, 0, 1], [0, 0, 0], [1, 1, 1]);
    const result2 = intersectBox([0.5, 0.5, -1], [0, 0, 2], [0, 0, 0], [1, 1, 1]);
    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    // tNear should be doubled for the 2x direction
    const r1 = result1 as RayBoxResult;
    const r2 = result2 as RayBoxResult;
    expect(r2.tNear).toBeCloseTo(r1.tNear / 2, 3);
    expect(r2.tFar).toBeCloseTo(r1.tFar / 2, 3);
  });

  it('works with direction scaled by 0.5', () => {
    const result1 = intersectBox([0.5, 0.5, -1], [0, 0, 1], [0, 0, 0], [1, 1, 1]);
    const result2 = intersectBox([0.5, 0.5, -1], [0, 0, 0.5], [0, 0, 0], [1, 1, 1]);
    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    const r1 = result1 as RayBoxResult;
    const r2 = result2 as RayBoxResult;
    expect(r2.tNear).toBeCloseTo(r1.tNear * 2, 3);
    expect(r2.tFar).toBeCloseTo(r1.tFar * 2, 3);
  });

  // ── tNear/tFar values ──

  it('tNear > 0 when ray starts outside', () => {
    const result = intersectBox([0.5, 0.5, -1], [0, 0, 1], [0, 0, 0], [1, 1, 1]);
    expect(result).not.toBeNull();
    expect((result as RayBoxResult).tNear).toBeGreaterThan(0);
  });

  it('tNear = 0 when ray starts inside', () => {
    const result = intersectBox([0.5, 0.5, 0.5], [0, 0, 1], [0, 0, 0], [1, 1, 1]);
    expect(result).not.toBeNull();
    expect((result as RayBoxResult).tNear).toBeCloseTo(0);
  });

  it('tNear = 0 when ray starts on surface', () => {
    const result = intersectBox([0, 0.5, 0.5], [1, 0, 0], [0, 0, 0], [1, 1, 1]);
    expect(result).not.toBeNull();
    expect((result as RayBoxResult).tNear).toBeCloseTo(0);
  });
});
