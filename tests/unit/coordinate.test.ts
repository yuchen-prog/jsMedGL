// Unit tests for coordinate system utilities

import { describe, it, expect } from 'vitest';
import {
  ijkToRas,
  rasToIjk,
  rasToLps,
  lpsToRas,
  extractAffineMatrix,
  validateOrientation
} from '@jsmedgl/parser-nifti/coordinate';
import type { NiftiHeader } from '@jsmedgl/parser-nifti';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function identityMatrix(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function invertMatrix(m: number[]): number[] {
  const result = new Array(16).fill(0);
  const temp = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) result[i * 4 + i] = 1;
  for (let i = 0; i < 16; i++) temp[i] = m[i];
  for (let i = 0; i < 4; i++) {
    let pivot = i;
    for (let j = i + 1; j < 4; j++) {
      if (Math.abs(temp[j * 4 + i]) > Math.abs(temp[pivot * 4 + i])) pivot = j;
    }
    if (pivot !== i) {
      for (let j = 0; j < 4; j++) {
        const tmp = temp[i * 4 + j];
        temp[i * 4 + j] = temp[pivot * 4 + j];
        temp[pivot * 4 + j] = tmp;
        const tmp2 = result[i * 4 + j];
        result[i * 4 + j] = result[pivot * 4 + j];
        result[pivot * 4 + j] = tmp2;
      }
    }
    const pivotVal = temp[i * 4 + i];
    for (let j = 0; j < 4; j++) {
      temp[i * 4 + j] /= pivotVal;
      result[i * 4 + j] /= pivotVal;
    }
    for (let j = 0; j < 4; j++) {
      if (j !== i) {
        const factor = temp[j * 4 + i];
        for (let k = 0; k < 4; k++) {
          temp[j * 4 + k] -= factor * temp[i * 4 + k];
          result[j * 4 + k] -= factor * result[i * 4 + k];
        }
      }
    }
  }
  return result;
}

function multiplyMatrices(a: number[], b: number[]): number[] {
  const r = new Array(16).fill(0);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++)
      for (let k = 0; k < 4; k++)
        r[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
  return r;
}

function createMockHeader(overrides: Partial<NiftiHeader> = {}): NiftiHeader {
  return {
    sizeof_hdr: 348,
    dim: [3, 64, 64, 64, 1, 1, 1, 1],
    datatype: 2,
    pixdim: [1.0, 1.0, 1.0, 1.0, 0, 0, 0, 0],
    qform_code: 0,
    sform_code: 0,
    quatern_b: 0,
    quatern_c: 0,
    quatern_d: 0,
    qoffset_x: 0,
    qoffset_y: 0,
    qoffset_z: 0,
    sform: identityMatrix(),
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
    ...overrides
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Coordinate System', () => {

  // 5.2: ijkToRas / rasToIjk roundtrip consistency
  describe('IJK↔RAS roundtrip', () => {
    it('should be reversible for identity matrix', () => {
      const affine = identityMatrix();
      const inverse = invertMatrix(affine);
      const original: [number, number, number] = [10, 20, 30];

      const ras = ijkToRas(original, affine);
      const recovered = rasToIjk(ras, inverse);

      expect(recovered[0]).toBeCloseTo(original[0], 5);
      expect(recovered[1]).toBeCloseTo(original[1], 5);
      expect(recovered[2]).toBeCloseTo(original[2], 5);
    });

    it('should be reversible for translation matrix', () => {
      const affine = [1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30, 0, 0, 0, 1];
      const inverse = invertMatrix(affine);
      const original: [number, number, number] = [5, 15, 25];

      const ras = ijkToRas(original, affine);
      const recovered = rasToIjk(ras, inverse);

      expect(recovered[0]).toBeCloseTo(original[0], 4);
      expect(recovered[1]).toBeCloseTo(original[1], 4);
      expect(recovered[2]).toBeCloseTo(original[2], 4);
    });

    it('should be reversible for scale + translation matrix', () => {
      // Scale by 2, translate by 5,10,15
      const affine = [2, 0, 0, 5, 0, 2, 0, 10, 0, 0, 2, 15, 0, 0, 0, 1];
      const inverse = invertMatrix(affine);
      const original: [number, number, number] = [32, 48, 64];

      const ras = ijkToRas(original, affine);
      const recovered = rasToIjk(ras, inverse);

      expect(recovered[0]).toBeCloseTo(original[0], 4);
      expect(recovered[1]).toBeCloseTo(original[1], 4);
      expect(recovered[2]).toBeCloseTo(original[2], 4);
    });

    it('should produce correct RAS coordinates for known affine', () => {
      // DICOM-style: spacing 0.5mm in I, 0.5mm in J, 1.0mm in K, offset at origin
      const affine = [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1];
      const ijk: [number, number, number] = [10, 20, 5];

      const ras = ijkToRas(ijk, affine);

      expect(ras[0]).toBeCloseTo(5.0, 5);  // 10 * 0.5
      expect(ras[1]).toBeCloseTo(10.0, 5); // 20 * 0.5
      expect(ras[2]).toBeCloseTo(5.0, 5);  // 5 * 1.0
    });
  });

  // 5.2: RAS↔LPS roundtrip
  describe('RAS↔LPS roundtrip', () => {
    it('should be perfectly reversible', () => {
      const original: [number, number, number] = [50, -30, 100];
      const lps = rasToLps(original);
      const recovered = lpsToRas(lps);

      expect(recovered[0]).toBeCloseTo(original[0], 10);
      expect(recovered[1]).toBeCloseTo(original[1], 10);
      expect(recovered[2]).toBeCloseTo(original[2], 10);
    });

    it('should negate X and Y axes, keep Z', () => {
      const ras: [number, number, number] = [10, 20, 30];
      const lps = rasToLps(ras);

      expect(lps[0]).toBe(-10);
      expect(lps[1]).toBe(-20);
      expect(lps[2]).toBe(30);
    });
  });

  // 5.2: Actual affine matrix roundtrip
  describe('Real affine roundtrip', () => {
    it('should roundtrip with NIfTI real-world affine', () => {
      // Realistic NIfTI header: 1mm isotropic, RAS orientation, offset at center
      const header = createMockHeader({
        pixdim: [1.0, 1.0, 1.0, 1.0, 0, 0, 0, 0]
      });
      const affine = extractAffineMatrix(header);
      const inverse = invertMatrix(affine);

      // Test several voxel positions
      const voxels: [number, number, number][] = [
        [0, 0, 0], [32, 32, 32], [63, 0, 63], [0, 63, 0]
      ];

      for (const ijk of voxels) {
        const ras = ijkToRas(ijk, affine);
        const recovered = rasToIjk(ras, inverse);
        expect(recovered[0]).toBeCloseTo(ijk[0], 3);
        expect(recovered[1]).toBeCloseTo(ijk[1], 3);
        expect(recovered[2]).toBeCloseTo(ijk[2], 3);
      }
    });

    it('should roundtrip with sform matrix', () => {
      // Sform with translation
      const sform = [1, 0, 0, -30, 0, 1, 0, -40, 0, 0, 1, -50, 0, 0, 0, 1];
      const header = createMockHeader({ sform_code: 1, sform });
      const affine = extractAffineMatrix(header);
      const inverse = invertMatrix(affine);

      const ijk: [number, number, number] = [30, 40, 50];
      const ras = ijkToRas(ijk, affine);
      const recovered = rasToIjk(ras, inverse);

      expect(recovered[0]).toBeCloseTo(ijk[0], 4);
      expect(recovered[1]).toBeCloseTo(ijk[1], 4);
      expect(recovered[2]).toBeCloseTo(ijk[2], 4);
    });
  });

  // 5.2: Negative spacing / mirrored axes
  describe('Negative pixdim / mirrored axes', () => {
    it('should handle negative pixdim values', () => {
      // Mirror J axis (negative pixdim[2])
      const header = createMockHeader({
        pixdim: [1.0, 1.0, -1.0, 1.0, 0, 0, 0, 0]
      });
      const affine = extractAffineMatrix(header);

      // All diagonal elements should be positive (absolute value used)
      expect(affine[0]).toBeCloseTo(1.0, 5);
      expect(affine[5]).toBeCloseTo(1.0, 5);
      expect(affine[10]).toBeCloseTo(1.0, 5);
    });

    it('should handle negative qfac (pixdim[0] < 0)', () => {
      const header = createMockHeader({
        qform_code: 1,
        sform_code: 0,
        quatern_b: 0,
        quatern_c: 0,
        quatern_d: 0,
        qoffset_x: 0,
        qoffset_y: 0,
        qoffset_z: 0,
        pixdim: [-1.0, 2.0, 2.0, 2.0, 0, 0, 0, 0]
      });

      const affine = extractAffineMatrix(header);

      // Should not throw and should produce valid matrix
      expect(affine).toHaveLength(16);
      expect(affine[15]).toBe(1);
      // With identity quaternion, R[6]=0, so affine[8] = 0 (even with qfac=-1)
      // The matrix is still valid
      expect(affine[0]).toBeCloseTo(2.0, 5);
      expect(affine[5]).toBeCloseTo(2.0, 5);
    });

    it('should use absolute values in spacing extraction', () => {
      const header = createMockHeader({
        pixdim: [1.0, -2.5, 3.5, -1.0, 0, 0, 0, 0]
      });

      const report = validateOrientation(header);

      expect(report.spacing[0]).toBeCloseTo(2.5, 5);
      expect(report.spacing[1]).toBeCloseTo(3.5, 5);
      expect(report.spacing[2]).toBeCloseTo(1.0, 5);
    });
  });

  // 5.2: Quaternion normalization boundary
  describe('Quaternion normalization', () => {
    it('should handle quatMagSq > 1 (floating point rounding)', () => {
      // Due to floating point error, b²+c²+d² can slightly exceed 1
      // b=0.577, c=0.577, d=0.577 → magSq ≈ 0.999 + 0.999 + 0.333 = 2.331 > 1
      const header = createMockHeader({
        qform_code: 1,
        sform_code: 0,
        quatern_b: 0.577,
        quatern_c: 0.577,
        quatern_d: 0.577,
        qoffset_x: 0,
        qoffset_y: 0,
        qoffset_z: 0,
        pixdim: [1.0, 1.0, 1.0, 1.0, 0, 0, 0, 0]
      });

      // Should not throw (no NaN from sqrt of negative)
      const affine = extractAffineMatrix(header);

      // All diagonal elements should be finite
      for (let i = 0; i < 16; i++) {
        expect(Number.isFinite(affine[i])).toBe(true);
      }
      expect(affine[15]).toBe(1);
    });

    it('should handle exactly zero quaternion (identity rotation)', () => {
      const header = createMockHeader({
        qform_code: 1,
        sform_code: 0,
        quatern_b: 0,
        quatern_c: 0,
        quatern_d: 0,
        qoffset_x: 0,
        qoffset_y: 0,
        qoffset_z: 0,
        pixdim: [1.0, 1.0, 1.0, 1.0, 0, 0, 0, 0]
      });

      const affine = extractAffineMatrix(header);

      // Identity quaternion → rotation matrix should be close to identity
      expect(affine[0]).toBeCloseTo(1.0, 5);
      expect(affine[5]).toBeCloseTo(1.0, 5);
      expect(affine[10]).toBeCloseTo(1.0, 5);
    });

    it('should handle unit quaternion (perfectly normalized)', () => {
      // 90-degree rotation around Z axis: q = (a=√0.5, b=0, c=0, d=√0.5)
      // Simpler: pure 90° around Z = (a=0.7071, d=0.7071)
      const header = createMockHeader({
        qform_code: 1,
        sform_code: 0,
        quatern_b: 0,
        quatern_c: 0,
        quatern_d: 0.7071067812,
        qoffset_x: 0,
        qoffset_y: 0,
        qoffset_z: 0,
        pixdim: [1.0, 1.0, 1.0, 1.0, 0, 0, 0, 0]
      });

      const affine = extractAffineMatrix(header);

      // Rotation matrix should be finite
      for (let i = 0; i < 16; i++) {
        expect(Number.isFinite(affine[i])).toBe(true);
      }
    });
  });

  // validateOrientation tests
  describe('validateOrientation', () => {
    it('should return axcodes array of length 3', () => {
      const header = createMockHeader();
      const report = validateOrientation(header);

      expect(report.axcodes).toHaveLength(3);
      expect(['R', 'L', 'A', 'P', 'S', 'I']).toContain(report.axcodes[0]);
      expect(['R', 'L', 'A', 'P', 'S', 'I']).toContain(report.axcodes[1]);
      expect(['R', 'L', 'A', 'P', 'S', 'I']).toContain(report.axcodes[2]);
    });

    it('should return non-oblique for cardinal axes', () => {
      const header = createMockHeader();
      const report = validateOrientation(header);

      expect(report.isOblique).toBe(false);
    });

    it('should return oblique for non-cardinal rotation', () => {
      // Create an oblique header with off-diagonal elements
      // The threshold is maxVal/sum < 0.95 to be oblique
      // So we need off-diagonal > 5% of diagonal to trigger
      // Row 0: [1, 0.15, 0] → max=1, sum=1.15 → ratio=0.87 < 0.95 → OBLIQUE
      const sform = [
        1.0, 0.15, 0.0, 0,
        0.15, 1.0, 0.0, 0,
        0.0, 0.0, 1.0, 0,
        0, 0, 0, 1
      ];
      const header = createMockHeader({ sform_code: 1, sform });
      const report = validateOrientation(header);

      expect(report.isOblique).toBe(true);
    });

    it('should extract spacing from header', () => {
      const header = createMockHeader({
        pixdim: [1.0, 0.75, 0.75, 2.5, 0, 0, 0, 0]
      });
      const report = validateOrientation(header);

      expect(report.spacing[0]).toBeCloseTo(0.75, 5);
      expect(report.spacing[1]).toBeCloseTo(0.75, 5);
      expect(report.spacing[2]).toBeCloseTo(2.5, 5);
    });
  });

  // extractAffineMatrix priority tests
  describe('extractAffineMatrix priority', () => {
    it('should prefer sform over qform', () => {
      const sform = [2, 0, 0, 10, 0, 2, 0, 20, 0, 0, 2, 30, 0, 0, 0, 1];
      const header = createMockHeader({
        sform_code: 1,
        sform,
        qform_code: 1
      });

      const affine = extractAffineMatrix(header);

      expect(affine[0]).toBeCloseTo(2.0, 5);
      expect(affine[3]).toBeCloseTo(10.0, 5);
    });

    it('should prefer qform over fallback', () => {
      const header = createMockHeader({
        qform_code: 1,
        sform_code: 0,
        quatern_b: 0,
        quatern_c: 0,
        quatern_d: 0,
        qoffset_x: 5,
        qoffset_y: 6,
        qoffset_z: 7,
        pixdim: [1.0, 1.0, 1.0, 1.0, 0, 0, 0, 0]
      });

      const affine = extractAffineMatrix(header);

      expect(affine[3]).toBeCloseTo(5.0, 5);
      expect(affine[7]).toBeCloseTo(6.0, 5);
      expect(affine[11]).toBeCloseTo(7.0, 5);
    });

    it('should use fallback (pixdim only) when no codes', () => {
      const header = createMockHeader({
        qform_code: 0,
        sform_code: 0,
        pixdim: [1.0, 2.0, 3.0, 4.0, 0, 0, 0, 0]
      });

      const affine = extractAffineMatrix(header);

      // Fallback is identity + pixdim as diagonal
      expect(affine[0]).toBeCloseTo(2.0, 5);
      expect(affine[5]).toBeCloseTo(3.0, 5);
      expect(affine[10]).toBeCloseTo(4.0, 5);
      expect(affine[15]).toBe(1);
    });
  });
});
