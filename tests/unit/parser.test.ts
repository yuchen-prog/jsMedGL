// Unit tests for NIfTI parser

import { describe, it, expect } from 'vitest';
import { parseNifti, parseNiftiHeader, validateOrientation } from '@jsmedgl/parser-nifti';
import type { NiftiHeader } from '@jsmedgl/parser-nifti';

describe('NIfTI Parser', () => {
  describe('Header Parsing', () => {
    it('should create minimal valid NIfTI-1 header', () => {
      const buffer = createMinimalNifti1Buffer({
        dimensions: [64, 64, 64],
        datatype: 2,
        pixdim: [1.0, 1.0, 1.0, 1.0]
      });

      const view = new DataView(buffer);
      expect(view.getInt32(0, true)).toBe(348);
    });

    it('should parse basic header fields', async () => {
      const buffer = createMinimalNifti1Buffer({
        dimensions: [64, 64, 64],
        datatype: 2,
        pixdim: [1.0, 1.0, 1.0, 1.0]
      });

      const header = await parseNiftiHeader(buffer);

      expect(header.dim[0]).toBe(3);
      expect(header.dim[1]).toBe(64);
      expect(header.dim[2]).toBe(64);
      expect(header.dim[3]).toBe(64);
      expect(header.datatype).toBe(2);
    });
  });

  describe('Coordinate System', () => {
    it('should validate orientation with default sform/qform', () => {
      const header = createMockHeader({
        pixdim: [1.0, 1.0, 1.0, 1.0, 0, 0, 0, 0]
      });

      const report = validateOrientation(header);

      expect(report).toBeDefined();
      expect(report.spacing).toEqual([1.0, 1.0, 1.0]);
      expect(report.axcodes).toHaveLength(3);
    });

    it('should detect isotropic voxel spacing', () => {
      const header = createMockHeader({
        pixdim: [1.0, 1.0, 1.0, 1.0, 0, 0, 0, 0]
      });

      const report = validateOrientation(header);

      expect(report.spacing[0]).toBe(report.spacing[1]);
      expect(report.spacing[1]).toBe(report.spacing[2]);
    });

    it('should detect anisotropic voxel spacing', () => {
      const header = createMockHeader({
        pixdim: [1.0, 1.0, 1.0, 2.0, 0, 0, 0, 0]
      });

      const report = validateOrientation(header);

      expect(report.spacing).toEqual([1.0, 1.0, 2.0]);
    });
  });

  describe('Transform Matrices', () => {
    it('should use sform when sform_code > 0', () => {
      const header = createMockHeader({
        sform_code: 1,
        sform: createIdentityMatrix()
      });

      const report = validateOrientation(header);

      expect(report.affine).toBeDefined();
      expect(report.affine.length).toBe(16);
    });

    it('should use qform when qform_code > 0 and sform_code = 0', () => {
      const header = createMockHeader({
        qform_code: 1,
        sform_code: 0,
        quatern_b: 0,
        quatern_c: 0,
        quatern_d: 0,
        qoffset_x: 0,
        qoffset_y: 0,
        qoffset_z: 0
      });

      const report = validateOrientation(header);

      expect(report.affine).toBeDefined();
    });
  });
});

// Helper functions

function createMinimalNifti1Buffer(options: {
  dimensions: [number, number, number];
  datatype: number;
  pixdim: [number, number, number, number];
}): ArrayBuffer {
  // NIfTI-1 header is 348 bytes, but we need extra space for magic field at 344-347
  const headerSize = 368; // 348 + 20 for safety margin
  const buffer = new ArrayBuffer(headerSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  view.setInt32(0, 348, true); // sizeof_hdr
  view.setInt16(40, 3, true); // dim[0]
  view.setInt16(42, options.dimensions[0], true); // dim[1]
  view.setInt16(44, options.dimensions[1], true); // dim[2]
  view.setInt16(46, options.dimensions[2], true); // dim[3]
  view.setInt16(70, options.datatype, true); // datatype
  view.setFloat32(76, options.pixdim[0], true); // pixdim[0]
  view.setFloat32(80, options.pixdim[1], true); // pixdim[1]
  view.setFloat32(84, options.pixdim[2], true); // pixdim[2]
  view.setFloat32(88, options.pixdim[3], true); // pixdim[3]
  view.setInt16(252, 0, true); // qform_code
  view.setInt16(254, 0, true); // sform_code

  // NIfTI-1 magic field at offset 344-347: "n+1\0" (single .nii file)
  bytes[344] = 0x6e; // 'n'
  bytes[345] = 0x2b; // '+'
  bytes[346] = 0x31; // '1'
  bytes[347] = 0x00; // '\0'

  return buffer;
}

function createMockHeader(options: Partial<NiftiHeader> = {}): NiftiHeader {
  return {
    sizeof_hdr: 348,
    dim: [3, 64, 64, 64, 1, 1, 1, 1],
    datatype: 2,
    pixdim: options.pixdim || [1.0, 1.0, 1.0, 1.0, 0, 0, 0, 0],
    qform_code: options.qform_code || 0,
    sform_code: options.sform_code || 0,
    quatern_b: options.quatern_b || 0,
    quatern_c: options.quatern_c || 0,
    quatern_d: options.quatern_d || 0,
    qoffset_x: options.qoffset_x || 0,
    qoffset_y: options.qoffset_y || 0,
    qoffset_z: options.qoffset_z || 0,
    sform: options.sform || createIdentityMatrix(),
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
    vox_offset: 0
  };
}

function createIdentityMatrix(): number[] {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ];
}
