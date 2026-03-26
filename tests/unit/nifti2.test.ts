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
      expect(header.sform).toHaveLength(16);
      // Last element should be 1 (4th row of identity)
      expect(header.sform[15]).toBe(1);
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
// Reference: https://brainder.org/2015/04/03/the-nifti-2-file-format/
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
  const bytes = new Uint8Array(buffer);

  // sizeof_hdr at offset 0 (int32) = 540
  view.setInt32(0, 540, true);

  // magic at offset 4-11 (8 bytes): "n+2\0" + padding
  bytes[4] = 0x6e; // 'n'
  bytes[5] = 0x2b; // '+'
  bytes[6] = 0x32; // '2'
  bytes[7] = 0x00; // '\0'
  bytes[8] = 0x0d; // '\r' (part of NIfTI-2 magic signature)
  bytes[9] = 0x0a; // '\n'
  bytes[10] = 0x1a; // 0x1a
  bytes[11] = 0x0a; // '\n'

  // datatype at offset 12 (int16)
  view.setInt16(12, options.datatype, true);

  // Dimensions at offset 16 (int64[8], 8 bytes each)
  view.setBigInt64(16, BigInt(3), true); // dim[0]
  view.setBigInt64(24, BigInt(options.dimensions[0]), true); // dim[1]
  view.setBigInt64(32, BigInt(options.dimensions[1]), true); // dim[2]
  view.setBigInt64(40, BigInt(options.dimensions[2]), true); // dim[3]
  view.setBigInt64(48, BigInt(1), true); // dim[4]
  view.setBigInt64(56, BigInt(1), true); // dim[5]
  view.setBigInt64(64, BigInt(1), true); // dim[6]
  view.setBigInt64(72, BigInt(1), true); // dim[7]

  // pixdim at offset 104 (float64[8], 8 bytes each)
  view.setFloat64(104, 1.0, true); // pixdim[0] (qfac)
  view.setFloat64(112, options.pixdim[0], true); // pixdim[1]
  view.setFloat64(120, options.pixdim[1], true); // pixdim[2]
  view.setFloat64(128, options.pixdim[2], true); // pixdim[3]
  view.setFloat64(136, 1.0, true); // pixdim[4]
  view.setFloat64(144, 1.0, true); // pixdim[5]
  view.setFloat64(152, 1.0, true); // pixdim[6]
  view.setFloat64(160, 1.0, true); // pixdim[7]

  // vox_offset at offset 168 (int64)
  view.setBigInt64(168, BigInt(540), true);

  // qform_code at offset 344 (int32)
  view.setInt32(344, options.qform_code || 0, true);
  // sform_code at offset 348 (int32)
  view.setInt32(348, options.sform_code || 0, true);

  // qform parameters (float64, starting at offset 352)
  if (options.qform_code && options.quatern) {
    view.setFloat64(352, options.quatern[0], true); // quatern_b
    view.setFloat64(360, options.quatern[1], true); // quatern_c
    view.setFloat64(368, options.quatern[2], true); // quatern_d
    if (options.qoffset) {
      view.setFloat64(376, options.qoffset[0], true); // qoffset_x
      view.setFloat64(384, options.qoffset[1], true); // qoffset_y
      view.setFloat64(392, options.qoffset[2], true); // qoffset_z
    }
  }

  // sform matrix (float64, starting at offset 400, 12 values for 3 rows)
  if (options.sform_code && options.sform) {
    for (let i = 0; i < 12; i++) {
      view.setFloat64(400 + i * 8, options.sform[i], true);
    }
  }

  return buffer;
}