// DICOM Parser — Main Entry Point

import type {
  DicomVolume,
  DicomHeader,
  DicomParserOptions,
  DicomElement,
} from './types';
import { readElements, type TransferSyntax } from './tag-reader';
import { decodeVR } from './vr-reader';
import { buildHeaderDatatype } from './pixel-data';
import { isSupportedTransferSyntax, needsDecompression, decompressDeflate, detectTransferSyntax } from './transfer-syntax';
import { invertMatrix, trimDicomString, parseDS, identityMatrix } from './utils';

export interface DicomParser {
  parse(source: ArrayBuffer | File | Blob): Promise<DicomVolume>;
  parseHeader(source: ArrayBuffer | File | Blob): Promise<DicomHeader>;
}

export function createDicomParser(options?: DicomParserOptions): DicomParser {
  return {
    async parse(source) {
      return parseDicom(source, options);
    },
    async parseHeader(source) {
      return parseDicomHeader(source);
    },
  };
}

// ============================================================
// Public API
// ============================================================

/**
 * Parse a single DICOM file (single-frame or multi-frame).
 */
export async function parseDicom(
  source: ArrayBuffer | File | Blob,
  options?: DicomParserOptions
): Promise<DicomVolume> {
  const buffer = await sourceToArrayBuffer(source);

  // Parse meta group (0002) to determine transfer syntax.
  // readElements auto-detects whether meta uses implicit or explicit VR encoding.
  const metaElements = readElements(buffer, 'implicit-le', { onlyGroup: 0x0002 });

  const { ts, tsUid } = detectTransferSyntax(metaElements as unknown as Map<string, DicomElement>);

  const warnings: string[] = [];

  // Handle unsupported transfer syntaxes
  if (!isSupportedTransferSyntax(tsUid)) {
    const action = options?.onUnsupportedSyntax?.(tsUid) ?? 'throw';
    if (action === 'throw') {
      throw new Error(`Unsupported Transfer Syntax: ${tsUid}`);
    } else if (action === 'skip') {
      warnings.push(`Skipping unsupported Transfer Syntax: ${tsUid}`);
      return buildMinimalVolume(metaElements, tsUid, warnings);
    }
  }

  // Decompress if needed
  let dataBuffer = buffer;
  if (needsDecompression(tsUid)) {
    try {
      dataBuffer = await decompressDeflate(buffer);
    } catch (err) {
      throw new Error(`Failed to decompress DICOM: ${String(err)}`);
    }
  }

  // Re-read elements with correct transfer syntax (skip group 0002, already parsed)
  const decodedElements = readElementsWithVR(dataBuffer, ts);

  // Merge meta elements into decoded elements
  for (const [key, value] of metaElements) {
    if (!decodedElements.has(key)) {
      decodedElements.set(key, value);
    }
  }

  // Build header from parsed elements
  const header = buildHeader(decodedElements, tsUid);

  // Extract pixel data
  const pixelElement = decodedElements.get('7FE0,0010');
  const pixelData = pixelElement
    ? extractPixelElement(pixelElement)
    : new ArrayBuffer(0);

  // Build affine from first slice position
  const affine = buildDicomAffine(
    header.imagePositionPatient,
    header.imageOrientationPatient,
    header.pixelSpacing,
    header.sliceThickness,
    1
  );

  const inverseAffine = header.sliceThickness > 0
    ? invertMatrix(affine.affine)
    : identityMatrix();

  const result: DicomVolume = {
    header,
    data: pixelData,
    dimensions: [header.columns, header.rows, 1],
    spacing: [header.pixelSpacing[0], header.pixelSpacing[1], header.sliceThickness],
    affine: affine.affine,
    inverseAffine,
    warnings: warnings.length > 0 ? warnings : undefined,
  };

  return result;
}

/**
 * Parse only the header (no pixel data loading).
 */
export async function parseDicomHeader(
  source: ArrayBuffer | File | Blob,
  _options?: DicomParserOptions
): Promise<DicomHeader> {
  const buffer = await sourceToArrayBuffer(source);
  const metaElements = readElements(buffer, 'implicit-le');
  const { ts, tsUid } = detectTransferSyntax(metaElements as unknown as Map<string, DicomElement>);
  const decodedElements = readElementsWithVR(buffer, ts);
  return buildHeader(decodedElements, tsUid);
}

// ============================================================
// Internal Helpers
// ============================================================

function buildDicomAffine(
  ipp: [number, number, number],
  iop: [number, number, number, number, number, number],
  pixelSpacing: [number, number],
  sliceThickness: number,
  _numSlices: number
): { affine: number[]; inverseAffine: number[] } {
  const [r0, r1, r2] = iop;
  const [c0, c1, c2] = iop.slice(3) as [number, number, number];
  const Sr = pixelSpacing[0];
  const Sc = pixelSpacing[1];
  const Sz = sliceThickness > 0 ? sliceThickness : 1;

  // Z direction = cross(row, col)
  const z0 = r1 * c2 - r2 * c1;
  const z1 = r2 * c0 - r0 * c2;
  const z2 = r0 * c1 - r1 * c0;

  // Build RAS affine
  const affineRAS = [
    -r0 * Sr, -c0 * Sc, z0 * Sz, -ipp[0],
    -r1 * Sr, -c1 * Sc, z1 * Sz, -ipp[1],
    -r2 * Sr, -c2 * Sc, z2 * Sz,  ipp[2],
     0,        0,        0,        1,
  ];

  return {
    affine: affineRAS,
    inverseAffine: invertMatrix(affineRAS),
  };
}

async function sourceToArrayBuffer(source: ArrayBuffer | File | Blob): Promise<ArrayBuffer> {
  if (source instanceof ArrayBuffer) return source;
  return source.arrayBuffer();
}

function readElementsWithVR(buffer: ArrayBuffer, ts: TransferSyntax): Map<string, DicomElement> {
  // Skip group 0002 (already parsed from meta elements above), now skipGroup works
  const elements = readElements(buffer, ts, { skipGroup: 0x0002 });

  for (const [key, element] of elements) {
    if (typeof element.value === 'string') {
      const decoded = decodeVR(element.value, element.vr);
      elements.set(key, { ...element, value: decoded });
    }
  }

  return elements;
}

function buildHeader(
  elements: Map<string, DicomElement>,
  tsUid: string
): DicomHeader {
  const get = (key: string, defaultValue: unknown = null): unknown => {
    return elements.get(key)?.value ?? defaultValue;
  };

  const getNum = (key: string, defaultValue = 0): number => {
    const v = get(key);
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const n = parseDS(v);
      return isNaN(n) ? defaultValue : n;
    }
    return defaultValue;
  };

  const getStr = (key: string, defaultValue = ''): string => {
    const v = get(key);
    return typeof v === 'string' ? trimDicomString(v) : defaultValue;
  };

  const getNumOrArray = (key: string): number[] => {
    const v = get(key);
    if (Array.isArray(v)) return v;
    if (typeof v === 'number') return [v];
    if (typeof v === 'string') {
      return v.split('\\').map(s => parseDS(s.trim())).filter(n => !isNaN(n));
    }
    return [];
  };

  const rows = getNum('0028,0010', 0);
  const columns = getNum('0028,0011', 0);
  const bitsAllocated = getNum('0028,0100', 16);
  const bitsStored = getNum('0028,0101', 16);
  const highBit = getNum('0028,0102', 15);
  const pixelRepresentation = getNum('0028,0103', 0);
  const rescaleSlope = getNum('0028,1053', 1);
  const rescaleIntercept = getNum('0028,1052', 0);
  const windowCenter = getNum('0028,1050', 40);
  const windowWidth = getNum('0028,1051', 400);

  const ippArr = getNumOrArray('0020,0032');
  const iopArr = getNumOrArray('0020,0037');
  const pixelSpacingArr = getNumOrArray('0028,0030');

  const imagePositionPatient: [number, number, number] =
    ippArr.length >= 3 ? [ippArr[0], ippArr[1], ippArr[2]] : [0, 0, 0];
  const imageOrientationPatient: [number, number, number, number, number, number] =
    iopArr.length >= 6
      ? [iopArr[0], iopArr[1], iopArr[2], iopArr[3], iopArr[4], iopArr[5]]
      : [1, 0, 0, 0, 1, 0];
  const pixelSpacing: [number, number] =
    pixelSpacingArr.length >= 2 ? [pixelSpacingArr[0], pixelSpacingArr[1]] : [1, 1];

  const sliceThickness = getNum('0018,0050', 1);
  const sliceLocation = getNum('0020,1041', 0);
  const modality = getStr('0008,0060', 'OT');
  const studyDate = getStr('0008,0020', '');
  const patientName = getStr('0010,0010', 'Anonymous');
  const seriesDescription = getStr('0008,103E', '');
  const seriesInstanceUid = getStr('0020,000E', '');
  const sopInstanceUid = getStr('0008,0018', '');
  const studyInstanceUid = getStr('0020,000D', '');
  const seriesNumber = getNum('0020,0011', 0);
  const instanceNumber = getNum('0020,0013', 0);

  const datatype = buildHeaderDatatype(bitsAllocated, pixelRepresentation);

  return {
    rows,
    columns,
    bitsAllocated,
    bitsStored,
    highBit,
    pixelRepresentation,
    rescaleSlope,
    rescaleIntercept,
    windowCenter,
    windowWidth,
    imagePositionPatient,
    imageOrientationPatient,
    pixelSpacing,
    sliceThickness,
    sliceLocation,
    modality,
    studyDate,
    patientName,
    seriesDescription,
    seriesInstanceUid,
    sopInstanceUid,
    studyInstanceUid,
    seriesNumber,
    instanceNumber,
    transferSyntaxUid: tsUid,
    datatype,
  };
}

function extractPixelElement(element: DicomElement): ArrayBuffer {
  if (element.value instanceof ArrayBuffer) {
    return element.value;
  }
  if (element.value instanceof Uint8Array) {
    return element.value.buffer as ArrayBuffer;
  }
  if (element.value === null || element.value === undefined) {
    return new ArrayBuffer(0);
  }
  return new ArrayBuffer(0);
}

function buildMinimalVolume(
  elements: Map<string, DicomElement>,
  tsUid: string,
  warnings: string[]
): DicomVolume {
  const header = buildHeader(elements, tsUid);
  return {
    header,
    data: new ArrayBuffer(0),
    dimensions: [header.columns, header.rows, 1],
    spacing: [header.pixelSpacing[0], header.pixelSpacing[1], header.sliceThickness],
    affine: new Array(16).fill(0),
    inverseAffine: new Array(16).fill(0),
    warnings,
  };
}
