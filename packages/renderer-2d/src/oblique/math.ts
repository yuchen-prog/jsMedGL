// Mathematical utilities for oblique MPR

import { vec3, quat, mat3 } from 'gl-matrix';
import type { ObliqueBasis, SliceOrientation } from './types';

/**
 * 基准方向的初始基向量（RAS 空间）
 *
 * 这些基向量与现有正交 MPR 的渲染方向一致：
 *
 * - Axial:    法向量 +K（从脚到头），U=+I（左到右），V=-J（后到前，渲染时 Y 反转）
 * - Coronal:  法向量 -J（从前到后），U=+I（左到右），V=+K（从脚到头）
 * - Sagittal: 法向量 +I（从右到左），U=-J（后到前），V=+K（从脚到头）
 */
export function getBasisForOrientation(orientation: SliceOrientation): ObliqueBasis {
  switch (orientation) {
    case 'axial':
      // Axial 切面：XY 平面（I-J 平面），法向量指向 +K
      // 现有实现：texture X → I, texture Y → J (reversed)
      // U 轴对应 texture X → +I
      // V 轴对应 texture Y（反转后）→ -J（因为 J 反转使 A 在顶部）
      return {
        normal: [0, 0, 1],    // +K
        uAxis: [1, 0, 0],     // +I
        vAxis: [0, -1, 0],    // -J
      };

    case 'coronal':
      // Coronal 切面：XZ 平面（I-K 平面），法向量指向 -J
      // 现有实现：texture X → I, texture Y → K
      // U 轴对应 texture X → +I
      // V 轴对应 texture Y → +K
      return {
        normal: [0, -1, 0],   // -J
        uAxis: [1, 0, 0],     // +I
        vAxis: [0, 0, 1],     // +K
      };

    case 'sagittal':
      // Sagittal 切面：YZ 平面（J-K 平面），法向量指向 +I
      // 现有实现：texture X → J, texture Y → K
      // U 轴对应 texture X → -J（Anterior 在左，Posterior 在右）
      // V 轴对应 texture Y → +K
      return {
        normal: [1, 0, 0],    // +I
        uAxis: [0, -1, 0],    // -J
        vAxis: [0, 0, 1],     // +K
      };
  }
  // TypeScript exhaustiveness check
  const _exhaustive: never = orientation;
  return _exhaustive;
}

/**
 * 使用 Gram-Schmidt 正交化确保基向量正交归一化
 *
 * 步骤：
 * 1. 归一化 uAxis
 * 2. vAxis' = vAxis - proj_uAxis(vAxis)，然后归一化
 * 3. normal' = cross(uAxis, vAxis')
 */
export function orthonormalizeBasis(basis: ObliqueBasis): ObliqueBasis {
  const u = vec3.fromValues(...basis.uAxis);
  const v = vec3.fromValues(...basis.vAxis);

  // Step 1: 归一化 u
  vec3.normalize(u, u);

  // Step 2: v' = v - proj_u(v) = v - (v·u)u
  const proj = vec3.create();
  vec3.scale(proj, u, vec3.dot(v, u));
  vec3.sub(v, v, proj);
  vec3.normalize(v, v);

  // Step 3: normal = u × v
  const n = vec3.create();
  vec3.cross(n, u, v);
  vec3.normalize(n, n);

  return {
    normal: [n[0], n[1], n[2]],
    uAxis: [u[0], u[1], u[2]],
    vAxis: [v[0], v[1], v[2]],
  };
}

/**
 * 验证基向量是否正交归一化
 */
export function validateBasis(basis: ObliqueBasis, tolerance = 1e-6): boolean {
  const n = vec3.fromValues(...basis.normal);
  const u = vec3.fromValues(...basis.uAxis);
  const v = vec3.fromValues(...basis.vAxis);

  // 检查归一化
  if (Math.abs(vec3.len(n) - 1) > tolerance) return false;
  if (Math.abs(vec3.len(u) - 1) > tolerance) return false;
  if (Math.abs(vec3.len(v) - 1) > tolerance) return false;

  // 检查正交性
  if (Math.abs(vec3.dot(n, u)) > tolerance) return false;
  if (Math.abs(vec3.dot(n, v)) > tolerance) return false;
  if (Math.abs(vec3.dot(u, v)) > tolerance) return false;

  // 检查 n 与 u × v 方向一致（右手系：n = u × v，允许符号差异）
  const cross = vec3.create();
  vec3.cross(cross, u, v);
  // |n · (u × v)| = 1 表示方向一致或相反（两种都是有效的右手系定义）
  if (Math.abs(Math.abs(vec3.dot(n, cross)) - 1) > tolerance) return false;

  return true;
}

/**
 * 计算两平面的交线
 *
 * 两平面方程：
 * - P1: n1 · (p - c1) = 0
 * - P2: n2 · (p - c2) = 0
 *
 * 交线方向：d = n1 × n2
 *
 * 如果 n1 ∥ n2（|cross| ≈ 0），返回 null
 */
export function planeIntersection(
  center1: [number, number, number],
  normal1: [number, number, number],
  center2: [number, number, number],
  normal2: [number, number, number]
): { direction: vec3; point: vec3 } | null {
  const n1 = vec3.fromValues(...normal1);
  const n2 = vec3.fromValues(...normal2);
  const c1 = vec3.fromValues(...center1);
  const c2 = vec3.fromValues(...center2);

  // 交线方向 = n1 × n2
  const direction = vec3.create();
  vec3.cross(direction, n1, n2);
  const crossLen = vec3.len(direction);

  // 如果两平面平行，无交线
  if (crossLen < 1e-10) {
    return null;
  }

  vec3.normalize(direction, direction);

  // 找交线上的一点：解线性方程组
  const d = vec3.create();
  vec3.sub(d, c2, c1);

  // 点 = c1 + ((n2·d) / crossLenSq) * (n1 × direction) + ((n1·d) / crossLenSq) * (direction × n2)
  // 简化为：point = c1 + α*(n1 × n2_perp) + β*(n2 × n1_perp)
  //
  // 使用更简单的方法：三个平面交点
  // 构造第三个平面：经过 c1，法向量为 direction

  // 解：p = c1 + s1*u1 + s2*u2
  // 其中 u1, u2 是平面1内的两个正交基
  const u1 = direction;
  const u2 = vec3.create();
  vec3.cross(u2, n1, direction);
  vec3.normalize(u2, u2);

  const a = vec3.dot(n2, u1);
  const b_coef = vec3.dot(n2, u2);
  const c = vec3.dot(n2, d);

  const point = vec3.create();

  if (Math.abs(b_coef) > 1e-10) {
    const s2 = c / b_coef;
    vec3.scale(u2, u2, s2);
    vec3.add(point, c1, u2);
  } else if (Math.abs(a) > 1e-10) {
    const s1 = c / a;
    vec3.scale(u1, u1, s1);
    vec3.add(point, c1, u1);
  } else {
    vec3.copy(point, c1);
  }

  return { direction, point };
}

/**
 * 计算体积边界框在斜切平面上的投影尺寸
 *
 * 方法：
 * 1. 遍历体积的 8 个角点（IJK 空间）
 * 2. 转换到 RAS 空间
 * 3. 投影到斜切平面（计算 u, v 坐标）
 * 4. 取 u, v 的范围作为输出尺寸
 */
export function projectBoundingBox(
  dims: [number, number, number],
  affine: number[],
  basis: ObliqueBasis,
  center: [number, number, number]
): { width: number; height: number } {
  const uAxis = vec3.fromValues(...basis.uAxis);
  const vAxis = vec3.fromValues(...basis.vAxis);
  const centerVec = vec3.fromValues(...center);

  // 8 个角点的 IJK 坐标
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

  let uMin = Infinity, uMax = -Infinity;
  let vMin = Infinity, vMax = -Infinity;

  for (const ijk of corners) {
    const ras = applyAffine(ijk, affine);

    const rel = vec3.create();
    vec3.sub(rel, ras, centerVec);

    const u = vec3.dot(rel, uAxis);
    const v = vec3.dot(rel, vAxis);

    uMin = Math.min(uMin, u);
    uMax = Math.max(uMax, u);
    vMin = Math.min(vMin, v);
    vMax = Math.max(vMax, v);
  }

  const width = Math.ceil(uMax - uMin);
  const height = Math.ceil(vMax - vMin);

  return { width, height };
}

/**
 * 应用 affine 矩阵转换 IJK → RAS
 */
export function applyAffine(ijk: [number, number, number], affine: number[]): vec3 {
  const i = ijk[0], j = ijk[1], k = ijk[2];

  const x = affine[0] * i + affine[1] * j + affine[2] * k + affine[3];
  const y = affine[4] * i + affine[5] * j + affine[6] * k + affine[7];
  const z = affine[8] * i + affine[9] * j + affine[10] * k + affine[11];

  return vec3.fromValues(x, y, z);
}

/**
 * 应用 affine 逆矩阵转换 RAS → IJK
 */
export function applyInverseAffine(ras: [number, number, number], inverseAffine: number[]): vec3 {
  return applyAffine(ras, inverseAffine);
}

/**
 * 使用四元数旋转基向量
 */
export function rotateBasis(basis: ObliqueBasis, q: quat): ObliqueBasis {
  const rotationMatrix = mat3.create();
  mat3.fromQuat(rotationMatrix, q);

  const n = vec3.fromValues(...basis.normal);
  const u = vec3.fromValues(...basis.uAxis);
  const v = vec3.fromValues(...basis.vAxis);

  vec3.transformMat3(n, n, rotationMatrix);
  vec3.transformMat3(u, u, rotationMatrix);
  vec3.transformMat3(v, v, rotationMatrix);

  return orthonormalizeBasis({
    normal: [n[0], n[1], n[2]],
    uAxis: [u[0], u[1], u[2]],
    vAxis: [v[0], v[1], v[2]],
  });
}

/**
 * 从旋转轴和角度创建四元数
 */
export function quaternionFromAxisAngle(axis: [number, number, number], angle: number): quat {
  const q = quat.create();
  const axisVec = vec3.fromValues(...axis);
  vec3.normalize(axisVec, axisVec);
  quat.setAxisAngle(q, axisVec, angle);
  return q;
}

/**
 * 将两个四元数相乘（组合旋转）
 */
export function multiplyQuaternions(q1: quat, q2: quat): quat {
  const result = quat.create();
  quat.multiply(result, q1, q2);
  return result;
}
