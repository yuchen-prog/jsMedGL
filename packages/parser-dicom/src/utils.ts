// DICOM Parser Utilities

// ============================================================
// Constants
// ============================================================

/** DICOM File Meta Information group (always little-endian) */
export const FILE_META_GROUP = 0x0002;

/** DICOM preamble size (128 bytes) + "DICM" magic (4 bytes) */
export const PREAMBLE_AND_MAGIC_SIZE = 132;

/** Maximum element value length for inline decoding (10 MB) */
export const MAX_INLINE_LENGTH = 10 * 1024 * 1024;

// ============================================================
// Byte Order
// ============================================================

/**
 * Detect if the current platform is little-endian
 */
export function isLittleEndian(): boolean {
  const buffer = new ArrayBuffer(2);
  const view = new Uint8Array(buffer);
  const int16 = new Int16Array(buffer);
  int16[0] = 1;
  return view[0] === 1;
}

// ============================================================
// String Operations
// ============================================================

/**
 * Read a fixed-length string from buffer (trimmed, no null terminator)
 */
export function readFixedString(buffer: ArrayBuffer, offset: number, length: number): string {
  const bytes = new Uint8Array(buffer, offset, length);
  // Find the first null terminator
  let end = 0;
  while (end < length && bytes[end] !== 0) {
    end++;
  }
  const trimmed = bytes.slice(0, end);
  return new TextDecoder('ascii').decode(trimmed).trim();
}

/**
 * Read a null-terminated string from buffer
 */
export function readCString(buffer: ArrayBuffer, offset: number, maxLength: number): string {
  const bytes = new Uint8Array(buffer, offset, maxLength);
  let end = 0;
  while (end < bytes.length && bytes[end] !== 0) {
    end++;
  }
  return new TextDecoder('ascii').decode(bytes.slice(0, end));
}

/**
 * Trim trailing spaces and null characters
 */
export function trimDicomString(raw: string): string {
  return raw.replace(/[\s\0]+$/, '').trim();
}

// ============================================================
// Number Parsing
// ============================================================

/**
 * Parse DICOM Decimal String (DS) to number.
 * Handles leading/trailing spaces and backslash separators.
 */
export function parseDS(raw: string): number {
  const trimmed = trimDicomString(raw);
  return parseFloat(trimmed);
}

/**
 * Parse DICOM Integer String (IS) to number.
 */
export function parseIS(raw: string): number {
  const trimmed = trimDicomString(raw);
  return parseInt(trimmed, 10);
}

// ============================================================
// DICOM Tag Dictionary (Implicit VR lookup)
// ============================================================

/**
 * Implicit VR DICOM Tag dictionary — maps Tag → VR.
 * Contains the most common tags used in medical imaging.
 * Reference: DICOM Part 6 Data Dictionary.
 *
 * Format: tagKey → VR (2 chars)
 * tagKey is constructed as: (group << 16) | element
 */
export const IMPLICIT_VR_DICTIONARY: Map<number, string> = new Map([

  // ─── File Meta Information (Group 0002) — always Implicit VR Little Endian ───
  [0x00020001, 'UL'], // FileMetaInformationGroupLength
  [0x00020002, 'UI'], // MediaStorageSOPClassUID
  [0x00020003, 'UI'], // MediaStorageSOPInstanceUID
  [0x00020010, 'UI'], // TransferSyntaxUID
  [0x00020012, 'UI'], // ImplementationClassUID
  [0x00020013, 'SH'], // ImplementationVersionName

  // ─── Patient Information (Group 0010) ───
  [0x00100010, 'PN'], // PatientName
  [0x00100020, 'LO'], // PatientID
  [0x00100021, 'LO'], // IssuerOfPatientID
  [0x00100030, 'DA'], // PatientBirthDate
  [0x00100032, 'TM'], // PatientBirthTime
  [0x00100040, 'CS'], // PatientSex
  [0x00101010, 'AS'], // PatientAge
  [0x00101030, 'DS'], // PatientSize
  [0x00101020, 'DS'], // PatientWeight

  // ─── Study Information (Group 0020) ───
  [0x0020000D, 'UI'], // StudyInstanceUID
  [0x0020000E, 'UI'], // SeriesInstanceUID
  [0x00200010, 'SH'], // StudyID
  [0x00200011, 'IS'], // SeriesNumber
  [0x00200013, 'IS'], // InstanceNumber
  [0x00200020, 'CS'], // PatientOrientation
  [0x00200032, 'DS'], // ImagePositionPatient
  [0x00200037, 'DS'], // ImageOrientationPatient
  [0x00200050, 'DS'], // SliceLocation
  [0x00200052, 'UI'], // FrameOfReferenceUID
  [0x00200080, 'DS'], // ImagePositionPatient (synonym for 0020,0032)
  [0x00200081, 'DS'], // ImageOrientationPatient (synonym for 0020,0037)
  [0x0020008D, 'DS'], // SliceLocation (synonym for 0020,1041)
  [0x00201041, 'DS'], // SliceLocation

  // ─── Image Information (Group 0028) ───
  [0x00280002, 'US'], // SamplesPerPixel
  [0x00280004, 'CS'], // PhotometricInterpretation
  [0x00280006, 'US'], // BitsAllocated
  [0x00280008, 'US'], // BitsStored
  [0x00280009, 'US'], // HighBit
  [0x00280010, 'US'], // Rows
  [0x00280011, 'US'], // Columns
  [0x00280030, 'DS'], // PixelSpacing
  [0x00280034, 'IS'], // PixelAspectRatio
  [0x00280100, 'US'], // BitsAllocated (duplicate, keep for lookup)
  [0x00280101, 'US'], // BitsStored
  [0x00280102, 'US'], // HighBit
  [0x00280103, 'US'], // PixelRepresentation
  [0x00281050, 'DS'], // WindowCenter
  [0x00281051, 'DS'], // WindowWidth
  [0x00281052, 'DS'], // WindowCenterWidthExplanation
  [0x00281054, 'DS'], // RescaleIntercept
  [0x00281055, 'DS'], // RescaleSlope
  [0x00281056, 'LO'], // RescaleType
  [0x00282110, 'CS'], // RedPaletteColorLookupTableDescriptor
  [0x00282111, 'US'], // RedPaletteColorLookupTableData

  // ─── Image Pixel Module (Group 7FE0) ───
  [0x7FE00010, 'OW'], // PixelData

  // ─── CT-Specific (Group 0018) ───
  [0x00180050, 'DS'], // SliceThickness
  [0x00180060, 'CS'], // KVP
  [0x00181000, 'DS'], // ReconstructionDiameter
  [0x00181150, 'DS'], // GantryDetectorTilt
  [0x00181170, 'DS'], // TableFeetPosition
  [0x00181190, 'DS'], // DataCollectionDiameter
  [0x00181500, 'DS'], // ReconstructionAngle

  // ─── MR-Specific ───
  [0x00180083, 'DS'], // SpatialResolution
  [0x00180090, 'DS'], // RepetitionTime
  [0x00180091, 'DS'], // EchoTime
  [0x00180092, 'DS'], // InversionTime
  [0x00180093, 'DS'], // NumberOfAverages
  [0x00180094, 'DS'], // ImagingFrequency
  [0x00181020, 'LO'], // SoftwareVersions
  [0x00181030, 'LO'], // ProtocolName
  [0x00181040, 'LO'], // InstitutionalDepartmentName

  // ─── Series Information ───
  [0x00081010, 'SH'], // StudyDescription
  [0x0008103E, 'LO'], // SeriesDescription
  [0x00081030, 'LO'], // StudyDate / SeriesDescription
  [0x00080020, 'DA'], // StudyDate
  [0x00080021, 'DA'], // SeriesDate
  [0x00080022, 'DA'], // AcquisitionDate
  [0x00080060, 'CS'], // Modality

  // ─── SOP Class Information ───
  [0x00080016, 'UI'], // SOPClassUID
  [0x00080018, 'UI'], // SOPInstanceUID

  // ─── Pixel Value Relationships ───
  [0x00289001, 'US'], // BitsForCOlorPalettes (sic)
  [0x00289002, 'US'], // SmallestImagePixelValue
  [0x00289003, 'US'], // LargestImagePixelValue
  [0x00289108, 'US'], // SmallestPixelValueInSeries
  [0x00289109, 'US'], // LargestPixelValueInSeries

  // ─── Multi-frame (4D) ───
  [0x00280008, 'IS'], // NumberOfFrames
  [0x00280009, 'AT'], // FrameIncrementPointer

  // ─── Overlay ───
  [0x60000010, 'US'], // OverlayRows
  [0x60000011, 'US'], // OverlayColumns
  [0x60000040, 'CS'], // OverlayType
  [0x60000050, 'SS'], // OverlayOrigin
  [0x60000100, 'US'], // OverlayBitsAllocated
  [0x60000102, 'US'], // OverlayBitPosition
  [0x60003000, 'OW'], // OverlayData
]);

/**
 * Look up VR for a tag from the dictionary (for Implicit VR Transfer Syntax).
 * Returns undefined if the tag is not in the dictionary.
 */
export function lookupVR(group: number, element: number): string | undefined {
  return IMPLICIT_VR_DICTIONARY.get((group << 16) | element);
}

// ============================================================
// Data Type Mapping (DICOM → NIfTI)
// ============================================================

/**
 * Map DICOM pixel data format to NIfTI datatype code for renderer compatibility.
 *
 * DICOM uses (bitsAllocated, pixelRepresentation) to describe pixel data format.
 * Renderer uses NIfTI datatype codes via getDataTypeSize() and readVoxel().
 *
 * Reference: NIfTI Data Types (nifti1_io.h NIFTI_TYPE_*)
 */
export function mapDicomToNiftiDatatype(
  bitsAllocated: number,
  pixelRepresentation: number
): number {
  if (bitsAllocated === 8) {
    return pixelRepresentation === 1 ? 256 /* INT8 */ : 2 /* UINT8 */;
  }
  if (bitsAllocated === 16) {
    return pixelRepresentation === 1 ? 4 /* INT16 */ : 512 /* UINT16 */;
  }
  if (bitsAllocated === 32) {
    return pixelRepresentation === 1 ? 8 /* INT32 */ : 768 /* UINT32 */;
  }
  if (bitsAllocated === 64) {
    return pixelRepresentation === 1 ? 1024 /* INT64 */ : 1280 /* UINT64 */;
  }
  // Fallback — treat as unsigned 16-bit
  return 512 /* UINT16 */;
}

// ============================================================
// Matrix Utilities
// ============================================================

/**
 * Create 4x4 identity matrix
 */
export function identityMatrix(): number[] {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

/**
 * Invert a 4x4 matrix using Gauss-Jordan elimination.
 */
export function invertMatrix(m: number[]): number[] {
  const result = new Array(16).fill(0);
  const temp = new Array(16).fill(0);

  for (let i = 0; i < 4; i++) {
    result[i * 4 + i] = 1;
  }

  for (let i = 0; i < 16; i++) {
    temp[i] = m[i];
  }

  for (let i = 0; i < 4; i++) {
    let pivot = i;
    for (let j = i + 1; j < 4; j++) {
      if (Math.abs(temp[j * 4 + i]) > Math.abs(temp[pivot * 4 + i])) {
        pivot = j;
      }
    }

    if (pivot !== i) {
      for (let j = 0; j < 4; j++) {
        let tmp = temp[i * 4 + j];
        temp[i * 4 + j] = temp[pivot * 4 + j];
        temp[pivot * 4 + j] = tmp;

        tmp = result[i * 4 + j];
        result[i * 4 + j] = result[pivot * 4 + j];
        result[pivot * 4 + j] = tmp;
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
