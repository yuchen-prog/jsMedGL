// VolumeCamera - Orbit camera for volume rendering

import { mat4, vec3 } from "gl-matrix";
import type { VolumeCameraState } from './types';
import { DEFAULT_CAMERA_STATE } from './types';

/**
 * Orbit camera that rotates around a target point in texture space [0,1]³.
 *
 * Spherical coordinates:
 *   position = target + distance * (sin(phi)*cos(theta), cos(phi), sin(phi)*sin(theta))
 */
export class VolumeCamera {
  private theta: number;
  private phi: number;
  private distance: number;
  private target: [number, number, number];

  private viewMatrix: mat4;
  private inverseViewMatrix: mat4;
  private dirty = true;

  constructor(state?: Partial<VolumeCameraState>) {
    const s = { ...DEFAULT_CAMERA_STATE, ...state };
    this.theta = s.theta;
    this.phi = s.phi;
    this.distance = s.distance;
    this.target = [...s.target] as [number, number, number];
    this.viewMatrix = mat4.create();
    this.inverseViewMatrix = mat4.create();
  }

  getState(): VolumeCameraState {
    return {
      theta: this.theta,
      phi: this.phi,
      distance: this.distance,
      target: [...this.target] as [number, number, number],
    };
  }

  orbit(deltaTheta: number, deltaPhi: number): void {
    this.theta += deltaTheta;
    // Clamp phi to avoid gimbal lock (avoid exactly 0 or PI)
    this.phi = Math.max(0.01, Math.min(Math.PI - 0.01, this.phi + deltaPhi));
    this.dirty = true;
  }

  zoom(delta: number): void {
    this.distance = Math.max(1.0, Math.min(10.0, this.distance + delta));
    this.dirty = true;
  }

  pan(deltaX: number, deltaY: number): void {
    // Pan in the camera's local X/Y plane
    this.updateMatrices();
    const right = vec3.fromValues(
      this.inverseViewMatrix[0], this.inverseViewMatrix[4], this.inverseViewMatrix[8]
    );
    const up = vec3.fromValues(
      this.inverseViewMatrix[1], this.inverseViewMatrix[5], this.inverseViewMatrix[9]
    );

    const scale = this.distance * 0.001;
    this.target[0] += right[0] * deltaX * scale + up[0] * deltaY * scale;
    this.target[1] += right[1] * deltaX * scale + up[1] * deltaY * scale;
    this.target[2] += right[2] * deltaX * scale + up[2] * deltaY * scale;
    this.dirty = true;
  }

  reset(): void {
    this.theta = DEFAULT_CAMERA_STATE.theta;
    this.phi = DEFAULT_CAMERA_STATE.phi;
    this.distance = DEFAULT_CAMERA_STATE.distance;
    this.target = [...DEFAULT_CAMERA_STATE.target] as [number, number, number];
    this.dirty = true;
  }

  /**
   * Get camera position in texture space
   */
  getPosition(): [number, number, number] {
    return [
      this.target[0] + this.distance * Math.sin(this.phi) * Math.cos(this.theta),
      this.target[1] + this.distance * Math.cos(this.phi),
      this.target[2] + this.distance * Math.sin(this.phi) * Math.sin(this.theta),
    ];
  }

  /**
   * Get the view matrix (camera → world)
   */
  getViewMatrix(): mat4 {
    this.updateMatrices();
    return this.viewMatrix;
  }

  /**
   * Get the inverse view matrix (world → camera)
   */
  getInverseViewMatrix(): mat4 {
    this.updateMatrices();
    return this.inverseViewMatrix;
  }

  /**
   * Compute ray direction from a pixel coordinate into texture space.
   * Returns a normalized direction vector.
   */
  getRayDirection(pixelX: number, pixelY: number, width: number, height: number): [number, number, number] {
    this.updateMatrices();

    // NDC coordinates
    const ndcX = (2.0 * pixelX) / width - 1.0;
    const ndcY = 1.0 - (2.0 * pixelY) / height;

    // Ray in camera space: through the near plane
    // Using a simple perspective-like mapping for the unit cube
    // The ray starts at the camera position and goes through this pixel
    const cameraPos = this.getPosition();

    // Compute a ray direction in world space using the camera's right/up/forward basis
    const forward = vec3.create();
    vec3.subtract(forward, vec3.fromValues(...this.target), vec3.fromValues(...cameraPos));
    vec3.normalize(forward, forward);

    const worldUp = vec3.fromValues(0, 1, 0);
    const right = vec3.create();
    vec3.cross(right, forward, worldUp);
    if (vec3.length(right) < 1e-6) {
      // Camera looking straight up/down — use alternative up
      vec3.cross(right, forward, vec3.fromValues(0, 0, 1));
    }
    vec3.normalize(right, right);

    const up = vec3.create();
    vec3.cross(up, right, forward);
    vec3.normalize(up, up);

    // Aspect ratio adjustment
    const aspect = width / height;
    const fovScale = Math.tan((Math.PI / 4) / 2); // 45° half-FOV

    const rayDir = vec3.create();
    vec3.copy(rayDir, forward);
    vec3.scaleAndAdd(rayDir, rayDir, right, ndcX * aspect * fovScale);
    vec3.scaleAndAdd(rayDir, rayDir, up, ndcY * fovScale);
    vec3.normalize(rayDir, rayDir);

    return [rayDir[0], rayDir[1], rayDir[2]];
  }

  /**
   * Get rotation-only matrix (for orientation cube)
   */
  getRotationMatrix(): mat4 {
    this.updateMatrices();
    const rot = mat4.clone(this.viewMatrix);
    // Remove translation
    rot[12] = 0;
    rot[13] = 0;
    rot[14] = 0;
    return rot;
  }

  private updateMatrices(): void {
    if (!this.dirty) return;

    const pos = this.getPosition();
    const eye = vec3.fromValues(...pos);
    const center = vec3.fromValues(...this.target);
    const up = vec3.fromValues(0, 1, 0);

    mat4.lookAt(this.viewMatrix, eye, center, up);
    mat4.invert(this.inverseViewMatrix, this.viewMatrix);

    this.dirty = false;
  }
}
