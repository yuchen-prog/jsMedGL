// DICOM Types for jsMedgl

// ============================================================
// DICOM Tag
// ============================================================

/**
 * DICOM Tag identifier (group, element)
 */
export interface DicomTag {
  group: number;
  element: number;
}

/**
 * Format a DICOM tag as a hex string (e.g., "0028,0010")
 */
export function tagToString(tag: DicomTag): string {
  return `${tag.group.toString(16).toUpperCase().padStart(4, '0')},${tag.element.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * Parse a tag string like "0028,0010" into a DicomTag
 */
export function parseTagString(str: string): DicomTag {
  const [group, element] = str.split(',');
  return {
    group: parseInt(group, 16),
    element: parseInt(element, 16),
  };
}

// ============================================================
// Transfer Syntax UIDs
// ============================================================

/**
 * Transfer Syntax UIDs — MVP 支持的列表
 * Reference: DICOM Part 5 Section 8
 */
export const TRANSFER_SYNTAX = {
  /** Implicit VR Little Endian — 最常见的 CT/MRI 格式 */
  IMPLICIT_VR_LE: '1.2.840.10008.1.2',
  /** Explicit VR Little Endian */
  EXPLICIT_VR_LE: '1.2.840.10008.1.2.1',
  /** Explicit VR Big Endian (retired, rare) */
  EXPLICIT_VR_BE: '1.2.840.10008.1.2.2',
  /** Deflate (zlib) compression */
  DEFLATE: '1.2.840.10008.1.2.5',
  /** JPEG Baseline (8-bit only) */
  JPEG_BASELINE: '1.2.840.10008.1.2.4.50',
  /** JPEG Lossless (process 14) */
  JPEG_LOSSLESS: '1.2.840.10008.1.2.4.70',
  /** JPEG 2000 Lossless */
  JPEG2000_LOSSLESS: '1.2.840.10008.1.2.4.90',
  /** JPEG 2000 Lossy */
  JPEG2000_LOSSY: '1.2.840.10008.1.2.4.91',
} as const;

export type TransferSyntaxUID = (typeof TRANSFER_SYNTAX)[keyof typeof TRANSFER_SYNTAX];

// ============================================================
// DICOM Element
// ============================================================

/**
 * DICOM Data Element
 */
export interface DicomElement {
  tag: DicomTag;
  vr: string; // Value Representation (2 chars)
  length: number;
  value: unknown;
}

// ============================================================
// DICOM Header (rendering-relevant fields)
// ============================================================

/**
 * Core DICOM header information needed for rendering and coordinate transforms.
 * Derived from standard DICOM tags during parsing.
 */
export interface DicomHeader {
  // Image dimensions
  rows: number;
  columns: number;

  // Data format
  bitsAllocated: number;
  bitsStored: number;
  highBit: number;
  pixelRepresentation: number; // 0=unsigned, 1=signed

  // HU (Hounsfield Unit) conversion
  rescaleSlope: number;
  rescaleIntercept: number;

  // Preset window/level from DICOM
  windowCenter: number;
  windowWidth: number;

  // Spatial orientation — these define the LPS coordinate system
  imagePositionPatient: [number, number, number]; // IPP (0020,0032)
  imageOrientationPatient: [number, number, number, number, number, number]; // IOP (0020,0037)
  pixelSpacing: [number, number]; // (0028,0030)
  sliceThickness: number; // (0018,0050)

  // Metadata
  modality: string;
  studyDate: string;
  patientName: string;
  seriesDescription: string;
  seriesInstanceUid: string;
  sopInstanceUid: string;
  studyInstanceUid: string;
  seriesNumber: number;
  instanceNumber: number;
  sliceLocation: number;

  // Transfer syntax
  transferSyntaxUid: string;

  /**
   * Mapped NIfTI datatype code for renderer compatibility.
   * See datatype mapping table in the plan doc.
   */
  datatype: number;
}

// ============================================================
// DICOM Volume (output type — compatible with NiftiVolume)
// ============================================================

/**
 * Parsed DICOM volume — structure is compatible with NiftiVolume
 * so renderer-2d and renderer-3d can render it without modification.
 */
export interface DicomVolume {
  header: DicomHeader;
  /** Raw voxel data as ArrayBuffer (normalized by rescale) */
  data: ArrayBuffer;
  /** [columns, rows, slices] */
  dimensions: [number, number, number];
  /** [x_spacing, y_spacing, z_spacing] in mm */
  spacing: [number, number, number];
  /** 4x4 IJK → RAS affine transform */
  affine: number[];
  /** 4x4 RAS → IJK inverse affine */
  inverseAffine: number[];
  /** Parse warnings (e.g. unsupported transfer syntax) */
  warnings?: string[];
}

// ============================================================
// Parser Options
// ============================================================

export interface DicomParserOptions {
  /** Enable strict validation (throws on malformed elements) */
  strictMode?: boolean;
  /** Custom handler for unsupported Transfer Syntaxes */
  onUnsupportedSyntax?: (uid: string) => 'skip' | 'throw' | 'raw';
}
