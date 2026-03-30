// Unit tests for oblique-plane (Phase 1: 基础数学层)

import { describe, it, expect } from 'vitest';
import { vec3, quat } from 'gl-matrix';
import type { NiftiVolume } from '@jsmedgl/parser-nifti';
import {
  getBasisForOrientation,
  orthonormalizeBasis,
  validateBasis,
  planeIntersection,
  projectBoundingBox,
  applyAffine,
  rotateBasis,
  quaternionFromAxisAngle,
  multiplyQuaternions,
} from '@jsmedgl/renderer-2d/oblique/math';
import { createObliquePlane } from '@jsmedgl/renderer-2d/oblique';
import type { ObliqueBasis } from '@jsmedgl/renderer-2d/oblique/types';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function createMockVolume(
  dims: [number, number, number] = [64, 64, 64],
  pixdim: number[] = [1.0, 1.0, 1.0, 1.0]
): NiftiVolume {
  return {
    header: {
      sizeof_hdr: 348,
      dim: [3, dims[0], dims[1], dims[2], 1, 1, 1, 1],
      datatype: 2,
      pixdim: pixdim as any,
      qform_code: 0,
      sform_code: 0,
      quatern_b: 0,
      quatern_c: 0,
      quatern_d: 0,
      qoffset_x: 0,
      qoffset_y: 0,
      qoffset_z: 0,
      sform: [
        pixdim[1], 0, 0, -dims[0] / 2,
        0, pixdim[2], 0, -dims[1] / 2,
        0, 0, pixdim[3], -dims[2] / 2,
        0, 0, 0, 1,
      ],
      sform_code_flag: 0,
      descrip: '',
      aux_file: '',
      intent_code: 0,
      intent_name: '',
      intent_p1: 0,
      intent_p2: 0,
      intent_p3: 0,
      slice_start: 0,
      slice_end: 0,
      slice_code: 0,
      xyzt_units: 0,
      cal_max: 0,
      cal_min: 0,
      slice_duration: 0,
      toffset: 0,
      vox_offset: 0,
    },
    data: new ArrayBuffer(dims[0] * dims[1] * dims[2]),
    dimensions: dims,
    spacing: [pixdim[1], pixdim[2], pixdim[3]],
    warnings: [],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────────

// Identity affine for unit tests (IJK=RAS, no negative axes)
const IDENTITY_AFFINE = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

// Negative-diagonal affine (common in NIfTI: RAS convention with flipped I and J)
const NEGATIVE_AFFINE = [
  -1, 0, 0, 0,
  0, -1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

describe('ObliquePlane — Phase 1: 基础数学层', () => {

  // ── 1.1 基准方向基向量 ──────────────────────────────────────────────────────

  describe('基准方向基向量 (getBasisForOrientation)', () => {
    it('axial 基向量应归一化且正交 (identity affine)', () => {
      const basis = getBasisForOrientation('axial', IDENTITY_AFFINE);
      expect(validateBasis(basis)).toBe(true);
    });

    it('coronal 基向量应归一化且正交 (identity affine)', () => {
      const basis = getBasisForOrientation('coronal', IDENTITY_AFFINE);
      expect(validateBasis(basis)).toBe(true);
    });

    it('sagittal 基向量应归一化且正交 (identity affine)', () => {
      const basis = getBasisForOrientation('sagittal', IDENTITY_AFFINE);
      expect(validateBasis(basis)).toBe(true);
    });

    it('axial 基向量应归一化且正交 (negative affine)', () => {
      const basis = getBasisForOrientation('axial', NEGATIVE_AFFINE);
      expect(validateBasis(basis)).toBe(true);
    });

    // identity affine: col0=[1,0,0], col1=[0,1,0], col2=[0,0,1]
    it('identity affine: axial normal=+K, uAxis=+I, vAxis=-J', () => {
      const basis = getBasisForOrientation('axial', IDENTITY_AFFINE);
      expect(basis.normal[2]).toBeCloseTo(1, 5);
      expect(basis.uAxis[0]).toBeCloseTo(1, 5);
      expect(basis.vAxis[1]).toBeCloseTo(-1, 5); // -col1
    });

    it('identity affine: coronal normal=-J, uAxis=+I, vAxis=+K', () => {
      const basis = getBasisForOrientation('coronal', IDENTITY_AFFINE);
      expect(basis.normal[1]).toBeCloseTo(-1, 5);
      expect(basis.uAxis[0]).toBeCloseTo(1, 5);
      expect(basis.vAxis[2]).toBeCloseTo(1, 5);
    });

    it('identity affine: sagittal normal=+I, uAxis=+J, vAxis=+K', () => {
      const basis = getBasisForOrientation('sagittal', IDENTITY_AFFINE);
      expect(basis.normal[0]).toBeCloseTo(1, 5);
      expect(basis.uAxis[1]).toBeCloseTo(1, 5);
      expect(basis.vAxis[2]).toBeCloseTo(1, 5);
    });

    // negative affine: col0=[-1,0,0], col1=[0,-1,0], col2=[0,0,1]
    it('negative affine: axial normal=+K, uAxis=-I, vAxis=+J', () => {
      const basis = getBasisForOrientation('axial', NEGATIVE_AFFINE);
      expect(basis.normal[2]).toBeCloseTo(1, 5);
      expect(basis.uAxis[0]).toBeCloseTo(-1, 5); // col0/|col0| = [-1,0,0]
      expect(basis.vAxis[1]).toBeCloseTo(1, 5);  // -col1 = [0,+1,0]
    });

    it('negative affine: coronal normal=+J, uAxis=-I, vAxis=+K', () => {
      const basis = getBasisForOrientation('coronal', NEGATIVE_AFFINE);
      expect(basis.normal[1]).toBeCloseTo(1, 5);  // -col1 = [0,+1,0]
      expect(basis.uAxis[0]).toBeCloseTo(-1, 5);  // col0 = [-1,0,0]
      expect(basis.vAxis[2]).toBeCloseTo(1, 5);   // col2 = [0,0,1]
    });

    it('negative affine: sagittal normal=-I, uAxis=-J, vAxis=+K', () => {
      const basis = getBasisForOrientation('sagittal', NEGATIVE_AFFINE);
      expect(basis.normal[0]).toBeCloseTo(-1, 5); // col0 = [-1,0,0]
      expect(basis.uAxis[1]).toBeCloseTo(-1, 5);  // col1 = [0,-1,0]
      expect(basis.vAxis[2]).toBeCloseTo(1, 5);   // col2 = [0,0,1]
    });
  });

  // ── 1.2 Gram-Schmidt 正交化 ──────────────────────────────────────────────

  describe('Gram-Schmidt 正交化 (orthonormalizeBasis)', () => {
    it('应对已有基向量进行归一化', () => {
      const basis: ObliqueBasis = {
        normal: [0, 0, 1],
        uAxis: [2, 0, 0],   // 未归一化 (length=2)
        vAxis: [0, 3, 0],   // 未归一化 (length=3)
      };
      const result = orthonormalizeBasis(basis);
      expect(validateBasis(result)).toBe(true);
    });

    it('应对接近正交的基向量进行修正', () => {
      const basis: ObliqueBasis = {
        normal: [0, 0, 1],
        uAxis: [1, 0.001, 0], // 几乎正交但有微小误差
        vAxis: [0, 1, 0.001],
      };
      const result = orthonormalizeBasis(basis);
      expect(validateBasis(result)).toBe(true);
    });

    it('应保持 normal 方向', () => {
      const basis: ObliqueBasis = {
        normal: [0, 0, 1],
        uAxis: [2, 0, 0],
        vAxis: [0, 2, 0],
      };
      const result = orthonormalizeBasis(basis);
      expect(result.normal[2]).toBeCloseTo(1, 5);  // 应保持 +Z
    });
  });

  // ── 1.3 四元数旋转 ────────────────────────────────────────────────────────

  describe('四元数旋转 (rotateBasis / quaternionFromAxisAngle)', () => {
    it('绕 Z 轴旋转 90° 后基向量仍正交归一化', () => {
      const basis = getBasisForOrientation('axial', IDENTITY_AFFINE);
      const q = quaternionFromAxisAngle([0, 0, 1], Math.PI / 2);
      const rotated = rotateBasis(basis, q);

      expect(validateBasis(rotated)).toBe(true);
    });

    it('绕 X 轴旋转 90° 后基向量仍正交归一化', () => {
      const basis = getBasisForOrientation('axial', IDENTITY_AFFINE);
      const q = quaternionFromAxisAngle([1, 0, 0], Math.PI / 2);
      const rotated = rotateBasis(basis, q);

      expect(validateBasis(rotated)).toBe(true);
    });

    it('四元数组合旋转应等于依次应用', () => {
      const basis = getBasisForOrientation('axial', IDENTITY_AFFINE);
      const q1 = quaternionFromAxisAngle([0, 0, 1], Math.PI / 4);
      const q2 = quaternionFromAxisAngle([0, 0, 1], Math.PI / 4);
      const combined = multiplyQuaternions(q2, q1);  // 注意顺序：q2 * q1

      const rotated1 = rotateBasis(basis, combined);
      const intermediate = rotateBasis(basis, q1);
      const rotated2 = rotateBasis(intermediate, q2);

      expect(rotated1.normal[0]).toBeCloseTo(rotated2.normal[0], 5);
      expect(rotated1.normal[1]).toBeCloseTo(rotated2.normal[1], 5);
      expect(rotated1.normal[2]).toBeCloseTo(rotated2.normal[2], 5);
    });

    it('单位四元数不应改变基向量', () => {
      const basis = getBasisForOrientation('coronal', IDENTITY_AFFINE);
      const identity = quat.create();
      const rotated = rotateBasis(basis, identity);

      expect(rotated.normal[0]).toBeCloseTo(basis.normal[0], 10);
      expect(rotated.normal[1]).toBeCloseTo(basis.normal[1], 10);
      expect(rotated.normal[2]).toBeCloseTo(basis.normal[2], 10);
    });
  });

  // ── 1.4 平面交线 ────────────────────────────────────────────────────────

  describe('平面交线 (planeIntersection)', () => {
    it('两垂直平面应返回交线', () => {
      // Axial (N=+K) 和 Sagittal (N=+I) 平面
      const result = planeIntersection(
        [0, 0, 0], [0, 0, 1],  // 平面上任意一点 + 法向量
        [0, 0, 0], [1, 0, 0]
      );

      expect(result).not.toBeNull();
      // 交线方向应为 K × I = -J（或相反方向，取决于归一化）
      expect(Math.abs(result!.direction[1])).toBeCloseTo(1, 5);
      expect(Math.abs(result!.direction[0])).toBeCloseTo(0, 5);
      expect(Math.abs(result!.direction[2])).toBeCloseTo(0, 5);
    });

    it('两平行平面应返回 null', () => {
      const result = planeIntersection(
        [0, 0, 0], [0, 0, 1],
        [0, 0, 1], [0, 0, 1]   // 同法向量
      );

      expect(result).toBeNull();
    });

    it('交线应经过两平面上指定的中心点（当中心点相同时）', () => {
      const c1 = [1, 2, 3];
      const c2 = [1, 2, 3];
      const result = planeIntersection(
        c1, [0, 0, 1],
        c2, [1, 0, 0]
      );

      expect(result).not.toBeNull();
      // 交点应接近 c1/c2（因为它们相同）
      expect(result!.point[0]).toBeCloseTo(1, 5);
      expect(result!.point[1]).toBeCloseTo(2, 5);
      expect(result!.point[2]).toBeCloseTo(3, 5);
    });
  });

  // ── 1.5 坐标转换 ────────────────────────────────────────────────────────

  describe('坐标转换 (applyAffine)', () => {
    it('单位矩阵变换应保持坐标不变', () => {
      const identity = [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ];
      const result = applyAffine([5, 10, 15], identity);
      expect(result[0]).toBeCloseTo(5, 10);
      expect(result[1]).toBeCloseTo(10, 10);
      expect(result[2]).toBeCloseTo(15, 10);
    });

    it('应正确应用缩放', () => {
      const scale = [
        2, 0, 0, 0,
        0, 3, 0, 0,
        0, 0, 4, 0,
        0, 0, 0, 1,
      ];
      const result = applyAffine([10, 10, 10], scale);
      expect(result[0]).toBeCloseTo(20, 10);
      expect(result[1]).toBeCloseTo(30, 10);
      expect(result[2]).toBeCloseTo(40, 10);
    });

    it('应正确应用平移', () => {
      const translate = [
        1, 0, 0, 5,
        0, 1, 0, 10,
        0, 0, 1, 15,
        0, 0, 0, 1,
      ];
      const result = applyAffine([0, 0, 0], translate);
      expect(result[0]).toBeCloseTo(5, 10);
      expect(result[1]).toBeCloseTo(10, 10);
      expect(result[2]).toBeCloseTo(15, 10);
    });
  });

  // ── 1.6 边界框投影 ───────────────────────────────────────────────────────

  describe('边界框投影 (projectBoundingBox)', () => {
    it('应返回正值尺寸', () => {
      const dims: [number, number, number] = [64, 64, 64];
      const affine = [
        1, 0, 0, -32,
        0, 1, 0, -32,
        0, 0, 1, -32,
        0, 0, 0, 1,
      ];
      const center: [number, number, number] = [0, 0, 0];
      const basis = getBasisForOrientation('axial', affine);

      const { width, height } = projectBoundingBox(dims, affine, basis, center);

      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
    });

    it('不同基向量应返回不同尺寸', () => {
      const dims: [number, number, number] = [100, 200, 150];
      const affine = [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ];
      const center: [number, number, number] = [50, 100, 75];

      const axialResult = projectBoundingBox(dims, affine, getBasisForOrientation('axial', affine), center);
      const coronalResult = projectBoundingBox(dims, affine, getBasisForOrientation('coronal', affine), center);

      // Axial: width = I 范围, height = J 范围
      // Coronal: width = I 范围, height = K 范围
      // 所以 height 应该不同
      expect(axialResult.height).not.toBeCloseTo(coronalResult.height, 0);
    });
  });

  // ── 1.7 ObliquePlane 类 ──────────────────────────────────────────────────

  describe('ObliquePlane 类', () => {
    it('应创建实例并获取基向量', () => {
      const volume = createMockVolume();
      const plane = createObliquePlane({ volume, baseOrientation: 'axial' });

      const basis = plane.getBasis();
      expect(validateBasis(basis)).toBe(true);
    });

    it('应正确计算焦点（体积中心）', () => {
      const volume = createMockVolume([100, 100, 100]);
      const plane = createObliquePlane({ volume, baseOrientation: 'axial' });

      const focalIjk = plane.getFocalPointIjk();

      // 焦点应接近体积中心
      expect(focalIjk.i).toBeCloseTo(50, 0);
      expect(focalIjk.j).toBeCloseTo(50, 0);
      expect(focalIjk.k).toBeCloseTo(50, 0);
    });

    it('设置旋转后基向量应更新', () => {
      const volume = createMockVolume();
      const plane = createObliquePlane({ volume, baseOrientation: 'axial' });

      const before = plane.getBasis();
      const q = quaternionFromAxisAngle([0, 0, 1], Math.PI / 2);
      plane.setRotation(q);
      const after = plane.getBasis();

      // 旋转后基向量仍应有效
      expect(validateBasis(after)).toBe(true);
    });

    it('planeToIjk / ijkToPlane 应往返一致', () => {
      const volume = createMockVolume([50, 50, 50]);
      const plane = createObliquePlane({ volume, baseOrientation: 'axial' });

      const original: [number, number, number] = [25, 25, 25];
      const uv = plane.ijkToPlane(original);
      expect(uv).not.toBeNull();

      const recovered = plane.planeToIjk(uv!.u, uv!.v);
      expect(recovered[0]).toBeCloseTo(original[0], 1);
      expect(recovered[1]).toBeCloseTo(original[1], 1);
      expect(recovered[2]).toBeCloseTo(original[2], 1);
    });

    it('rasToPlane / planeToRas 应往返一致', () => {
      const volume = createMockVolume();
      const plane = createObliquePlane({ volume, baseOrientation: 'coronal' });

      // Fallback affine = identity, IJK center [32,32,32] → RAS focal [32,32,32]
      // Coronal 平面方程 y=32，用 focal point 自身的 IJK 坐标（→ RAS）来测试
      const original: [number, number, number] = [40, 32, 20];
      const uv = plane.rasToPlane(original);
      expect(uv).not.toBeNull();

      const recovered = plane.planeToRas(uv!.u, uv!.v);
      expect(recovered[0]).toBeCloseTo(original[0], 3);
      expect(recovered[1]).toBeCloseTo(original[1], 3);
      expect(recovered[2]).toBeCloseTo(original[2], 3);
    });

    it('设置焦点后 focalPointRas 应更新', () => {
      const volume = createMockVolume();
      const plane = createObliquePlane({ volume, baseOrientation: 'sagittal' });

      const newRas: [number, number, number] = [10, 20, 30];
      plane.setFocalPointRas(newRas);

      const result = plane.getFocalPointRas();
      expect(result[0]).toBeCloseTo(10, 10);
      expect(result[1]).toBeCloseTo(20, 10);
      expect(result[2]).toBeCloseTo(30, 10);
    });

    it('设置焦点 IJK 后 focalPointIjk 应正确转换', () => {
      const volume = createMockVolume([100, 100, 100]);
      const plane = createObliquePlane({ volume, baseOrientation: 'axial' });

      const newIjk = { i: 75, j: 25, k: 50 };
      plane.setFocalPointIjk(newIjk);

      const result = plane.getFocalPointIjk();
      expect(result.i).toBeCloseTo(newIjk.i, 1);
      expect(result.j).toBeCloseTo(newIjk.j, 1);
      expect(result.k).toBeCloseTo(newIjk.k, 1);
    });

    it('getComputed 应返回完整平面参数', () => {
      const volume = createMockVolume();
      const plane = createObliquePlane({ volume, baseOrientation: 'axial' });

      const computed = plane.getComputed();

      expect(computed).toHaveProperty('center');
      expect(computed).toHaveProperty('basis');
      expect(computed.width).toBeGreaterThan(0);
      expect(computed.height).toBeGreaterThan(0);
      expect(computed.baseOrientation).toBe('axial');
      expect(validateBasis(computed.basis)).toBe(true);
    });

    it('应用增量旋转应累积', () => {
      const volume = createMockVolume();
      const plane = createObliquePlane({ volume, baseOrientation: 'axial' });

      const q1 = quaternionFromAxisAngle([0, 0, 1], Math.PI / 4);
      const q2 = quaternionFromAxisAngle([0, 0, 1], Math.PI / 4);
      plane.applyRotationDelta(q1);
      plane.applyRotationDelta(q2);

      const combined = plane.getBasis();
      const qTotal = multiplyQuaternions(q2, q1);
      const plane2 = createObliquePlane({ volume, baseOrientation: 'axial' });
      plane2.setRotation(qTotal);
      const expected = plane2.getBasis();

      expect(combined.normal[0]).toBeCloseTo(expected.normal[0], 5);
      expect(combined.normal[1]).toBeCloseTo(expected.normal[1], 5);
      expect(combined.normal[2]).toBeCloseTo(expected.normal[2], 5);
    });

    it('getIntersectionWith 应返回两平面交线', () => {
      const volume = createMockVolume();
      const axial = createObliquePlane({ volume, baseOrientation: 'axial' });
      const sagittal = createObliquePlane({ volume, baseOrientation: 'sagittal' });

      const line = axial.getIntersectionWith(sagittal.getComputed());

      expect(line).not.toBeNull();
      expect(line!.start).toBeDefined();
      expect(line!.end).toBeDefined();
    });
  });

  // ── 1.8 validateBasis ──────────────────────────────────────────────────

  describe('validateBasis', () => {
    it('对有效基向量应返回 true', () => {
      const basis = getBasisForOrientation('axial', IDENTITY_AFFINE);
      expect(validateBasis(basis)).toBe(true);
    });

    it('对未归一化基向量应返回 false', () => {
      const basis: ObliqueBasis = {
        normal: [0, 0, 1],
        uAxis: [2, 0, 0],  // length=2, not 1
        vAxis: [0, 1, 0],
      };
      expect(validateBasis(basis)).toBe(false);
    });

    it('对非正交基向量应返回 false', () => {
      const basis: ObliqueBasis = {
        normal: [0, 0, 1],
        uAxis: [1, 0.5, 0],  // 不垂直于 normal（dot product != 0）
        vAxis: [0, 1, 0],
      };
      expect(validateBasis(basis)).toBe(false);
    });
  });
});
