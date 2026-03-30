// Unit tests for ObliqueExtractor (Phase 2: 斜切面提取)

import { describe, it, expect } from 'vitest';
import type { NiftiVolume } from '@jsmedgl/parser-nifti';
import { createObliqueExtractor } from '@jsmedgl/renderer-2d/oblique/ObliqueExtractor';
import { createObliquePlane } from '@jsmedgl/renderer-2d/oblique/ObliquePlane';

// ─── Helpers ──────────────────────────────────���────────────────────────────────

/**
 * 创建带有可控体素数据的 mock volume
 *
 * 注意：ObliqueExtractor 构造时会将所有数据归一化到 [0, 255]。
 * 所以测试中的 fillFn 返回的是原始值，归一化后会被重新映射。
 * 为了简化测试，建议使用 0 和 255 两个值。
 */
function createMockVolumeWithData(
  dims: [number, number, number] = [4, 4, 4],
  fillFn?: (i: number, j: number, k: number) => number
): NiftiVolume {
  const [dx, dy, dz] = dims;
  const numVoxels = dx * dy * dz;
  const data = new Uint8Array(numVoxels);

  if (fillFn) {
    for (let k = 0; k < dz; k++) {
      for (let j = 0; j < dy; j++) {
        for (let i = 0; i < dx; i++) {
          data[k * dx * dy + j * dx + i] = fillFn(i, j, k);
        }
      }
    }
  } else {
    for (let idx = 0; idx < numVoxels; idx++) {
      data[idx] = idx % 256;
    }
  }

  return {
    header: {
      sizeof_hdr: 348,
      dim: [3, dx, dy, dz, 1, 1, 1, 1],
      datatype: 2,
      pixdim: [1.0, 1.0, 1.0, 1.0] as any,
      qform_code: 0,
      sform_code: 0,
      quatern_b: 0,
      quatern_c: 0,
      quatern_d: 0,
      qoffset_x: 0,
      qoffset_y: 0,
      qoffset_z: 0,
      sform: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
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
    data: data.buffer as ArrayBuffer,
    dimensions: dims,
    spacing: [1.0, 1.0, 1.0],
    affine: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ],
    inverseAffine: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ],
    warnings: [],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────────

describe('ObliqueExtractor — Phase 2: 斜切面提取', () => {

  // ── 2.1 三线性插值 ──────────────────────────────────────────────────────

  describe('三线性插值 (trilinearSample)', () => {
    it('整数坐标应返回归一化后的体素值', () => {
      // 使用 0/255 二值数据，归一化后保持 0 和 255
      const volume = createMockVolumeWithData([4, 4, 4], (i, _j, _k) => i === 0 ? 0 : 255);
      const extractor = createObliqueExtractor({ volume });

      expect(extractor.trilinearSample([0, 0, 0])).toBeCloseTo(0, 0);
      expect(extractor.trilinearSample([1, 0, 0])).toBeCloseTo(255, 0);
    });

    it('沿 X 轴线性插值应正确', () => {
      const volume = createMockVolumeWithData([4, 4, 4], (i, _j, _k) => i === 0 ? 0 : 255);
      const extractor = createObliqueExtractor({ volume });

      // (0.5, 0, 0) → (0 + 255) / 2 = 127.5
      const val = extractor.trilinearSample([0.5, 0, 0]);
      expect(val).toBeCloseTo(127.5, 0);
    });

    it('沿 Y 轴线性插值应正确', () => {
      const volume = createMockVolumeWithData([4, 4, 4], (_i, j, _k) => j === 0 ? 0 : 255);
      const extractor = createObliqueExtractor({ volume });

      const val = extractor.trilinearSample([0, 0.5, 0]);
      expect(val).toBeCloseTo(127.5, 0);
    });

    it('沿 Z 轴线性插值应正确', () => {
      const volume = createMockVolumeWithData([4, 4, 4], (_i, _j, k) => k === 0 ? 0 : 255);
      const extractor = createObliqueExtractor({ volume });

      const val = extractor.trilinearSample([0, 0, 0.5]);
      expect(val).toBeCloseTo(127.5, 0);
    });

    it('均匀体积应返回常数值', () => {
      const volume = createMockVolumeWithData([4, 4, 4], () => 128);
      const extractor = createObliqueExtractor({ volume });

      // 常数值 128, range=0, v>0 → normalized 255
      expect(extractor.trilinearSample([1.5, 2.3, 0.7])).toBeCloseTo(255, 0);
    });

    it('三线性插值应平滑过渡', () => {
      // X 方向线性梯度: 0, 85, 170, 255 → 归一化后保持不变
      const volume = createMockVolumeWithData([4, 4, 4], (i, _j, _k) => i * 85);
      const extractor = createObliqueExtractor({ volume });

      const v0 = extractor.trilinearSample([0, 0, 0]);
      const v1 = extractor.trilinearSample([1, 0, 0]);
      const v2 = extractor.trilinearSample([2, 0, 0]);
      const v3 = extractor.trilinearSample([3, 0, 0]);

      // 应单调递增
      expect(v1).toBeGreaterThan(v0);
      expect(v2).toBeGreaterThan(v1);
      expect(v3).toBeGreaterThan(v2);

      // 中间点应为两端平均
      const vmid = extractor.trilinearSample([1.5, 0, 0]);
      expect(vmid).toBeCloseTo((v1 + v2) / 2, 0);
    });
  });

  // ── 2.2 边界条件 ──────────────────────────────────────────────────────

  describe('边界条件处理', () => {
    it('越界采样应返回 0', () => {
      const volume = createMockVolumeWithData([4, 4, 4], () => 200);
      const extractor = createObliqueExtractor({ volume });

      expect(extractor.trilinearSample([-1, 0, 0])).toBe(0);
      expect(extractor.trilinearSample([0, -1, 0])).toBe(0);
      expect(extractor.trilinearSample([0, 0, -1])).toBe(0);
      expect(extractor.trilinearSample([4, 0, 0])).toBe(0);
      expect(extractor.trilinearSample([0, 4, 0])).toBe(0);
      expect(extractor.trilinearSample([0, 0, 4])).toBe(0);
    });

    it('边界上的采样应返回有效值', () => {
      const volume = createMockVolumeWithData([4, 4, 4], (i, _j, _k) => i * 85);
      const extractor = createObliqueExtractor({ volume });

      // 最后一个有效体素 (i=3) → 归一化后应为 255
      const val = extractor.trilinearSample([3, 0, 0]);
      expect(val).toBeCloseTo(255, 0);
    });
  });

  // ── 2.3 斜切面提取 ──────────────────────────────────────────────────────

  describe('斜切面提取 (extractSlice)', () => {
    it('应返回正确尺寸的输出', () => {
      const volume = createMockVolumeWithData([64, 64, 64]);
      const plane = createObliquePlane({ volume, baseOrientation: 'axial' });
      const extractor = createObliqueExtractor({ volume });

      const computed = plane.getComputed();
      const result = extractor.extractSlice(computed);

      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(result.data.length).toBe(result.width * result.height);
    });

    it('均匀体积的斜切面中心区域应为常数值', () => {
      const volume = createMockVolumeWithData([16, 16, 16], () => 200);
      const plane = createObliquePlane({ volume, baseOrientation: 'axial' });
      const extractor = createObliqueExtractor({ volume });

      const result = extractor.extractSlice(plane.getComputed());

      // 中心区域（避免越界边界效应）应为 255（常数值 200 > 0 → 归一化后为 255）
      const cx = Math.floor(result.width / 2);
      const cy = Math.floor(result.height / 2);
      const margin = Math.floor(Math.min(result.width, result.height) * 0.25);

      let allHigh = true;
      for (let y = cy - margin; y <= cy + margin; y++) {
        for (let x = cx - margin; x <= cx + margin; x++) {
          if (result.data[y * result.width + x] < 200) {
            allHigh = false;
            break;
          }
        }
        if (!allHigh) break;
      }
      expect(allHigh).toBe(true);
    });

    it('不同方向的切面应返回不同数据', () => {
      const volume = createMockVolumeWithData([16, 16, 16], (i, j, k) => {
        return (i + j * 16 + k * 256) % 256;
      });

      const axialPlane = createObliquePlane({ volume, baseOrientation: 'axial' });
      const coronalPlane = createObliquePlane({ volume, baseOrientation: 'coronal' });
      const extractor = createObliqueExtractor({ volume });

      const axialResult = extractor.extractSlice(axialPlane.getComputed());
      const coronalResult = extractor.extractSlice(coronalPlane.getComputed());

      // 不同方向的切面数据不应完全相同
      let identical = true;
      const minLen = Math.min(axialResult.data.length, coronalResult.data.length);
      for (let i = 0; i < minLen; i++) {
        if (axialResult.data[i] !== coronalResult.data[i]) {
          identical = false;
          break;
        }
      }
      expect(identical).toBe(false);
    });

    it('无旋转的斜切面应保持左到右值单调递增', () => {
      const volume = createMockVolumeWithData([8, 8, 8], (i, _j, _k) => i * 30);
      const plane = createObliquePlane({ volume, baseOrientation: 'axial' });
      const extractor = createObliqueExtractor({ volume });

      const computed = plane.getComputed();
      const result = extractor.extractSlice(computed);

      // 在无旋转的 axial 视图中，从左到右值应该单调递增
      const midRow = Math.floor(result.height / 2);
      const leftVal = result.data[midRow * result.width + 1];
      const rightVal = result.data[midRow * result.width + result.width - 2];

      expect(rightVal).toBeGreaterThanOrEqual(leftVal);
    });
  });

  // ── 2.4 降采样 ──────────────────────────────────────────────────────

  describe('降采样 (extractSliceDownsampled)', () => {
    it('降采样输出尺寸应正确', () => {
      const volume = createMockVolumeWithData([64, 64, 64]);
      const plane = createObliquePlane({ volume, baseOrientation: 'axial' });
      const extractor = createObliqueExtractor({ volume });

      const computed = plane.getComputed();
      const full = extractor.extractSlice(computed);
      const half = extractor.extractSliceDownsampled(computed, 0.5);

      expect(half.width).toBe(Math.max(1, Math.round(full.width * 0.5)));
      expect(half.height).toBe(Math.max(1, Math.round(full.height * 0.5)));
      expect(half.data.length).toBe(half.width * half.height);
    });

    it('scale=1 应与完整提取尺寸一致', () => {
      const volume = createMockVolumeWithData([32, 32, 32]);
      const plane = createObliquePlane({ volume, baseOrientation: 'axial' });
      const extractor = createObliqueExtractor({ volume });

      const computed = plane.getComputed();
      const full = extractor.extractSlice(computed);
      const same = extractor.extractSliceDownsampled(computed, 1);

      expect(same.width).toBe(full.width);
      expect(same.height).toBe(full.height);
    });

    it('极低采样比应至少返回 1x1', () => {
      const volume = createMockVolumeWithData([32, 32, 32]);
      const plane = createObliquePlane({ volume, baseOrientation: 'axial' });
      const extractor = createObliqueExtractor({ volume });

      const result = extractor.extractSliceDownsampled(plane.getComputed(), 0.01);

      expect(result.width).toBeGreaterThanOrEqual(1);
      expect(result.height).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 2.5 归一化数据 ──────────────────────────────────────────────────────

  describe('数据归一化', () => {
    it('所有输出值应在 [0, 255] 范围内', () => {
      const volume = createMockVolumeWithData([16, 16, 16], (i, j, k) => {
        return (i * 17 + j * 31 + k * 53) % 256;
      });
      const plane = createObliquePlane({ volume, baseOrientation: 'axial' });
      const extractor = createObliqueExtractor({ volume });

      const result = extractor.extractSlice(plane.getComputed());

      for (let i = 0; i < result.data.length; i++) {
        expect(result.data[i]).toBeGreaterThanOrEqual(0);
        expect(result.data[i]).toBeLessThanOrEqual(255);
      }
    });

    it('getNormalizedData 应返回 Uint8Array', () => {
      const volume = createMockVolumeWithData([4, 4, 4]);
      const extractor = createObliqueExtractor({ volume });

      const data = extractor.getNormalizedData();
      expect(data).toBeInstanceOf(Uint8Array);
      expect(data.length).toBe(4 * 4 * 4);
    });
  });

  // ── 2.6 获取尺寸 ──────────────────────────────────────────────────────

  describe('getDimensions', () => {
    it('应返回正确的体积尺寸', () => {
      const volume = createMockVolumeWithData([32, 48, 64]);
      const extractor = createObliqueExtractor({ volume });

      const dims = extractor.getDimensions();
      expect(dims).toEqual([32, 48, 64]);
    });
  });
});
