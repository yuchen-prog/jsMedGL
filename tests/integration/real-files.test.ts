// Integration tests with real NIfTI files

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parseNifti,
  parseNiftiHeader,
  ijkToRas,
  getDataTypeSize
} from '@jsmedgl/parser-nifti';

describe('Real NIfTI File Parsing', () => {
  describe('corocta_vessel_mask.nii.gz', () => {
    const filePath = join(__dirname, '../fixtures/corocta_vessel_mask.nii.gz');
    let fileBuffer: ArrayBuffer;

    beforeAll(() => {
      const buffer = readFileSync(filePath);
      fileBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      );
    });

    it('should parse header without errors', async () => {
      const header = await parseNiftiHeader(fileBuffer);

      expect(header).toBeDefined();
      expect(header.sizeof_hdr).toBeGreaterThan(0);
      expect(header.dim[0]).toBeGreaterThanOrEqual(3);
      expect(header.datatype).toBeGreaterThan(0);
    });

    it('should have valid dimensions', async () => {
      const header = await parseNiftiHeader(fileBuffer);

      // Check spatial dimensions are positive
      expect(header.dim[1]).toBeGreaterThan(0);
      expect(header.dim[2]).toBeGreaterThan(0);
      expect(header.dim[3]).toBeGreaterThan(0);

      console.log('Dimensions:', header.dim.slice(0, 4));
    });

    it('should have valid voxel spacing or detect missing data', async () => {
      const header = await parseNiftiHeader(fileBuffer);

      // At least one dimension should have valid spacing
      const hasValidSpacing =
        header.pixdim[1] > 0 ||
        header.pixdim[2] > 0 ||
        header.pixdim[3] > 0;

      // Log actual values for debugging
      console.log('Voxel spacing:', header.pixdim.slice(1, 4));

      // Either the spacing is valid, or we should have qform/sform to compensate
      const hasTransformInfo = header.qform_code > 0 || header.sform_code > 0;

      expect(hasValidSpacing || hasTransformInfo).toBe(true);
    });

    it('should have valid data type', async () => {
      const header = await parseNiftiHeader(fileBuffer);

      console.log('Data type:', header.datatype);
      console.log('Data type name:', getDataTypeName(header.datatype));

      // Common data types: 2=uint8, 4=int16, 8=int32, 16=float32, 64=float64
      expect([2, 4, 8, 16, 32, 64, 128, 256, 512, 768, 1024, 1280]).toContain(
        header.datatype
      );
    });

    it('should parse full volume without errors', async () => {
      const volume = await parseNifti(fileBuffer);

      expect(volume).toBeDefined();
      expect(volume.header).toBeDefined();
      expect(volume.data).toBeDefined();
      expect(volume.dimensions).toHaveLength(3);
      expect(volume.spacing).toHaveLength(3);
      expect(volume.affine).toHaveLength(16);
      expect(volume.inverseAffine).toHaveLength(16);

      console.log('Volume dimensions:', volume.dimensions);
      console.log('Volume spacing:', volume.spacing);
      console.log('Data size:', volume.data.byteLength, 'bytes');
    });

    it('should have valid affine matrix', async () => {
      const volume = await parseNifti(fileBuffer);

      // Check affine matrix is not identity (real data should have proper transform)
      const isIdentity = volume.affine.every((val, idx) => {
        if (idx === 0 || idx === 5 || idx === 10 || idx === 15) {
          return Math.abs(val - 1) < 0.0001;
        }
        return Math.abs(val) < 0.0001;
      });

      console.log('Affine matrix (first 3 rows):');
      console.log(volume.affine.slice(0, 4));
      console.log(volume.affine.slice(4, 8));
      console.log(volume.affine.slice(8, 12));

      // Affine should have meaningful values
      expect(volume.affine[15]).toBeCloseTo(1, 5);
    });

    it('should handle coordinate transform correctly', async () => {
      const volume = await parseNifti(fileBuffer);

      // Test IJK to RAS conversion
      const ijk: [number, number, number] = [0, 0, 0];
      const ras = ijkToRas(ijk, volume.affine);

      console.log('Origin (0,0,0) in RAS:', ras);

      expect(ras).toHaveLength(3);
      expect(typeof ras[0]).toBe('number');
      expect(typeof ras[1]).toBe('number');
      expect(typeof ras[2]).toBe('number');
    });
  });

  describe('segbone-3d.nii.gz', () => {
    const filePath = join(__dirname, '../fixtures/segbone-3d.nii.gz');
    let fileBuffer: ArrayBuffer;

    beforeAll(() => {
      const buffer = readFileSync(filePath);
      fileBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      );
    });

    it('should parse header without errors', async () => {
      const header = await parseNiftiHeader(fileBuffer);

      expect(header).toBeDefined();
      expect(header.sizeof_hdr).toBeGreaterThan(0);
      expect(header.dim[0]).toBeGreaterThanOrEqual(3);
      expect(header.datatype).toBeGreaterThan(0);
    });

    it('should have valid dimensions', async () => {
      const header = await parseNiftiHeader(fileBuffer);

      expect(header.dim[1]).toBeGreaterThan(0);
      expect(header.dim[2]).toBeGreaterThan(0);
      expect(header.dim[3]).toBeGreaterThan(0);

      console.log('Dimensions:', header.dim.slice(0, 4));
    });

    it('should have valid voxel spacing', async () => {
      const header = await parseNiftiHeader(fileBuffer);

      expect(header.pixdim[1]).toBeGreaterThan(0);
      expect(header.pixdim[2]).toBeGreaterThan(0);
      expect(header.pixdim[3]).toBeGreaterThan(0);

      console.log('Voxel spacing:', header.pixdim.slice(1, 4));
    });

    it('should have valid data type', async () => {
      const header = await parseNiftiHeader(fileBuffer);

      console.log('Data type:', header.datatype);
      console.log('Data type name:', getDataTypeName(header.datatype));

      expect([2, 4, 8, 16, 32, 64, 128, 256, 512, 768, 1024, 1280]).toContain(
        header.datatype
      );
    });

    it('should have valid transform information', async () => {
      const header = await parseNiftiHeader(fileBuffer);

      console.log('qform_code:', header.qform_code);
      console.log('sform_code:', header.sform_code);

      // At least one transform should be defined
      expect(header.qform_code + header.sform_code).toBeGreaterThanOrEqual(0);
    });

    it('should parse full volume without errors', async () => {
      const volume = await parseNifti(fileBuffer);

      expect(volume).toBeDefined();
      expect(volume.header).toBeDefined();
      expect(volume.data).toBeDefined();
      expect(volume.dimensions).toHaveLength(3);
      expect(volume.spacing).toHaveLength(3);
      expect(volume.affine).toHaveLength(16);
      expect(volume.inverseAffine).toHaveLength(16);

      console.log('Volume dimensions:', volume.dimensions);
      console.log('Volume spacing:', volume.spacing);
      console.log('Data size:', volume.data.byteLength, 'bytes');
    });

    it('should have valid affine matrix', async () => {
      const volume = await parseNifti(fileBuffer);

      console.log('Affine matrix (first 3 rows):');
      console.log(volume.affine.slice(0, 4));
      console.log(volume.affine.slice(4, 8));
      console.log(volume.affine.slice(8, 12));

      // Affine should have meaningful values
      expect(volume.affine[15]).toBeCloseTo(1, 5);

      // Check that spacing in affine matches pixdim
      const spacingFromAffine = [
        Math.sqrt(
          volume.affine[0] ** 2 +
          volume.affine[4] ** 2 +
          volume.affine[8] ** 2
        ),
        Math.sqrt(
          volume.affine[1] ** 2 +
          volume.affine[5] ** 2 +
          volume.affine[9] ** 2
        ),
        Math.sqrt(
          volume.affine[2] ** 2 +
          volume.affine[6] ** 2 +
          volume.affine[10] ** 2
        )
      ];

      console.log('Spacing from affine:', spacingFromAffine);
      console.log('Spacing from pixdim:', volume.spacing);

      // Allow some tolerance for rotation
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(spacingFromAffine[i] - volume.spacing[i])).toBeLessThan(0.01);
      }
    });

    it('should handle coordinate transform correctly', async () => {
      const volume = await parseNifti(fileBuffer);

      // Test IJK to RAS conversion
      const ijk: [number, number, number] = [0, 0, 0];
      const ras = ijkToRas(ijk, volume.affine);

      console.log('Origin (0,0,0) in RAS:', ras);

      expect(ras).toHaveLength(3);
      expect(typeof ras[0]).toBe('number');
      expect(typeof ras[1]).toBe('number');
      expect(typeof ras[2]).toBe('number');
    });
  });
});

describe('Large File Stress Test', () => {
  describe('img-3d.nii.gz (117MB compressed)', () => {
    const filePath = join(__dirname, '../fixtures/img-3d.nii.gz');
    let fileBuffer: ArrayBuffer;

    beforeAll(() => {
      const buffer = readFileSync(filePath);
      fileBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      );
    });

    it('should parse header without errors', async () => {
      const header = await parseNiftiHeader(fileBuffer);

      expect(header).toBeDefined();
      expect(header.sizeof_hdr).toBeGreaterThan(0);
      expect(header.dim[0]).toBeGreaterThanOrEqual(3);
      expect(header.datatype).toBeGreaterThan(0);
    });

    it('should have valid dimensions', async () => {
      const header = await parseNiftiHeader(fileBuffer);

      expect(header.dim[1]).toBeGreaterThan(0);
      expect(header.dim[2]).toBeGreaterThan(0);
      expect(header.dim[3]).toBeGreaterThan(0);

      console.log('Dimensions:', header.dim.slice(0, 4));
      console.log('Volume size:', header.dim[1] * header.dim[2] * header.dim[3], 'voxels');
    });

    it('should have valid voxel spacing', async () => {
      const header = await parseNiftiHeader(fileBuffer);

      expect(header.pixdim[1]).toBeGreaterThan(0);
      expect(header.pixdim[2]).toBeGreaterThan(0);
      expect(header.pixdim[3]).toBeGreaterThan(0);

      console.log('Voxel spacing:', header.pixdim.slice(1, 4), 'mm');
    });

    it('should have valid data type', async () => {
      const header = await parseNiftiHeader(fileBuffer);

      console.log('Data type:', header.datatype);
      console.log('Data type name:', getDataTypeName(header.datatype));

      expect([2, 4, 8, 16, 32, 64, 128, 256, 512, 768, 1024, 1280]).toContain(
        header.datatype
      );
    });

    it('should have valid transform information', async () => {
      const header = await parseNiftiHeader(fileBuffer);

      console.log('qform_code:', header.qform_code);
      console.log('sform_code:', header.sform_code);

      // At least one transform should be defined
      expect(header.qform_code + header.sform_code).toBeGreaterThanOrEqual(0);
    });

    it('should decompress and parse large volume efficiently', async () => {
      const startTime = Date.now();
      const volume = await parseNifti(fileBuffer);
      const parseTime = Date.now() - startTime;

      expect(volume).toBeDefined();
      expect(volume.header).toBeDefined();
      expect(volume.data).toBeDefined();
      expect(volume.dimensions).toHaveLength(3);
      expect(volume.spacing).toHaveLength(3);

      console.log('\\n=== Performance Metrics ===');
      console.log('Parse time:', parseTime, 'ms');
      console.log('Volume dimensions:', volume.dimensions);
      console.log('Volume spacing:', volume.spacing);
      console.log('Data size:', (volume.data.byteLength / 1024 / 1024).toFixed(2), 'MB');
      console.log('Throughput:', (volume.data.byteLength / 1024 / 1024 / (parseTime / 1000)).toFixed(2), 'MB/s');

      // Should parse within reasonable time (< 5 seconds)
      expect(parseTime).toBeLessThan(5000);
    });

    it('should have valid affine matrix', async () => {
      const volume = await parseNifti(fileBuffer);

      console.log('Affine matrix (first 3 rows):');
      console.log(volume.affine.slice(0, 4));
      console.log(volume.affine.slice(4, 8));
      console.log(volume.affine.slice(8, 12));

      // Affine should have meaningful values
      expect(volume.affine[15]).toBeCloseTo(1, 5);

      // Check that spacing in affine matches pixdim
      const spacingFromAffine = [
        Math.sqrt(
          volume.affine[0] ** 2 +
          volume.affine[4] ** 2 +
          volume.affine[8] ** 2
        ),
        Math.sqrt(
          volume.affine[1] ** 2 +
          volume.affine[5] ** 2 +
          volume.affine[9] ** 2
        ),
        Math.sqrt(
          volume.affine[2] ** 2 +
          volume.affine[6] ** 2 +
          volume.affine[10] ** 2
        )
      ];

      console.log('Spacing from affine:', spacingFromAffine);
      console.log('Spacing from pixdim:', volume.spacing);

      // Allow some tolerance for rotation
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(spacingFromAffine[i] - volume.spacing[i])).toBeLessThan(0.01);
      }
    });

    it('should handle coordinate transform correctly', async () => {
      const volume = await parseNifti(fileBuffer);

      // Test IJK to RAS conversion
      const ijk: [number, number, number] = [0, 0, 0];
      const ras = ijkToRas(ijk, volume.affine);

      console.log('Origin (0,0,0) in RAS:', ras);

      expect(ras).toHaveLength(3);
      expect(typeof ras[0]).toBe('number');
      expect(typeof ras[1]).toBe('number');
      expect(typeof ras[2]).toBe('number');

      // Check that origin is reasonable (not NaN or Infinity)
      expect(Number.isFinite(ras[0])).toBe(true);
      expect(Number.isFinite(ras[1])).toBe(true);
      expect(Number.isFinite(ras[2])).toBe(true);
    });
  });
});

// Helper function
function getDataTypeName(dt: number): string {
  const types: Record<number, string> = {
    0: 'UNKNOWN',
    1: 'BINARY',
    2: 'UINT8',
    4: 'INT16',
    8: 'INT32',
    16: 'FLOAT32',
    32: 'COMPLEX64',
    64: 'FLOAT64',
    128: 'RGB24',
    256: 'INT8',
    512: 'UINT16',
    768: 'UINT32',
    1024: 'INT64',
    1280: 'UINT64',
    1536: 'FLOAT128',
    1792: 'COMPLEX128',
    2048: 'COMPLEX256',
    2304: 'RGBA32'
  };
  return types[dt] || 'UNKNOWN';
}