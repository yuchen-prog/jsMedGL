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
    sform: parseSformMatrix(view, offset + 280),
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
 * Reference: https://brainder.org/2015/04/03/the-nifti-2-file-format/
 *
 * NIfTI-2 Header Layout (540 bytes total):
 * | Offset | Type        | Name           | Size |
 * |--------|-------------|----------------|------|
 * | 0      | int32       | sizeof_hdr     | 4    |
 * | 4      | char[8]     | magic          | 8    |
 * | 12     | int16       | datatype       | 2    |
 * | 14     | int16       | bitpix         | 2    |
 * | 16     | int64[8]    | dim            | 64   |
 * | 80     | float64     | intent_p1      | 8    |
 * | 88     | float64     | intent_p2      | 8    |
 * | 96     | float64     | intent_p3      | 8    |
 * | 104    | float64[8]  | pixdim         | 64   |
 * | 168    | int64       | vox_offset     | 8    |
 * | 176    | float64     | scl_slope      | 8    |
 * | 184    | float64     | scl_inter      | 8    |
 * | 192    | float64     | cal_max        | 8    |
 * | 200    | float64     | cal_min        | 8    |
 * | 208    | float64     | slice_duration | 8    |
 * | 216    | float64     | toffset        | 8    |
 * | 224    | int64       | slice_start    | 8    |
 * | 232    | int64       | slice_end      | 8    |
 * | 240    | char[80]    | descrip        | 80   |
 * | 320    | char[24]    | aux_file       | 24   |
 * | 344    | int32       | qform_code     | 4    |
 * | 348    | int32       | sform_code     | 4    |
 * | 352    | float64     | quatern_b      | 8    |
 * | 360    | float64     | quatern_c      | 8    |
 * | 368    | float64     | quatern_d      | 8    |
 * | 376    | float64     | qoffset_x      | 8    |
 * | 384    | float64     | qoffset_y      | 8    |
 * | 392    | float64     | qoffset_z      | 8    |
 * | 400    | float64[4]  | srow_x         | 32   |
 * | 432    | float64[4]  | srow_y         | 32   |
 * | 464    | float64[4]  | srow_z         | 32   |
 * | 496    | int32       | slice_code     | 4    |
 * | 500    | int32       | xyzt_units     | 4    |
 * | 504    | int32       | intent_code    | 4    |
 * | 508    | char[16]    | intent_name    | 16   |
 */
export function parseNifti2Header(buffer: ArrayBuffer): NiftiHeader {
  const view = new DataView(buffer);
  const offset = 0;

  return {
    sizeof_hdr: view.getInt32(offset, true),
    dim: [
      readInt64(view, offset + 16),   // dim[0]
      readInt64(view, offset + 24),   // dim[1]
      readInt64(view, offset + 32),   // dim[2]
      readInt64(view, offset + 40),   // dim[3]
      readInt64(view, offset + 48),   // dim[4]
      readInt64(view, offset + 56),   // dim[5]
      readInt64(view, offset + 64),   // dim[6]
      readInt64(view, offset + 72)    // dim[7]
    ],
    datatype: view.getInt16(offset + 12, true) as NiftiDataType,
    pixdim: [
      view.getFloat64(offset + 104, true),  // pixdim[0] (qfac)
      view.getFloat64(offset + 112, true),  // pixdim[1]
      view.getFloat64(offset + 120, true),  // pixdim[2]
      view.getFloat64(offset + 128, true),  // pixdim[3]
      view.getFloat64(offset + 136, true),  // pixdim[4]
      view.getFloat64(offset + 144, true),  // pixdim[5]
      view.getFloat64(offset + 152, true),  // pixdim[6]
      view.getFloat64(offset + 160, true)   // pixdim[7]
    ],
    vox_offset: readInt64(view, offset + 168),
    intent_p1: view.getFloat64(offset + 80, true),
    intent_p2: view.getFloat64(offset + 88, true),
    intent_p3: view.getFloat64(offset + 96, true),
    slice_start: readInt64(view, offset + 224),
    slice_end: readInt64(view, offset + 232),
    slice_code: view.getInt32(offset + 496, true),
    xyzt_units: view.getInt32(offset + 500, true),
    cal_max: view.getFloat64(offset + 192, true),
    cal_min: view.getFloat64(offset + 200, true),
    slice_duration: view.getFloat64(offset + 208, true),
    toffset: view.getFloat64(offset + 216, true),
    descrip: readCString(buffer, offset + 240, 80),
    aux_file: readCString(buffer, offset + 320, 24),
    qform_code: view.getInt32(offset + 344, true) as NiftiXform,
    sform_code: view.getInt32(offset + 348, true) as NiftiXform,
    quatern_b: view.getFloat64(offset + 352, true),
    quatern_c: view.getFloat64(offset + 360, true),
    quatern_d: view.getFloat64(offset + 368, true),
    qoffset_x: view.getFloat64(offset + 376, true),
    qoffset_y: view.getFloat64(offset + 384, true),
    qoffset_z: view.getFloat64(offset + 392, true),
    sform: parseSformMatrix64(view, offset + 400),
    sform_code_flag: 0, // Not used in NIfTI-2
    intent_code: view.getInt32(offset + 504, true),
    intent_name: readCString(buffer, offset + 508, 16)
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

/**
 * Parse sform matrix (4x4 affine) from NIfTI-2 header
 * NIfTI-2 uses float64 instead of float32 for sform values
 */
function parseSformMatrix64(view: DataView, offset: number): number[] {
  const matrix = new Array(16).fill(0);

  // Check if we have enough bytes to read 3 rows (12 * 8 bytes = 96 bytes)
  const maxOffset = offset + 96;
  if (view.byteLength < maxOffset) {
    // Return identity matrix if not enough data
    matrix[0] = 1;
    matrix[5] = 1;
    matrix[10] = 1;
    matrix[15] = 1;
    return matrix;
  }

  // Read first 3 rows (12 float64 values, 8 bytes each)
  for (let i = 0; i < 12; i++) {
    matrix[i] = view.getFloat64(offset + i * 8, true);
  }

  // Set the 4th row to [0, 0, 0, 1] (standard for affine matrices)
  matrix[15] = 1;

  return matrix;
}
