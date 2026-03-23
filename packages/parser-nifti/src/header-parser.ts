// NIfTI header parser

import type { NiftiHeader, NiftiDataType, NiftiXform } from './types';
import { readCString } from './utils';

/**
 * Parse NIfTI-1 header
 * Reference: nifti1.h - all float fields are float32 (not float64)
 */
export function parseNifti1Header(buffer: ArrayBuffer): NiftiHeader {
  const view = new DataView(buffer);
  const offset = 0;

  return {
    sizeof_hdr: view.getInt32(offset, true),
    dim: [
      view.getInt16(offset + 40, true),
      view.getInt16(offset + 42, true),
      view.getInt16(offset + 44, true),
      view.getInt16(offset + 46, true),
      view.getInt16(offset + 48, true),
      view.getInt16(offset + 50, true),
      view.getInt16(offset + 52, true),
      view.getInt16(offset + 54, true)
    ],
    datatype: view.getInt16(offset + 70, true) as NiftiDataType,
    pixdim: [
      view.getFloat32(offset + 76, true),
      view.getFloat32(offset + 80, true),
      view.getFloat32(offset + 84, true),
      view.getFloat32(offset + 88, true),
      view.getFloat32(offset + 92, true),
      view.getFloat32(offset + 96, true),
      view.getFloat32(offset + 100, true),
      view.getFloat32(offset + 104, true)
    ],
    vox_offset: view.getFloat32(offset + 108, true),
    qform_code: view.getInt16(offset + 252, true) as NiftiXform,
    sform_code: view.getInt16(offset + 254, true) as NiftiXform,
    quatern_b: view.getFloat32(offset + 256, true),
    quatern_c: view.getFloat32(offset + 260, true),
    quatern_d: view.getFloat32(offset + 264, true),
    qoffset_x: view.getFloat32(offset + 268, true),
    qoffset_y: view.getFloat32(offset + 272, true),
    qoffset_z: view.getFloat32(offset + 276, true),
    sform_inv: parseSformMatrix(view, offset + 280),
    sform_code_flag: view.getUint8(offset + 344),
    descrip: readCString(buffer, offset + 148, 80),
    aux_file: readCString(buffer, offset + 228, 24),
    intent_code: view.getInt16(offset + 68, true),
    intent_name: "",
    intent_p1: view.getFloat32(offset + 56, true),
    intent_p2: view.getFloat32(offset + 60, true),
    intent_p3: view.getFloat32(offset + 64, true),
    slice_start: view.getInt16(offset + 74, true),
    slice_end: view.getInt16(offset + 120, true),
    slice_code: view.getUint8(offset + 122),
    xyzt_units: view.getUint8(offset + 123),
    cal_max: view.getFloat32(offset + 124, true),
    cal_min: view.getFloat32(offset + 128, true),
    slice_duration: view.getFloat32(offset + 132, true),
    toffset: view.getFloat32(offset + 136, true)
  };
}

/**
 * Parse NIfTI-2 header
 */
export function parseNifti2Header(buffer: ArrayBuffer): NiftiHeader {
  const view = new DataView(buffer);
  const offset = 0;

  return {
    sizeof_hdr: view.getInt32(offset + 4, true),
    dim: [
      readInt64(view, offset + 8),
      readInt64(view, offset + 16),
      readInt64(view, offset + 24),
      readInt64(view, offset + 32),
      readInt64(view, offset + 40),
      readInt64(view, offset + 48),
      readInt64(view, offset + 56),
      readInt64(view, offset + 64)
    ],
    datatype: view.getInt16(offset + 72, true) as NiftiDataType,
    pixdim: [
      view.getFloat64(offset + 80, true),
      view.getFloat64(offset + 88, true),
      view.getFloat64(offset + 96, true),
      view.getFloat64(offset + 104, true),
      view.getFloat64(offset + 112, true),
      view.getFloat64(offset + 120, true),
      view.getFloat64(offset + 128, true),
      view.getFloat64(offset + 136, true)
    ],
    vox_offset: view.getFloat64(offset + 144, true),
    qform_code: view.getInt16(offset + 344, true) as NiftiXform,
    sform_code: view.getInt16(offset + 346, true) as NiftiXform,
    quatern_b: view.getFloat64(offset + 348, true),
    quatern_c: view.getFloat64(offset + 356, true),
    quatern_d: view.getFloat64(offset + 364, true),
    qoffset_x: view.getFloat64(offset + 372, true),
    qoffset_y: view.getFloat64(offset + 380, true),
    qoffset_z: view.getFloat64(offset + 388, true),
    sform_inv: parseSformMatrix(view, offset + 392),
    sform_code_flag: view.getUint8(offset + 432),
    descrip: readCString(buffer, offset + 232, 80),
    aux_file: readCString(buffer, offset + 240, 24),
    intent_code: view.getInt16(offset + 74, true),
    intent_name: readCString(buffer, offset + 440, 16),
    intent_p1: view.getFloat64(offset + 152, true),
    intent_p2: view.getFloat64(offset + 160, true),
    intent_p3: view.getFloat64(offset + 168, true),
    slice_start: readInt64(view, offset + 32),
    slice_end: readInt64(view, offset + 40),
    slice_code: view.getUint8(offset + 122),
    xyzt_units: view.getUint8(offset + 123),
    cal_max: view.getFloat64(offset + 184, true),
    cal_min: view.getFloat64(offset + 192, true),
    slice_duration: view.getFloat64(offset + 200, true),
    toffset: view.getFloat64(offset + 208, true)
  };
}

/**
 * Read 64-bit integer (not natively supported by DataView)
 */
function readInt64(view: DataView, offset: number): number {
  const low = view.getInt32(offset, true);
  const high = view.getInt32(offset + 4, true);
  return high * 0x100000000 + low;
}

/**
 * Parse sform matrix (4x4 affine) from header
 * Note: NIfTI-1 only stores first 3 rows (srow_x, srow_y, srow_z)
 * The 4th row is always [0, 0, 0, 1]
 */
function parseSformMatrix(view: DataView, offset: number): number[] {
  const matrix = new Array(16).fill(0);

  // Check if we have enough bytes to read 3 rows (12 * 4 bytes = 48 bytes)
  const maxOffset = offset + 48;
  if (view.byteLength < maxOffset) {
    // Return identity matrix if not enough data
    matrix[0] = 1;
    matrix[5] = 1;
    matrix[10] = 1;
    matrix[15] = 1;
    return matrix;
  }

  // Read first 3 rows (12 float32 values, 4 bytes each)
  for (let i = 0; i < 12; i++) {
    matrix[i] = view.getFloat32(offset + i * 4, true);
  }

  // Set the 4th row to [0, 0, 0, 1] (standard for affine matrices)
  matrix[15] = 1;

  return matrix;
}
