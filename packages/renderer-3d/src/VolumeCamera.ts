// VolumeCamera - Orbit camera for volume rendering (quaternion-based)

import { mat4, vec3, quat } from "gl-matrix";
import type { VolumeCameraState } from './types';
import { DEFAULT_CAMERA_STATE } from './types';

/**
 * Orbit camera that rotates around a target point in texture space [0,1]^3.
 *
 * Uses quaternion rotation for unlimited 360° rotation without gimbal lock.
 * The camera orbits at a fixed distance from the target, with orientation
 * stored as a quaternion.
 */
export class VolumeCamera {
  private rotation: quat;  // Quaternion [x, y, z, w] ()
  private distance: number;
  private target: [number, number, number];

  private viewMatrix: mat4;
  private inverseViewMatrix: mat4;
  private dirty = true;

  constructor(state?: Partial<VolumeCameraState>) {
    const s = { ...DEFAULT_CAMERA_STATE, ...state };
    this.rotation = quat.fromValues(
      s.rotation[0], s.rotation[1], s.rotation[2], s.rotation[3]
    );
    this.distance = s.distance;
    this.target = [...s.target] as [number, number, number];
    this.viewMatrix = mat4.create();
    this.inverseViewMatrix = mat4.create();
  }

  getState(): VolumeCameraState {
    return {
      rotation: [this.rotation[0], this.rotation[1], this.rotation[2], this.rotation[3]],
      distance: this.distance,
      target: [...this.target] as [number, number, number],
    };
  }

  /**
   * Orbit around the target.
   * @param deltaTheta - Horizontal rotation (radians), applied around camera-local up
   * @param deltaPhi - Vertical rotation (radians), applied around camera-local right
   */
  orbit(deltaTheta: number, deltaPhi: number): void {
    if (Math.abs(deltaTheta) > 1e-8) {
      // Rotate around camera-local up axis
      const cameraUp = this.getCameraUp();
      const yawQuat = quat.create();
      quat.setAxisAngle(yawQuat, cameraUp, deltaTheta);
      quat.multiply(this.rotation, yawQuat, this.rotation);
    }

    if (Math.abs(deltaPhi) > 1e-8) {
      // Rotate around camera-local right axis
      const cameraRight = this.getCameraRight();
      const pitchQuat = quat.create();
      quat.setAxisAngle(pitchQuat, cameraRight, deltaPhi);
      quat.multiply(this.rotation, pitchQuat, this.rotation);
    }

    // Normalize to prevent drift
    quat.normalize(this.rotation, this.rotation);
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
      this.inverseViewMatrix[0], this.inverseViewMatrix[1], this.inverseViewMatrix[2]
    );
    const up = vec3.fromValues(
      this.inverseViewMatrix[4], this.inverseViewMatrix[5], this.inverseViewMatrix[6]
    );

    const scale = this.distance * 0.001;
    this.target[0] += right[0] * deltaX * scale + up[0] * deltaY * scale;
    this.target[1] += right[1] * deltaX * scale + up[1] * deltaY * scale;
    this.target[2] += right[2] * deltaX * scale + up[2] * deltaY * scale;
    this.dirty = true;
  }

  reset(): void {
    quat.copy(this.rotation, quat.fromValues(
      DEFAULT_CAMERA_STATE.rotation[0],
      DEFAULT_CAMERA_STATE.rotation[1],
      DEFAULT_CAMERA_STATE.rotation[2],
      DEFAULT_CAMERA_STATE.rotation[3]
    ));
    this.distance = DEFAULT_CAMERA_STATE.distance;
    this.target = [...DEFAULT_CAMERA_STATE.target] as [number, number, number];
    this.dirty = true;
  }

  setRotation(q: [number, number, number, number]): void {
    quat.copy(this.rotation, quat.fromValues(q[0], q[1], q[2], q[3]));
    quat.normalize(this.rotation, this.rotation);
    this.dirty = true;
  }

  setTarget(t: [number, number, number]): void {
    this.target = [...t] as [number, number, number];
    this.dirty = true;
  }

  setDistance(d: number): void {
    this.distance = Math.max(1.0, Math.min(10.0, d));
    this.dirty = true;
  }

  /**
   * Get camera position in texture space
   */
  getPosition(): [number, number, number] {
    // Direction from target to camera = +Z in camera local, rotated to world
    const dir = vec3.fromValues(0, 0, 1);
    vec3.transformQuat(dir, dir, this.rotation);

    return [
      this.target[0] + this.distance * dir[0],
      this.target[1] + this.distance * dir[1],
      this.target[2] + this.distance * dir[2],
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
    // NDC coordinates
    const ndcX = (2.0 * pixelX) / width - 1.0;
    const ndcY = 1.0 - (2.0 * pixelY) / height;

    // Get camera basis vectors from quaternion
    const forward = this.getCameraForward();
    const right = this.getCameraRight();
    const up = this.getCameraUp();

    // Aspect ratio adjustment
    const aspect = width / height;
    const fovScale = Math.tan((Math.PI / 4) / 2); // 45° half-FOV

    const rayDir = vec3.clone(forward);
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

  // ============================================================================
  // Private methods
  // ============================================================================

  private getCameraForward(): vec3 {
    // Forward = direction camera looks = -Z in camera local, rotated to world
    const fwd = vec3.fromValues(0, 0, -1);
    vec3.transformQuat(fwd, fwd, this.rotation);
    return fwd;
  }

  private getCameraRight(): vec3 {
    const right = vec3.fromValues(1, 0, 0);
    vec3.transformQuat(right, right, this.rotation);
    return right;
  }

  private getCameraUp(): vec3 {
    const up = vec3.fromValues(0, 1, 0);
    vec3.transformQuat(up, up, this.rotation);
    return up;
  }

  private updateMatrices(): void {
    if (!this.dirty) return;

    const pos = this.getPosition();
    const eye = vec3.fromValues(...pos);
    const center = vec3.fromValues(...this.target);

    // Derive up from quaternion - this is always orthogonal to forward
    // so lookAt will never encounter gimbal lock
    const up = this.getCameraUp();

    mat4.lookAt(this.viewMatrix, eye, center, up);
    mat4.invert(this.inverseViewMatrix, this.viewMatrix);

    this.dirty = false;
  }
}
