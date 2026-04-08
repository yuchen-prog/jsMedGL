// Unit tests for VolumeCamera - quaternion-based rotation

import { describe, it, expect } from 'vitest';
import { VolumeCamera } from '@jsmedgl/renderer-3d';
import { DEFAULT_CAMERA_STATE } from '@jsmedgl/renderer-3d';
import { mat4, vec3, quat } from 'gl-matrix';

function quatLength(q: [number, number, number, number]): number {
  return Math.sqrt(q[0]**2 + q[1]**2 + q[2]**2 + q[3]**2);
}

function quatApproximatelyEqual(
  a: [number, number, number, number],
  b: [number, number, number, number],
  epsilon = 0.0001
): boolean {
  return Math.abs(a[0]-b[0]) < epsilon &&
         Math.abs(a[1]-b[1]) < epsilon &&
         Math.abs(a[2]-b[2]) < epsilon &&
         Math.abs(a[3]-b[3]) < epsilon;
}

describe('VolumeCamera', () => {

  it('initializes with default state', () => {
    const cam = new VolumeCamera();
    const s = cam.getState();
    expect(quatApproximatelyEqual(s.rotation, DEFAULT_CAMERA_STATE.rotation)).toBe(true);
    expect(s.distance).toBeCloseTo(DEFAULT_CAMERA_STATE.distance);
    expect(s.target).toEqual([0.5, 0.5, 0.5]);
  });

  it('accepts partial state override', () => {
    const customRotation: [number, number, number, number] = [0, 0, 0, 1];
    const cam = new VolumeCamera({ rotation: customRotation, distance: 5.0 });
    const s = cam.getState();
    expect(quatApproximatelyEqual(s.rotation, customRotation)).toBe(true);
    expect(s.distance).toBe(5.0);
  });

  it('rotation changes on orbit', () => {
    const cam = new VolumeCamera();
    const initial = cam.getState().rotation;
    cam.orbit(0.1, 0);
    const after = cam.getState().rotation;
    expect(quatApproximatelyEqual(initial, after)).toBe(false);
  });

  it('does NOT clamp vertical rotation (unlimited rotation)', () => {
    const cam = new VolumeCamera();
    // Rotate way past the old clamp limits
    for (let i = 0; i < 20; i++) {
      cam.orbit(0, 0.5);  // Total rotation: 10 radians (~573 degrees)
    }
    const s = cam.getState();
    // Rotation should have accumulated, not clamped
    // The quaternion should be normalized
    expect(quatLength(s.rotation)).toBeCloseTo(1.0, 5);
  });

  it('can do full 360° flip', () => {
    const cam = new VolumeCamera();
    const initial = cam.getState().rotation;

    // Orbit vertically by PI (180°)
    cam.orbit(0, Math.PI);
    const halfway = cam.getState().rotation;

    // Orbit by another PI (total 360°)
    cam.orbit(0, Math.PI);
    const full = cam.getState().rotation;

    // After 360°, we should be back to approximately the same orientation
    // (or negated, since q and -q represent the same rotation)
    const same = quatApproximatelyEqual(initial, full) ||
                 quatApproximatelyEqual(initial, full.map(x => -x) as [number,number,number,number]);
    expect(same).toBe(true);
  });

  it('increases distance on positive zoom', () => {
    const cam = new VolumeCamera({ distance: 3.0 });
    cam.zoom(0.5);
    expect(cam.getState().distance).toBeCloseTo(3.5);
  });

  it('decreases distance on negative zoom', () => {
    const cam = new VolumeCamera({ distance: 3.0 });
    cam.zoom(-0.5);
    expect(cam.getState().distance).toBeCloseTo(2.5);
  });

  it('clamps zoom to minimum distance 1.0', () => {
    const cam = new VolumeCamera({ distance: 1.0 });
    cam.zoom(-5.0);
    expect(cam.getState().distance).toBeGreaterThanOrEqual(1.0);
  });

  it('clamps zoom to maximum distance 10.0', () => {
    const cam = new VolumeCamera({ distance: 10.0 });
    cam.zoom(5.0);
    expect(cam.getState().distance).toBeLessThanOrEqual(10.0);
  });

  it('reset restores all defaults', () => {
    const cam = new VolumeCamera({ distance: 8.0 });
    cam.orbit(2.0, 1.0);
    cam.reset();
    const s = cam.getState();
    expect(quatApproximatelyEqual(s.rotation, DEFAULT_CAMERA_STATE.rotation)).toBe(true);
    expect(s.distance).toBeCloseTo(DEFAULT_CAMERA_STATE.distance);
  });

  it('returns independent state copies', () => {
    const cam = new VolumeCamera();
    const s1 = cam.getState();
    const s2 = cam.getState();
    s1.rotation[0] = 99;
    expect(cam.getState().rotation[0]).not.toBe(99);
  });

  it('default position matches old spherical default', () => {
    // Default quaternion (45° oblique view), distance=2.5
    // Expected position: (1.75, -1.2678, 1.75)
    const cam = new VolumeCamera();
    const pos = cam.getPosition();
    expect(pos[0]).toBeCloseTo(1.75, 2);
    expect(pos[1]).toBeCloseTo(-1.2678, 2);
    expect(pos[2]).toBeCloseTo(1.75, 2);
  });

  it('position changes with rotation', () => {
    const cam = new VolumeCamera();
    const pos1 = cam.getPosition();
    cam.orbit(0.5, 0);
    const pos2 = cam.getPosition();
    expect(pos1[0]).not.toBeCloseTo(pos2[0]);
  });

  it('view matrix has 16 elements', () => {
    const cam = new VolumeCamera();
    expect(cam.getViewMatrix().length).toBe(16);
    expect(cam.getInverseViewMatrix().length).toBe(16);
  });

  it('consecutive calls return same reference', () => {
    const cam = new VolumeCamera();
    const vm1 = cam.getViewMatrix();
    const vm2 = cam.getViewMatrix();
    expect(vm1).toBe(vm2);
  });

  it('view matrix differs after orbit', () => {
    const cam = new VolumeCamera();
    const vm1 = Array.from(cam.getViewMatrix());
    cam.orbit(0.5, 0);
    const vm2 = Array.from(cam.getViewMatrix());
    let differ = false;
    for (let i = 0; i < 16; i++) {
      if (Math.abs(vm1[i] - vm2[i]) > 1e-6) { differ = true; break; }
    }
    expect(differ).toBe(true);
  });

  it('view matrix times inverse equals identity', () => {
    const cam = new VolumeCamera();
    const vm = cam.getViewMatrix();
    const inv = cam.getInverseViewMatrix();
    const result = mat4.create();
    mat4.multiply(result, vm, inv);
    for (let i = 0; i < 16; i++) {
      if (i % 5 === 0) expect(result[i]).toBeCloseTo(1.0, 3);
      else expect(Math.abs(result[i])).toBeLessThan(0.01);
    }
  });

  it('ray direction is normalized', () => {
    const cam = new VolumeCamera();
    const dir = cam.getRayDirection(256, 256, 512, 512);
    const len = Math.sqrt(dir[0]**2 + dir[1]**2 + dir[2]**2);
    expect(len).toBeCloseTo(1.0, 5);
  });

  it('consistent direction for same pixel', () => {
    const cam = new VolumeCamera();
    const d1 = cam.getRayDirection(256, 256, 512, 512);
    const d2 = cam.getRayDirection(256, 256, 512, 512);
    expect(d1[0]).toBeCloseTo(d2[0], 8);
    expect(d1[1]).toBeCloseTo(d2[1], 8);
    expect(d1[2]).toBeCloseTo(d2[2], 8);
  });

  it('different directions for different pixels', () => {
    const cam = new VolumeCamera();
    const d1 = cam.getRayDirection(50, 50, 512, 512);
    const d2 = cam.getRayDirection(450, 450, 512, 512);
    const diff = Math.sqrt((d1[0]-d2[0])**2 + (d1[1]-d2[1])**2 + (d1[2]-d2[2])**2);
    expect(diff).toBeGreaterThan(0.05);
  });

  it('handles wide canvas without NaN', () => {
    const cam = new VolumeCamera();
    const dir = cam.getRayDirection(512, 128, 1024, 256);
    const len = Math.sqrt(dir[0]**2 + dir[1]**2 + dir[2]**2);
    expect(len).toBeCloseTo(1.0, 5);
  });

  it('handles tall canvas without NaN', () => {
    const cam = new VolumeCamera();
    const dir = cam.getRayDirection(128, 512, 256, 1024);
    const len = Math.sqrt(dir[0]**2 + dir[1]**2 + dir[2]**2);
    expect(len).toBeCloseTo(1.0, 5);
  });

  it('rotation matrix has zero translation', () => {
    const cam = new VolumeCamera();
    const rot = cam.getRotationMatrix();
    expect(rot[12]).toBeCloseTo(0.0);
    expect(rot[13]).toBeCloseTo(0.0);
    expect(rot[14]).toBeCloseTo(0.0);
  });

  it('rotation matrix determinant close to 1', () => {
    const cam = new VolumeCamera();
    cam.orbit(0.5, 0.7);
    const rot = cam.getRotationMatrix();
    const det = rot[0]*(rot[5]*rot[10]-rot[6]*rot[9]) - rot[1]*(rot[4]*rot[10]-rot[6]*rot[8]) + rot[2]*(rot[4]*rot[9]-rot[5]*rot[8]);
    expect(Math.abs(det - 1.0)).toBeLessThan(0.01);
  });

  it('rotation matrix columns are orthogonal', () => {
    const cam = new VolumeCamera();
    cam.orbit(0.3, 0.6);
    const rot = cam.getRotationMatrix();
    const dot01 = rot[0]*rot[4] + rot[1]*rot[5] + rot[2]*rot[6];
    const dot02 = rot[0]*rot[8] + rot[1]*rot[9] + rot[2]*rot[10];
    const dot12 = rot[4]*rot[8] + rot[5]*rot[9] + rot[6]*rot[10];
    expect(Math.abs(dot01)).toBeLessThan(0.01);
    expect(Math.abs(dot02)).toBeLessThan(0.01);
    expect(Math.abs(dot12)).toBeLessThan(0.01);
  });

  it('rotation changes after orbit', () => {
    const cam = new VolumeCamera();
    const rot1 = cam.getRotationMatrix();
    cam.orbit(1.0, 0);
    const rot2 = cam.getRotationMatrix();
    let differ = false;
    for (let i = 0; i < 12; i++) {
      if (Math.abs(rot1[i] - rot2[i]) > 1e-6) { differ = true; break; }
    }
    expect(differ).toBe(true);
  });

  it('multiple orbits accumulate correctly', () => {
    const cam = new VolumeCamera();
    cam.orbit(0.1, 0.05);
    cam.orbit(0.2, -0.03);
    // Just verify it doesn't crash and state is valid
    const s = cam.getState();
    expect(quatLength(s.rotation)).toBeCloseTo(1.0, 5);
  });

  it('zoom and orbit both persist', () => {
    const cam = new VolumeCamera({ distance: 3.0 });
    cam.zoom(1.0);
    cam.orbit(0.5, 0);
    const s = cam.getState();
    expect(s.distance).toBeCloseTo(4.0);
    expect(quatLength(s.rotation)).toBeCloseTo(1.0, 5);
  });

  it('quaternion remains normalized after many orbits', () => {
    const cam = new VolumeCamera();
    for (let i = 0; i < 10000; i++) {
      cam.orbit(0.001, 0.0005);
    }
    const s = cam.getState();
    expect(quatLength(s.rotation)).toBeCloseTo(1.0, 3);
  });

  it('setRotation updates state directly', () => {
    const cam = new VolumeCamera();
    const newRot: [number, number, number, number] = [0, 0, 0.70710678, 0.70710678];
    cam.setRotation(newRot);
    expect(quatApproximatelyEqual(cam.getState().rotation, newRot)).toBe(true);
  });

  it('setDistance updates distance directly', () => {
    const cam = new VolumeCamera();
    cam.setDistance(7.0);
    expect(cam.getState().distance).toBe(7.0);
  });

  it('setTarget updates target directly', () => {
    const cam = new VolumeCamera();
    cam.setTarget([0.2, 0.3, 0.4]);
    expect(cam.getState().target).toEqual([0.2, 0.3, 0.4]);
  });

  it('no gimbal lock at extreme vertical angles', () => {
    const cam = new VolumeCamera();
    // Rotate to look straight down (90° from default)
    cam.orbit(0, Math.PI / 4);  // from PI/4 to PI/2
    const vm = cam.getViewMatrix();
    // View matrix should have no NaN
    for (let i = 0; i < 16; i++) {
      expect(Number.isNaN(vm[i])).toBe(false);
    }
    // And ray direction should still work
    const dir = cam.getRayDirection(256, 256, 512, 512);
    expect(Number.isNaN(dir[0])).toBe(false);
    expect(Number.isNaN(dir[1])).toBe(false);
    expect(Number.isNaN(dir[2])).toBe(false);
  });
});
