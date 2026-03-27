// Main NIfTI parser implementation

import type { NiftiHeader, NiftiVolume, NiftiParserOptions } from './types';
import { parseNifti1Header, parseNifti2Header } from './header-parser';
import { decompressGzip } from './decompressor';
import { extractAffineMatrix } from './coordinate';
import { getDataTypeSize } from './utils';

/**
 * Parse NIfTI file from ArrayBuffer or File
 */
export async function parseNifti(
  source: ArrayBuffer | File,
  options?: NiftiParserOptions
): Promise<NiftiVolume> {
  // Get ArrayBuffer from File if needed
  let buffer: ArrayBuffer;
  if (source instanceof File) {
    buffer = await source.arrayBuffer();
  } else {
    buffer = source;
  }

  // Check if gzip compressed
  const isCompressed = buffer.byteLength > 2 && 
    new Uint8Array(buffer)[0] === 0x1f && 
    new Uint8Array(buffer)[1] === 0x8b;

  // Decompress if needed
  if (isCompressed) {
    buffer = await decompressGzip(buffer);
  }

  // Parse header
  const header = parseNiftiHeaderFromBuffer(buffer, options);

  // Check for unsupported data (4D+, etc.)
  const warnings: string[] = [];
  if (header.dim[0] >= 4 && header.dim[4] > 1) {
    const msg = `4D data detected (dim[4]=${header.dim[4]}). 4D volumes are not fully supported - only the first 3D volume will be rendered.`;
    console.warn(msg);
    warnings.push(msg);
  }

  // Extract dimensions
  const dimensions: [number, number, number] = [
    header.dim[1],
    header.dim[2],
    header.dim[3]
  ];

  // Extract spacing - always use absolute values
  const spacing: [number, number, number] = [
    Math.abs(header.pixdim[1]),
    Math.abs(header.pixdim[2]),
    Math.abs(header.pixdim[3])
  ];

  // Extract affine matrix
  const affine = extractAffineMatrix(header);

  // Simple matrix inversion (will be improved)
  const inverseAffine = invertMatrix(affine);

  // Load image data
  const data = extractImageData(buffer, header);

  const result: NiftiVolume = {
    header,
    data,
    dimensions,
    spacing,
    affine,
    inverseAffine
  };

  if (warnings.length > 0) {
    result.warnings = warnings;
  }

  return result;
}

/**
 * Parse only the header (skip image data)
 */
export async function parseNiftiHeader(
  source: ArrayBuffer | File,
  options?: NiftiParserOptions
): Promise<NiftiHeader> {
  // Get ArrayBuffer from File if needed
  let buffer: ArrayBuffer;
  if (source instanceof File) {
    buffer = await source.arrayBuffer();
  } else {
    buffer = source;
  }

  // Check if gzip compressed
  const isCompressed = buffer.byteLength > 2 && 
    new Uint8Array(buffer)[0] === 0x1f && 
    new Uint8Array(buffer)[1] === 0x8b;

  // Decompress if needed
  if (isCompressed) {
    buffer = await decompressGzip(buffer);
  }

  return parseNiftiHeaderFromBuffer(buffer, options);
}

/**
 * Create a reusable NIfTI parser instance
 */
export function createNiftiParser(options?: NiftiParserOptions) {
  return {
    async parse(source: ArrayBuffer | File): Promise<NiftiVolume> {
      return parseNifti(source, options);
    },

    async parseHeader(source: ArrayBuffer | File): Promise<NiftiHeader> {
      return parseNiftiHeader(source, options);
    }
  };
}

/**
 * Internal: Parse NIfTI header from ArrayBuffer
 */
function parseNiftiHeaderFromBuffer(buffer: ArrayBuffer, options?: NiftiParserOptions): NiftiHeader {
  const view = new DataView(buffer);

  // Both NIfTI-1 and NIfTI-2 store sizeof_hdr at offset 0
  // NIfTI-1: sizeof_hdr = 348
  // NIfTI-2: sizeof_hdr = 540
  const sizeofHdr = view.getInt32(0, true);
  let header: NiftiHeader;

  if (sizeofHdr === 348) {
    // NIfTI-1: validate magic field at bytes 344-347
    validateNifti1Magic(view);
    header = parseNifti1Header(buffer);
  } else if (sizeofHdr === 540) {
    // NIfTI-2: validate magic field at bytes 4-11
    validateNifti2Magic(view);
    header = parseNifti2Header(buffer);
  } else {
    throw new Error(`Unknown NIfTI format. Expected sizeof_hdr to be 348 or 540, got ${sizeofHdr}`);
  }

  // Validate header in strict mode
  if (options?.strictMode) {
    validateHeader(header);
  }

  return header;
}

/**
 * Validate NIfTI-1 magic field at bytes 344-347.
 * Valid values: "ni1\0" (header+img pair) or "n+1\0" (single .nii file)
 */
function validateNifti1Magic(view: DataView): void {
  if (view.byteLength < 348) {
    throw new Error('Buffer too small for NIfTI-1 header (need at least 348 bytes)');
  }
  const magic = String.fromCharCode(
    view.getUint8(344),
    view.getUint8(345),
    view.getUint8(346),
    view.getUint8(347)
  );
  if (magic !== 'ni1\0' && magic !== 'n+1\0') {
    throw new Error(`Invalid NIfTI-1 magic field: "${magic.replace(/\0/g, '\\0')}". Expected "ni1\\0" or "n+1\\0".`);
  }
}

/**
 * Validate NIfTI-2 magic field at bytes 4-11.
 * Valid values: "ni2\0\r\n\x1a\n" (header+img pair) or "n+2\0\r\n\x1a\n" (single .nii file)
 * Note: The first 4 bytes (offset 0-3) contain sizeof_hdr = 540
 */
function validateNifti2Magic(view: DataView): void {
  if (view.byteLength < 544) {
    throw new Error('Buffer too small for NIfTI-2 header (need at least 544 bytes)');
  }
  // NIfTI-2 magic is at offset 4-11 (8 bytes)
  // Valid formats: "ni2\0\r\n\x1a\n" or "n+2\0\r\n\x1a\n"
  const magic4 = String.fromCharCode(
    view.getUint8(4),
    view.getUint8(5),
    view.getUint8(6),
    view.getUint8(7)
  );
  if (magic4 !== 'ni2\0' && magic4 !== 'n+2\0') {
    throw new Error(`Invalid NIfTI-2 magic field: "${magic4.replace(/\0/g, '\\0')}". Expected "ni2\\0" or "n+2\\0".`);
  }
}

/**
 * Extract image data from buffer
 */
function extractImageData(buffer: ArrayBuffer, header: NiftiHeader): ArrayBuffer {
  const voxOffset = Math.floor(header.vox_offset);
  const dataTypeSize = getDataTypeSize(header.datatype);

  if (dataTypeSize === 0) {
    throw new Error(`Unsupported data type: ${header.datatype}`);
  }

  // Calculate data size
  const numVoxels = header.dim[1] * header.dim[2] * header.dim[3] * header.dim[4];
  const dataSize = numVoxels * dataTypeSize;

  // Extract data portion
  const dataStart = voxOffset || header.sizeof_hdr;

  // R-03: Guard against underflow and truncation — reject invalid data sizes
  if (dataSize <= 0) {
    throw new Error(`Invalid data size: ${dataSize} for ${numVoxels} voxels (datatype=${header.datatype}, byteSize=${dataTypeSize})`);
  }

  const dataEnd = dataStart + dataSize;

  if (dataEnd > buffer.byteLength) {
    throw new Error(
      `Insufficient data: expected ${dataSize} bytes from offset ${dataStart}, got ${buffer.byteLength - dataStart}`
    );
  }

  return buffer.slice(dataStart, dataEnd);
}

/**
 * Validate header data
 */
function validateHeader(header: NiftiHeader): void {
  // Check dimensions
  if (header.dim[0] < 1 || header.dim[0] > 7) {
    throw new Error(`Invalid dim[0]: ${header.dim[0]}. Expected 1-7.`);
  }

  // Check spatial dimensions
  for (let i = 1; i <= 3; i++) {
    if (header.dim[i] < 1) {
      throw new Error(`Invalid dim[${i}]: ${header.dim[i]}. Must be >= 1.`);
    }
  }

  // Check voxel spacing
  if (header.pixdim[1] === 0 || header.pixdim[2] === 0 || header.pixdim[3] === 0) {
    throw new Error('Invalid voxel spacing: pixdim[1-3] must be > 0.');
  }

  // Check data type
  const dataTypeSize = getDataTypeSize(header.datatype);
  if (dataTypeSize === 0) {
    throw new Error(`Unsupported data type: ${header.datatype}`);
  }
}

/**
 * Simple 4x4 matrix inversion
 */
function invertMatrix(m: number[]): number[] {
  const result = new Array(16).fill(0);
  const temp = new Array(16).fill(0);

  // Initialize result as identity matrix
  for (let i = 0; i < 4; i++) {
    result[i * 4 + i] = 1;
  }

  // Copy input matrix
  for (let i = 0; i < 16; i++) {
    temp[i] = m[i];
  }

  // Gaussian elimination
  for (let i = 0; i < 4; i++) {
    // Find pivot
    let pivot = i;
    for (let j = i + 1; j < 4; j++) {
      if (Math.abs(temp[j * 4 + i]) > Math.abs(temp[pivot * 4 + i])) {
        pivot = j;
      }
    }

    // Swap rows
    if (pivot !== i) {
      for (let j = 0; j < 4; j++) {
        const tmp = temp[i * 4 + j];
        temp[i * 4 + j] = temp[pivot * 4 + j];
        temp[pivot * 4 + j] = tmp;

        const tmp2 = result[i * 4 + j];
        result[i * 4 + j] = result[pivot * 4 + j];
        result[pivot * 4 + j] = tmp2;
      }
    }

    // Scale pivot row
    const pivotVal = temp[i * 4 + i];
    for (let j = 0; j < 4; j++) {
      temp[i * 4 + j] /= pivotVal;
      result[i * 4 + j] /= pivotVal;
    }

    // Eliminate column
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
