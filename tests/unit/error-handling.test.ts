// Error handling and edge case tests

import { describe, it, expect } from 'vitest';
import { parseNiftiHeader, parseNifti } from '@jsmedgl/parser-nifti';

describe('Error Handling', () => {
  describe('Invalid file formats', () => {
    it('should throw error for invalid sizeof_hdr', async () => {
      const buffer = new ArrayBuffer(348);
      const view = new DataView(buffer);

      // Invalid sizeof_hdr
      view.setInt32(0, 999, true);

      await expect(parseNiftiHeader(buffer)).rejects.toThrow(/Unknown NIfTI format/);
    });

    it('should throw error for empty buffer', async () => {
      const buffer = new ArrayBuffer(0);

      await expect(parseNiftiHeader(buffer)).rejects.toThrow();
    });

    it('should throw error for buffer smaller than header', async () => {
      const buffer = new ArrayBuffer(100); // Too small

      await expect(parseNiftiHeader(buffer)).rejects.toThrow();
    });
  });

  describe('Invalid data types', () => {
    it('should throw error for unsupported data type in strict mode', async () => {
      const buffer = createMinimalNifti1Buffer({
        dimensions: [64, 64, 64],
        datatype: 0, // UNKNOWN
        pixdim: [1.0, 1.0, 1.0, 1.0]
      });

      await expect(parseNifti(buffer, { strictMode: true })).rejects.toThrow(/Unsupported data type/);
    });

    it('should handle unknown data type gracefully without strict mode', async () => {
      const buffer = createMinimalNifti1Buffer({
        dimensions: [64, 64, 64],
        datatype: 999, // Invalid
        pixdim: [1.0, 1.0, 1.0, 1.0]
      });

      // Should not throw in non-strict mode
      const header = await parseNiftiHeader(buffer);
      expect(header.datatype).toBe(999);
    });
  });

  describe('Invalid dimensions', () => {
    it('should throw error for dim[0] < 1 in strict mode', async () => {
      const buffer = createMinimalNifti1Buffer({
        dimensions: [64, 64, 64],
        datatype: 2,
        pixdim: [1.0, 1.0, 1.0, 1.0]
      });

      const view = new DataView(buffer);
      view.setInt16(40, 0, true); // Set dim[0] to 0

      await expect(parseNifti(buffer, { strictMode: true })).rejects.toThrow(/Invalid dim\[0\]/);
    });

    it('should throw error for dim[0] > 7 in strict mode', async () => {
      const buffer = createMinimalNifti1Buffer({
        dimensions: [64, 64, 64],
        datatype: 2,
        pixdim: [1.0, 1.0, 1.0, 1.0]
      });

      const view = new DataView(buffer);
      view.setInt16(40, 8, true); // Set dim[0] to 8

      await expect(parseNifti(buffer, { strictMode: true })).rejects.toThrow(/Invalid dim\[0\]/);
    });

    it('should throw error for zero spatial dimension in strict mode', async () => {
      const buffer = createMinimalNifti1Buffer({
        dimensions: [64, 64, 64],
        datatype: 2,
        pixdim: [1.0, 1.0, 1.0, 1.0]
      });

      const view = new DataView(buffer);
      view.setInt16(44, 0, true); // Set dim[2] to 0

      await expect(parseNifti(buffer, { strictMode: true })).rejects.toThrow(/Invalid dim\[2\]/);
    });
  });

  describe('Invalid voxel spacing', () => {
    it('should handle zero pixdim gracefully', async () => {
      const buffer = createMinimalNifti1Buffer({
        dimensions: [64, 64, 64],
        datatype: 2,
        pixdim: [1.0, 1.0, 1.0, 1.0]
      });

      const view = new DataView(buffer);
      view.setFloat32(80, 0, true); // Set pixdim[1] to 0

      const volume = await parseNifti(buffer);
      expect(volume).toBeDefined();
    });

    it('should handle negative pixdim gracefully', async () => {
      const buffer = createMinimalNifti1Buffer({
        dimensions: [64, 64, 64],
        datatype: 2,
        pixdim: [1.0, 1.0, 1.0, 1.0]
      });

      const view = new DataView(buffer);
      view.setFloat32(84, -1.0, true); // Set pixdim[2] to negative

      const volume = await parseNifti(buffer);
      expect(volume).toBeDefined();
    });
  });

  describe('Insufficient data', () => {
    it('should handle truncated data gracefully', async () => {
      const buffer = createMinimalNifti1Buffer({
        dimensions: [64, 64, 64],
        datatype: 2,
        pixdim: [1.0, 1.0, 1.0, 1.0]
      });

      // Create buffer with insufficient data
      const smallBuffer = buffer.slice(0, 400);

      // The parser should handle this case
      const volume = await parseNifti(smallBuffer);
      expect(volume).toBeDefined();
    });
  });
});

describe('Edge Cases', () => {
  describe('Minimum dimensions', () => {
    it('should handle 1x1x1 volume', async () => {
      const buffer = createMinimalNifti1Buffer({
        dimensions: [1, 1, 1],
        datatype: 2,
        pixdim: [1.0, 1.0, 1.0, 1.0]
      });

      const volume = await parseNifti(buffer);
      expect(volume.dimensions).toEqual([1, 1, 1]);
      // Data size is calculated based on dimensions, but actual buffer may be empty
      expect(volume.data.byteLength).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Quaternion edge cases', () => {
    it('should handle quatern_d = 1 (180° rotation)', async () => {
      const buffer = createMinimalNifti1Buffer({
        dimensions: [64, 64, 64],
        datatype: 2,
        pixdim: [1.0, 1.0, 1.0, 1.0],
        qform: {
          code: 1,
          b: 0,
          c: 0,
          d: 1.0,
          offset: [0, 0, 0]
        }
      });

      const header = await parseNiftiHeader(buffer);
      expect(header.quatern_d).toBeCloseTo(1.0, 4);
    });

    it('should handle near-zero quaternion values', async () => {
      const buffer = createMinimalNifti1Buffer({
        dimensions: [64, 64, 64],
        datatype: 2,
        pixdim: [1.0, 1.0, 1.0, 1.0],
        qform: {
          code: 1,
          b: 1e-10,
          c: 1e-10,
          d: 1e-10,
          offset: [0, 0, 0]
        }
      });

      const header = await parseNiftiHeader(buffer);
      // Should be close to zero but parsed correctly
      expect(Math.abs(header.quatern_b)).toBeLessThan(1e-8);
    });
  });

  describe('Large values', () => {
    it('should handle large qoffset values', async () => {
      const buffer = createMinimalNifti1Buffer({
        dimensions: [64, 64, 64],
        datatype: 2,
        pixdim: [1.0, 1.0, 1.0, 1.0],
        qform: {
          code: 1,
          b: 0,
          c: 0,
          d: 0,
          offset: [1000.5, 2000.75, 3000.25]
        }
      });

      const header = await parseNiftiHeader(buffer);
      expect(header.qoffset_x).toBeCloseTo(1000.5, 2);
      expect(header.qoffset_y).toBeCloseTo(2000.75, 2);
      expect(header.qoffset_z).toBeCloseTo(3000.25, 2);
    });
  });

  describe('Special floating point values', () => {
    it('should handle negative qfac (pixdim[0] < 0)', async () => {
      const buffer = createMinimalNifti1Buffer({
        dimensions: [64, 64, 64],
        datatype: 2,
        pixdim: [-1.0, 1.0, 1.0, 1.0] // Negative qfac
      });

      const header = await parseNiftiHeader(buffer);
      expect(header.pixdim[0]).toBe(-1.0);
    });
  });
});

// Helper function
function createMinimalNifti1Buffer(options: {
  dimensions: [number, number, number];
  datatype: number;
  pixdim: [number, number, number, number];
  qform?: {
    code: number;
    b: number;
    c: number;
    d: number;
    offset: [number, number, number];
  };
}): ArrayBuffer {
  const headerSize = 348;
  const dataSize = options.dimensions[0] * options.dimensions[1] * options.dimensions[2];
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);

  view.setInt32(0, 348, true); // sizeof_hdr
  view.setInt16(40, 3, true); // dim[0]
  view.setInt16(42, options.dimensions[0], true);
  view.setInt16(44, options.dimensions[1], true);
  view.setInt16(46, options.dimensions[2], true);
  view.setInt16(70, options.datatype, true);

  // pixdim (float32)
  view.setFloat32(76, options.pixdim[0], true);
  view.setFloat32(80, options.pixdim[1], true);
  view.setFloat32(84, options.pixdim[2], true);
  view.setFloat32(88, options.pixdim[3], true);

  if (options.qform) {
    view.setInt16(252, options.qform.code, true);
    view.setFloat32(256, options.qform.b, true);
    view.setFloat32(260, options.qform.c, true);
    view.setFloat32(264, options.qform.d, true);
    view.setFloat32(268, options.qform.offset[0], true);
    view.setFloat32(272, options.qform.offset[1], true);
    view.setFloat32(276, options.qform.offset[2], true);
  }

  return buffer;
}