// ObliquePlane - 斜切平面数学运算

import { vec3, quat } from 'gl-matrix';
import type { NiftiVolume } from '@jsmedgl/parser-nifti';
import { extractAffineMatrix, invertMatrix } from '@jsmedgl/parser-nifti/coordinate';
import type { SliceOrientation, CrosshairPosition } from '../types';
import type { ObliquePlaneComputed, ObliqueBasis, ObliquePlaneOptions, Line3D } from './types';
import {
  getBasisForOrientation,
  rotateBasis,
  applyAffine,
  applyInverseAffine,
  projectBoundingBox,
  planeIntersection,
} from './math';

/**
 * 斜切平面类
 *
 * 管理一个斜切平面的所有几何参数：
 * - 基准方向（axial/coronal/sagittal）
 * - 当前旋转（四元数）
 * - 共享焦点（RAS 空间）
 * - 输出图像尺寸（动态计算）
 */
export class ObliquePlane {
  private volume: NiftiVolume;
  private baseOrientation: SliceOrientation;

  // Affine 矩阵（IJK ↔ RAS）
  private affine: number[];
  private inverseAffine: number[];

  // 当前状态
  private focalPointRas: vec3;
  private rotation: quat;
  private currentBasis: ObliqueBasis;
  private computed: ObliquePlaneComputed | null = null;

  constructor(options: ObliquePlaneOptions) {
    this.volume = options.volume;
    this.baseOrientation = options.baseOrientation;

    // 提取 affine 矩阵
    this.affine = extractAffineMatrix(options.volume.header);
    this.inverseAffine = invertMatrix(this.affine);

    // 初始化焦点为体积中心（RAS）
    const centerIjk: [number, number, number] = [
      Math.floor(options.volume.dimensions[0] / 2),
      Math.floor(options.volume.dimensions[1] / 2),
      Math.floor(options.volume.dimensions[2] / 2),
    ];
    this.focalPointRas = applyAffine(centerIjk, this.affine);

    // 初始化旋转为单位四元数
    if (options.initialRotation) {
      this.rotation = quat.fromValues(
        options.initialRotation[0],
        options.initialRotation[1],
        options.initialRotation[2],
        options.initialRotation[3]
      );
    } else {
      this.rotation = quat.create();
    }
    quat.normalize(this.rotation, this.rotation);

    // 获取基准基向量并应用旋转
    const baseBasis = getBasisForOrientation(this.baseOrientation, this.affine);
    this.currentBasis = rotateBasis(baseBasis, this.rotation);

    // 计算输出尺寸
    this.updateComputed();
  }

  /**
   * 设置旋转四元数
   */
  setRotation(q: quat): void {
    quat.copy(this.rotation, q);
    quat.normalize(this.rotation, this.rotation);

    const baseBasis = getBasisForOrientation(this.baseOrientation, this.affine);
    this.currentBasis = rotateBasis(baseBasis, this.rotation);
    this.updateComputed();
  }

  /**
   * 应用增量旋转
   */
  applyRotationDelta(delta: quat): void {
    quat.multiply(this.rotation, delta, this.rotation);
    quat.normalize(this.rotation, this.rotation);

    const baseBasis = getBasisForOrientation(this.baseOrientation, this.affine);
    this.currentBasis = rotateBasis(baseBasis, this.rotation);
    this.updateComputed();
  }

  /**
   * 设置焦点（RAS 空间）
   */
  setFocalPointRas(ras: [number, number, number]): void {
    this.focalPointRas = vec3.fromValues(...ras);
    this.updateComputed();
  }

  /**
   * 设置焦点（IJK 空间）
   */
  setFocalPointIjk(ijk: CrosshairPosition): void {
    const ras = applyAffine([ijk.i, ijk.j, ijk.k], this.affine);
    this.focalPointRas = ras;
    this.updateComputed();
  }

  /**
   * 获取焦点（RAS 空间）
   */
  getFocalPointRas(): [number, number, number] {
    return [this.focalPointRas[0], this.focalPointRas[1], this.focalPointRas[2]];
  }

  /**
   * 获取焦点（IJK 空间）
   */
  getFocalPointIjk(): CrosshairPosition {
    const ijk = applyInverseAffine(
      [this.focalPointRas[0], this.focalPointRas[1], this.focalPointRas[2]],
      this.inverseAffine
    );
    return {
      i: Math.round(ijk[0]),
      j: Math.round(ijk[1]),
      k: Math.round(ijk[2]),
    };
  }

  /**
   * 获取当前旋转四元数
   */
  getRotation(): quat {
    return quat.clone(this.rotation);
  }

  /**
   * 获取当前基向量
   */
  getBasis(): ObliqueBasis {
    return { ...this.currentBasis };
  }

  /**
   * 获取计算后的平面参数
   */
  getComputed(): ObliquePlaneComputed {
    if (!this.computed) {
      this.updateComputed();
    }
    return this.computed!;
  }

  /**
   * 平面坐标 (u, v) → RAS 坐标
   *
   * p = center + u * uAxis + v * vAxis
   */
  planeToRas(u: number, v: number): [number, number, number] {
    const result = vec3.create();
    const uVec = vec3.fromValues(...this.currentBasis.uAxis);
    const vVec = vec3.fromValues(...this.currentBasis.vAxis);

    vec3.scale(uVec, uVec, u);
    vec3.scale(vVec, vVec, v);

    vec3.add(result, this.focalPointRas, uVec);
    vec3.add(result, result, vVec);

    return [result[0], result[1], result[2]];
  }

  /**
   * RAS 坐标 → 平面坐标 (u, v)
   *
   * u = (p - center) · uAxis
   * v = (p - center) · vAxis
   *
   * 返回 null 如果点不在平面上（距平面超过阈值）
   */
  rasToPlane(ras: [number, number, number], threshold = 0.5): { u: number; v: number } | null {
    const p = vec3.fromValues(...ras);
    const rel = vec3.create();
    vec3.sub(rel, p, this.focalPointRas);

    const uAxis = vec3.fromValues(...this.currentBasis.uAxis);
    const vAxis = vec3.fromValues(...this.currentBasis.vAxis);
    const normal = vec3.fromValues(...this.currentBasis.normal);

    // 检查点到平面的距离
    const distToPlane = Math.abs(vec3.dot(rel, normal));
    if (distToPlane > threshold) {
      return null;
    }

    const u = vec3.dot(rel, uAxis);
    const v = vec3.dot(rel, vAxis);

    return { u, v };
  }

  /**
   * 平面坐标 (u, v) → IJK 坐标（用于采样）
   */
  planeToIjk(u: number, v: number): [number, number, number] {
    const ras = this.planeToRas(u, v);
    const ijk = applyInverseAffine(ras, this.inverseAffine);
    return [ijk[0], ijk[1], ijk[2]];
  }

  /**
   * IJK 坐标 → 平面坐标 (u, v)
   */
  ijkToPlane(ijk: [number, number, number]): { u: number; v: number } | null {
    const ras = applyAffine(ijk, this.affine);
    return this.rasToPlane([ras[0], ras[1], ras[2]]);
  }

  /**
   * RAS → IJK 转换
   */
  rasToIjk(ras: [number, number, number]): [number, number, number] {
    const ijk = applyInverseAffine(ras, this.inverseAffine);
    return [ijk[0], ijk[1], ijk[2]];
  }

  /**
   * IJK → RAS 转换
   */
  ijkToRas(ijk: [number, number, number]): [number, number, number] {
    const ras = applyAffine(ijk, this.affine);
    return [ras[0], ras[1], ras[2]];
  }

  /**
   * 获取与另一平面的交线
   */
  getIntersectionWith(other: ObliquePlaneComputed): Line3D | null {
    const result = planeIntersection(
      this.getComputed().center,
      this.getComputed().basis.normal,
      other.center,
      other.basis.normal
    );

    if (!result) {
      return null;
    }

    // 计算交线与体积边界框的两个交点
    // 简化：返回穿过焦点的线段
    const direction: [number, number, number] = [result.direction[0], result.direction[1], result.direction[2]];
    const point: [number, number, number] = [result.point[0], result.point[1], result.point[2]];

    // 找到线段与体积边界框的交点
    const tValues = this.intersectLineWithBoundingBox(point, direction);
    if (!tValues) {
      return null;
    }

    const start: [number, number, number] = [
      point[0] + direction[0] * tValues.tMin,
      point[1] + direction[1] * tValues.tMin,
      point[2] + direction[2] * tValues.tMin,
    ];
    const end: [number, number, number] = [
      point[0] + direction[0] * tValues.tMax,
      point[1] + direction[1] * tValues.tMax,
      point[2] + direction[2] * tValues.tMax,
    ];

    return { start, end };
  }

  /**
   * 更新计算后的平面参数
   */
  private updateComputed(): void {
    const { width, height } = projectBoundingBox(
      this.volume.dimensions as [number, number, number],
      this.affine,
      this.currentBasis,
      [this.focalPointRas[0], this.focalPointRas[1], this.focalPointRas[2]]
    );

    this.computed = {
      center: [this.focalPointRas[0], this.focalPointRas[1], this.focalPointRas[2]],
      basis: this.currentBasis,
      width: Math.max(1, width),
      height: Math.max(1, height),
      baseOrientation: this.baseOrientation,
    };
  }

  /**
   * 计算直线与体积边界框的交点（全部在 RAS 空间）
   *
   * 使用参数方程：p(t) = origin + t * direction
   * 注意：origin 和 direction 是 RAS 坐标，边界框也在 RAS 空间（由 IJK 角点经 affine 变换得到）
   * direction 必须是单位向量
   * 返回进入和离开边界框的 t 值
   */
  private intersectLineWithBoundingBox(
    origin: [number, number, number],
    direction: [number, number, number]
  ): { tMin: number; tMax: number } | null {
    const dims = this.volume.dimensions as [number, number, number];

    // Compute RAS bounds from the 8 IJK corners
    const corners: [number, number, number][] = [
      [0, 0, 0],
      [dims[0] - 1, 0, 0],
      [0, dims[1] - 1, 0],
      [0, 0, dims[2] - 1],
      [dims[0] - 1, dims[1] - 1, 0],
      [dims[0] - 1, 0, dims[2] - 1],
      [0, dims[1] - 1, dims[2] - 1],
      [dims[0] - 1, dims[1] - 1, dims[2] - 1],
    ];

    const rasCorners = corners.map(c => applyAffine(c, this.affine));

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const c of rasCorners) {
      if (c[0] < minX) minX = c[0]; if (c[0] > maxX) maxX = c[0];
      if (c[1] < minY) minY = c[1]; if (c[1] > maxY) maxY = c[1];
      if (c[2] < minZ) minZ = c[2]; if (c[2] > maxZ) maxZ = c[2];
    }

    const bounds: [number, number][] = [
      [minX, maxX],
      [minY, maxY],
      [minZ, maxZ],
    ];

    let tMin = -Infinity;
    let tMax = Infinity;

    for (let axis = 0; axis < 3; axis++) {
      const originVal = origin[axis];
      const dirVal = direction[axis];
      const [minBound, maxBound] = bounds[axis];

      if (Math.abs(dirVal) < 1e-10) {
        // 直线平行于此轴
        if (originVal < minBound || originVal > maxBound) {
          return null;
        }
      } else {
        const t1 = (minBound - originVal) / dirVal;
        const t2 = (maxBound - originVal) / dirVal;

        const tNear = Math.min(t1, t2);
        const tFar = Math.max(t1, t2);

        tMin = Math.max(tMin, tNear);
        tMax = Math.min(tMax, tFar);

        if (tMin > tMax) {
          return null;
        }
      }
    }

    return { tMin, tMax };
  }
}

/**
 * 工厂函数：创建斜切平面
 */
export function createObliquePlane(options: ObliquePlaneOptions): ObliquePlane {
  return new ObliquePlane(options);
}
