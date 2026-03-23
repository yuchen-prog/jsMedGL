// NIfTI Type Definitions

/**
 * NIfTI data types (NIFTI_TYPE_*)
 */
export enum NiftiDataType {
  UNKNOWN = 0,
  UINT8 = 2,
  INT16 = 4,
  INT32 = 8,
  FLOAT32 = 16,
  FLOAT64 = 64,
  INT8 = 256,
  UINT16 = 512,
  UINT32 = 768,
  INT64 = 1024,
  UINT64 = 1280,
  FLOAT128 = 1536,
  COMPLEX128 = 1792,
  COMPLEX256 = 2048,
  RGB24 = 128,
  RGBA32 = 2304,
}

/**
 * NIfTI transform codes (NIFTI_XFORM_*)
 */
export enum NiftiXform {
  UNKNOWN = 0,
  SCANNER_ANAT = 1,
  ALIGNED_ANAT = 2,
  TALAIRACH = 3,
  MNI_152 = 4,
}

/**
 * NIfTI header structure (common fields for NIfTI-1 and NIfTI-2)
 */
export interface NiftiHeader {
  // Header identification
  sizeof_hdr: number;
  datatype: NiftiDataType;
  dim: [number, number, number, number, number, number, number, number];

  // Voxel dimensions
  pixdim: [number, number, number, number, number, number, number, number];

  // Transform information
  qform_code: NiftiXform;
  sform_code: NiftiXform;

  // Quaternion transform parameters
  quatern_b: number;
  quatern_c: number;
  quatern_d: number;
  qoffset_x: number;
  qoffset_y: number;
  qoffset_z: number;

  // Sform matrix (4x4 affine)
  sform_inv: number[];
  sform_code_flag: number;

  // Description and auxiliary files
  descrip: string;
  aux_file: string;

  // Additional fields
  intent_code: number;
  intent_name: string;
  intent_p1: number;
  intent_p2: number;
  intent_p3: number;
  slice_start: number;
  slice_end: number;
  slice_code: number;
  xyzt_units: number;
  cal_max: number;
  cal_min: number;
  slice_duration: number;
  toffset: number;
  vox_offset: number;
}

/**
 * Parsed NIfTI volume data
 */
export interface NiftiVolume {
  // Header information
  header: NiftiHeader;

  // Raw image data
  data: ArrayBuffer;

  // Convenience properties
  dimensions: [number, number, number];
  spacing: [number, number, number];
  affine: number[];
  inverseAffine: number[];
}

/**
 * Coordinate system report
 */
export interface OrientationReport {
  axcodes: ['R' | 'L' | 'A' | 'P' | 'S' | 'I', 'R' | 'L' | 'A' | 'P' | 'S' | 'I', 'R' | 'L' | 'A' | 'P' | 'S' | 'I'];
  isOblique: boolean;
  spacing: [number, number, number];
  affine: number[];
}

/**
 * Parser options
 */
export interface NiftiParserOptions {
  strictMode?: boolean;
  loadImageData?: boolean;
}
