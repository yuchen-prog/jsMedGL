// Unit tests for NIfTI-2 header parsing

import { describe, it, expect } from 'vitest';
import { parseNiftiHeader, parseNifti } from '@jsmedgl/parser-nifti';

describe('NIfTI-2 Header Parsing', () => {
  describe('Header validation', () => {
    it('should parse NIfTI-2 header with sizeof_hdr=540', async () => {
      const buffer = createMinimalNifti2Buffer({
        dimensions: [64, 64, 64],
        datatype: 16, // FLOAT32
        pixdim: [1.0, 1.0, 1.0]
      });

      const header = await parseNiftiHeader(buffer);

      expect(header.sizeof_hdr).toBe(540);
      expect(header.dim[0]).toBe(3);
      expect(header.dim[1]).toBe(64);
      expect(header.dim[2]).toBe(64);
      expect(header.dim[3]).toBe(64);
    });

    it('should parse NIfTI-2 dimensions correctly (int64)', async () => {
      const buffer = createMinimalNifti2Buffer({
        dimensions: [256, 256, 128],
        datatype: 4,
        pixdim: [0.5, 0.5, 1.0]
      });

      const header = await parseNiftiHeader(buffer);

      expect(header.dim[1]).toBe(256);
      expect(header.dim[2]).toBe(256);
      expect(header.dim[3]).toBe(128);
    });

    it('should parse NIfTI-2 pixdim correctly (float64)', async () => {
      const buffer = createMinimalNifti2Buffer({
        dimensions: [64, 64, 64],
        datatype: 16,
        pixdim: [0.5, 0.75, 1.25]
      });

      const header = await parseNiftiHeader(buffer);

      expect(header.pixdim[1]).toBeCloseTo(0.5, 6);
      expect(header.pixdim[2]).toBeCloseTo(0.75, 6);
      expect(header.pixdim[3]).toBeCloseTo(1.25, 6);
    });

    it('should parse NIfTI-2 qform parameters', async () => {
      const buffer = createMinimalNifti2Buffer({
        dimensions: [64, 64, 64],
        datatype: 16,
        pixdim: [1.0, 1.0, 1.0],
        qform_code: 1,
        quatern: [0, 0, 0.7071], // 90 degree rotation
        qoffset: [10, 20, 30]
      });

      const header = await parseNiftiHeader(buffer);

      expect(header.qform_code).toBe(1);
      expect(header.quatern_b).toBeCloseTo(0, 4);
      expect(header.quatern_c).toBeCloseTo(0, 4);
      expect(header.quatern_d).toBeCloseTo(0.7071, 4);
      expect(header.qoffset_x).toBeCloseTo(10, 4);
      expect(header.qoffset_y).toBeCloseTo(20, 4);
      expect(header.qoffset_z).toBeCloseTo(30, 4);
    });

    it('should parse NIfTI-2 sform matrix', async () => {
      // NIfTI-2 stores sform as 3 rows of 4 float64 values (12 total)
      const buffer = createMinimalNifti2Buffer({
        dimensions: [64, 64, 64],
        datatype: 16,
        pixdim: [1.0, 1.0, 1.0],
        sform_code: 1,
        sform: [2, 0, 0, 100, 0, 2, 0, 200, 0, 0, 2, 300]
      });

      const header = await parseNiftiHeader(buffer);

      expect(header.sform_code).toBe(1);
      // Check that sform matrix was parsed (first 3 rows)
      expect(header.sform_inv).toHaveLength(16);
      // Last element should be 1 (4th row of identity)
      expect(header.sform_inv[15]).toBe(1);
    });
  });

  describe('Large dimensions support', () => {
    it('should handle dimensions > 32767 (int64 range)', async () => {
      const buffer = createMinimalNifti2Buffer({
        dimensions: [50000, 50000, 100],
        datatype: 2,
        pixdim: [0.1, 0.1, 1.0]
      });

      const header = await parseNiftiHeader(buffer);

      expect(header.dim[1]).toBe(50000);
      expect(header.dim[2]).toBe(50000);
      expect(header.dim[3]).toBe(100);
    });
  });
});

// Helper function to create NIfTI-2 buffer
function createMinimalNifti2Buffer(options: {
  dimensions: [number, number, number];
  datatype: number;
  pixdim: [number, number, number];
  qform_code?: number;
  quatern?: [number, number, number];
  qoffset?: [number, number, number];
  sform_code?: number;
  sform?: number[];
}): ArrayBuffer {
  // NIfTI-2 header is 540 bytes
  const headerSize = 540;
  const buffer = new ArrayBuffer(headerSize + 1024); // Extra space for data
  const view = new DataView(buffer);

  // NIfTI-2 magic and sizeof_hdr
  view.setInt32(0, 0, true); // First 4 bytes: magic (ni2\0)
  view.setInt32(4, 540, true); // sizeof_hdr at offset 4

  // Dimensions (int64, 8 bytes each, starting at offset 8)
  view.setBigInt64(8, BigInt(3), true); // dim[0]
  view.setBigInt64(16, BigInt(options.dimensions[0]), true); // dim[1]
  view.setBigInt64(24, BigInt(options.dimensions[1]), true); // dim[2]
  view.setBigInt64(32, BigInt(options.dimensions[2]), true); // dim[3]
  view.setBigInt64(40, BigInt(1), true); // dim[4]
  view.setBigInt64(48, BigInt(1), true); // dim[5]
  view.setBigInt64(56, BigInt(1), true); // dim[6]
  view.setBigInt64(64, BigInt(1), true); // dim[7]

  // datatype (int16 at offset 72)
  view.setInt16(72, options.datatype, true);

  // pixdim (float64, 8 bytes each, starting at offset 80)
  view.setFloat64(80, 1.0, true); // pixdim[0] (qfac)
  view.setFloat64(88, options.pixdim[0], true); // pixdim[1]
  view.setFloat64(96, options.pixdim[1], true); // pixdim[2]
  view.setFloat64(104, options.pixdim[2], true); // pixdim[3]

  // vox_offset (float64 at offset 144)
  view.setFloat64(144, 540, true);

  // qform_code and sform_code (int16 at offsets 344 and 346)
  view.setInt16(344, options.qform_code || 0, true);
  view.setInt16(346, options.sform_code || 0, true);

  // qform parameters (float64, starting at offset 348)
  if (options.qform_code && options.quatern) {
    view.setFloat64(348, options.quatern[0], true); // quatern_b
    view.setFloat64(356, options.quatern[1], true); // quatern_c
    view.setFloat64(364, options.quatern[2], true); // quatern_d
    if (options.qoffset) {
      view.setFloat64(372, options.qoffset[0], true); // qoffset_x
      view.setFloat64(380, options.qoffset[1], true); // qoffset_y
      view.setFloat64(388, options.qoffset[2], true); // qoffset_z
    }
  }

  // sform matrix (float64, starting at offset 392, 12 values for 3 rows)
  if (options.sform_code && options.sform) {
    for (let i = 0; i < 12; i++) {
      view.setFloat64(392 + i * 8, options.sform[i], true);
    }
  }

  return buffer;
}