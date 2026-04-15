// @jsmedgl/parser-dicom — DICOM File Parser

// Re-export types
export type {
  DicomTag,
  DicomElement,
  DicomHeader,
  DicomVolume,
  DicomParserOptions,
  TransferSyntaxUID,
} from './types';

export {
  TRANSFER_SYNTAX,
  tagToString,
  parseTagString,
} from './types';

// Parser API
export {
  parseDicom,
  parseDicomHeader,
  createDicomParser,
} from './parser';

export type { DicomParser } from './parser';

// Coordinate utilities
export {
  buildDicomAffine,
  computeSliceSpacing,
  validateOrientation,
} from './lps-coordinate';

// VR decoder
export { decodeVR } from './vr-reader';

// Transfer syntax utilities
export {
  mapUidToTS,
  isSupportedTransferSyntax,
} from './transfer-syntax';

// Pixel data utilities
export { buildHeaderDatatype } from './pixel-data';

// Series builder
export { buildSeriesVolume } from './series-builder';
export type { ParsedDicomFile } from './series-builder';

// Internal utilities (for advanced usage / testing)
export {
  parseDS,
  parseIS,
  trimDicomString,
  mapDicomToNiftiDatatype,
  invertMatrix,
  identityMatrix,
  lookupVR,
} from './utils';

// Tag reader (for advanced usage)
export { readElements } from './tag-reader';
export type { TransferSyntax } from './tag-reader';
