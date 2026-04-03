// Unit tests for VolumeCamera - pure math

import { describe, it, expect } from 'vitest';
import { VolumeCamera } from '@jsmedgl/renderer-3d';
import { DEFAULT_CAMERA_STATE } from '@jsmedgl/renderer-3d';
import { mat4, vec3 } from 'gl-matrix';
describe('VolumeCamera', () => {

  it('initializes with default state', () => {
    const cam = new VolumeCamera();
    const s = cam.getState();
    expect(s.theta).toBeCloseTo(DEFAULT_CAMERA_STATE.theta);
    expect(s.phi).toBeCloseTo(DEFAULT_CAMERA_STATE.phi);
    expect(s.distance).toBeCloseTo(DEFAULT_CAMERA_STATE.distance);
    expect(s.target).toEqual([0.5, 0.5, 0.5]);
  });

  it('accepts partial state override', () => {
    const cam = new VolumeCamera({ theta: 1.0, distance: 5.0 });
    const s = cam.getState();
    expect(s.theta).toBe(1.0);
    expect(s.distance).toBe(5.0);
  });

  it('updates theta on orbit', () => {
    const cam = new VolumeCamera({ theta: 0.5 });
    cam.orbit(0.1, 0);
    expect(cam.getState().theta).toBeCloseTo(0.6);
  });

  it('clamps phi minimum to 0.01', () => {
    const cam = new VolumeCamera({ phi: 0.02 });
    cam.orbit(0, -0.5);
    expect(cam.getState().phi).toBeGreaterThanOrEqual(0.01);
  });

  it('clamps phi maximum to PI-0.01', () => {
    const cam = new VolumeCamera({ phi: Math.PI - 0.02 });
    cam.orbit(0, 0.5);
    expect(cam.getState().phi).toBeLessThanOrEqual(Math.PI - 0.01);
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
    const cam = new VolumeCamera({ theta: 2.0, phi: 0.1, distance: 8.0 });
    cam.reset();
    const s = cam.getState();
    expect(s.theta).toBeCloseTo(DEFAULT_CAMERA_STATE.theta);
    expect(s.phi).toBeCloseTo(DEFAULT_CAMERA_STATE.phi);
    expect(s.distance).toBeCloseTo(DEFAULT_CAMERA_STATE.distance);
  });

  it('returns independent state copies', () => {
    const cam = new VolumeCamera();
    const s1 = cam.getState();
    const s2 = cam.getState();
    s1.theta = 99;
    expect(cam.getState().theta).toBeCloseTo(DEFAULT_CAMERA_STATE.theta);
  });

  it('position at phi=PI/2 is directly above target', () => {
    const cam = new VolumeCamera({ theta: 0, phi: Math.PI / 2, distance: 2.5, target: [0.5, 0.5, 0.5] });
    const pos = cam.getPosition();
    expect(pos[0]).toBeCloseTo(3.0);
    expect(pos[1]).toBeCloseTo(0.5);
    expect(pos[2]).toBeCloseTo(0.5);
  });

  it('position changes with phi', () => {
    const cam = new VolumeCamera({ phi: 0.1 });
    const pos1 = cam.getPosition();
    cam.orbit(0, 0.5);
    expect(pos1[1]).not.toBeCloseTo(cam.getPosition()[1]);
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
    const cam = new VolumeCamera({ theta: 0, phi: Math.PI / 4 });
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
    const cam = new VolumeCamera({ theta: 0.3, phi: 0.7 });
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
    const cam = new VolumeCamera({ theta: 0.5, phi: 0.7 });
    const rot = cam.getRotationMatrix();
    const det = rot[0]*(rot[5]*rot[10]-rot[6]*rot[9]) - rot[1]*(rot[4]*rot[10]-rot[6]*rot[8]) + rot[2]*(rot[4]*rot[9]-rot[5]*rot[8]);
    expect(Math.abs(det - 1.0)).toBeLessThan(0.01);
  });

  it('rotation matrix columns are orthogonal', () => {
    const cam = new VolumeCamera({ theta: 0.3, phi: 0.6 });
    const rot = cam.getRotationMatrix();
    const dot01 = rot[0]*rot[4] + rot[1]*rot[5] + rot[2]*rot[6];
    const dot02 = rot[0]*rot[8] + rot[1]*rot[9] + rot[2]*rot[10];
    const dot12 = rot[4]*rot[8] + rot[5]*rot[9] + rot[6]*rot[10];
    expect(Math.abs(dot01)).toBeLessThan(0.01);
    expect(Math.abs(dot02)).toBeLessThan(0.01);
    expect(Math.abs(dot12)).toBeLessThan(0.01);
  });

  it('rotation changes after orbit', () => {
    const cam = new VolumeCamera({ theta: 0 });
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
    const cam = new VolumeCamera({ theta: 0, phi: Math.PI / 4 });
    cam.orbit(0.1, 0.05);
    cam.orbit(0.2, -0.03);
    expect(cam.getState().theta).toBeCloseTo(0.3);
    expect(cam.getState().phi).toBeCloseTo(Math.PI / 4 + 0.02);
  });

  it('zoom and orbit both persist', () => {
    const cam = new VolumeCamera({ distance: 3.0, theta: 0 });
    cam.zoom(1.0);
    cam.orbit(0.5, 0);
    expect(cam.getState().distance).toBeCloseTo(4.0);
    expect(cam.getState().theta).toBeCloseTo(0.5);
  });
});
