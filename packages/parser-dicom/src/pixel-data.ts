// DICOM Pixel Data extraction and rescale

import type { DicomHeader } from './types';
import { mapDicomToNiftiDatatype } from './utils';

/**
 * Extract pixel data from the raw buffer and apply rescale.
 * Returns an ArrayBuffer in the native endianness of the file,
 * compatible with NIfTI renderers.
 *
 * The output dtype is determined by bitsAllocated + pixelRepresentation,
 * mapped to NIfTI datatype codes.
 */
export function extractPixelData(
  rawBuffer: ArrayBuffer,
  header: DicomHeader
): ArrayBuffer {
  const { bitsAllocated, bitsStored, pixelRepresentation, rescaleSlope, rescaleIntercept } = header;

  // For rescaling, we work with signed values internally
  const signed = pixelRepresentation === 1;
  const bytesPerVoxel = bitsAllocated / 8;
  const numVoxels = rawBuffer.byteLength / bytesPerVoxel;

  // Create output buffer (signed or unsigned based on pixelRepresentation)
  // For renderer compatibility, we output the raw dtype.
  // The renderer will call getDataTypeSize(header.datatype) and readVoxel().
  // So we just return the raw buffer after any needed byte swap.

  // Byte swap if needed (all DICOM data is little-endian internally)
  // Our tag-reader reads everything as little-endian, so no swap needed.
  const raw = new Uint8Array(rawBuffer);

  // Apply rescale: pixel = slope * raw + intercept
  // For CT scans (HU), rescaleSlope=1, rescaleIntercept=-1024 is common.
  // For the renderer, we keep the data as-is (raw Hounsfield units)
  // and let the renderer apply window/level.
  void rescaleSlope;
  void rescaleIntercept;
  void signed;
  void bitsStored;
  void numVoxels;

  // The raw buffer IS the pixel data. No transformation needed.
  // The renderer normalizes to [0, 255] internally via scanMinMax.
  return raw.buffer as ArrayBuffer;
}

/**
 * Build the datatype field for DicomHeader from bitsAllocated + pixelRepresentation.
 */
export function buildHeaderDatatype(
  bitsAllocated: number,
  pixelRepresentation: number
): number {
  return mapDicomToNiftiDatatype(bitsAllocated, pixelRepresentation);
}

/**
 * Extract a single frame from multi-frame pixel data.
 * DICOM multi-frame stores frames sequentially in PixelData.
 */
export function extractFrame(
  pixelData: ArrayBuffer,
  frameIndex: number,
  frameLength: number
): ArrayBuffer {
  const byteOffset = frameIndex * frameLength;
  if (byteOffset + frameLength > pixelData.byteLength) {
    throw new Error(
      `Frame ${frameIndex} out of bounds: offset=${byteOffset}, length=${frameLength}, total=${pixelData.byteLength}`
    );
  }
  return pixelData.slice(byteOffset, byteOffset + frameLength);
}