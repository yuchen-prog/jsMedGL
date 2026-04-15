// DICOM Series Builder — Merge multiple DICOM files into a 3D volume

import type { DicomVolume, DicomHeader, DicomParserOptions } from './types';
import { computeSliceSpacing, buildDicomAffine } from './lps-coordinate';
import { invertMatrix } from './utils';

export interface ParsedDicomFile {
  header: DicomHeader;
  data: ArrayBuffer;
}

/**
 * Build a 3D volume from an array of parsed DICOM files belonging to the same series.
 *
 * Algorithm:
 * 1. Sort slices by InstanceNumber / SliceLocation / IPP[2]
 * 2. Validate consistent dimensions across slices
 * 3. Compute Z spacing from IPP positions
 * 4. Build affine matrix from first and last slice positions
 * 5. Merge pixel data into a single 3D ArrayBuffer
 */
export function buildSeriesVolume(
  files: ParsedDicomFile[],
  _options?: DicomParserOptions
): DicomVolume {
  if (files.length === 0) {
    throw new Error('Cannot build series from empty file list');
  }

  if (files.length === 1) {
    // Single slice — return as-is
    const f = files[0];
    return {
      header: f.header,
      data: f.data,
      dimensions: [f.header.columns, f.header.rows, 1],
      spacing: [f.header.pixelSpacing[0], f.header.pixelSpacing[1], f.header.sliceThickness],
      affine: buildSingleSliceAffine(f.header),
      inverseAffine: f.header.sliceThickness > 0
        ? invertMatrix(buildSingleSliceAffine(f.header))
        : [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1,
          ],
    };
  }

  // Sort slices
  const sorted = sortSlices(files);

  // Validate consistency
  const first = sorted[0];
  const cols = first.header.columns;
  const rows = first.header.rows;

  for (const f of sorted) {
    if (f.header.columns !== cols || f.header.rows !== rows) {
      throw new Error(
        `Inconsistent dimensions: expected ${cols}x${rows}, got ${f.header.columns}x${f.header.rows}`
      );
    }
  }

  // Compute Z spacing from IPP positions
  const positions = sorted.map(f => f.header.imagePositionPatient);
  const zSpacing = computeSliceSpacing(positions);
  const numSlices = sorted.length;

  // Build affine using the first slice orientation and computed z spacing
  const { affine } = buildDicomAffine(
    first.header.imagePositionPatient,
    first.header.imageOrientationPatient,
    first.header.pixelSpacing,
    zSpacing,
    numSlices
  );

  const inverseAffine = invertMatrix(affine);

  // Merge pixel data
  const bytesPerVoxel = first.header.bitsAllocated / 8;
  const sliceSize = cols * rows * bytesPerVoxel;
  const totalSize = sliceSize * numSlices;
  const merged = new Uint8Array(totalSize);

  for (let i = 0; i < sorted.length; i++) {
    const sliceData = new Uint8Array(sorted[i].data);
    const expectedSize = sliceSize;
    if (sliceData.length < expectedSize) {
      // Pad with zeros if slice data is shorter
      merged.set(sliceData, i * sliceSize);
    } else {
      merged.set(sliceData.subarray(0, expectedSize), i * sliceSize);
    }
  }

  return {
    header: {
      ...first.header,
      sliceThickness: zSpacing,
    },
    data: merged.buffer as ArrayBuffer,
    dimensions: [cols, rows, numSlices],
    spacing: [first.header.pixelSpacing[0], first.header.pixelSpacing[1], zSpacing],
    affine,
    inverseAffine,
  };
}

/**
 * Sort DICOM slices by position.
 * Priority: InstanceNumber → SliceLocation → IPP[2]
 */
function sortSlices(files: ParsedDicomFile[]): ParsedDicomFile[] {
  return [...files].sort((a, b) => {
    const aNum = a.header.instanceNumber;
    const bNum = b.header.instanceNumber;

    if (aNum !== bNum) return aNum - bNum;

    const aLoc = a.header.sliceLocation;
    const bLoc = b.header.sliceLocation;
    if (!isNaN(aLoc) && !isNaN(bLoc) && aLoc !== bLoc) return aLoc - bLoc;

    return a.header.imagePositionPatient[2] - b.header.imagePositionPatient[2];
  });
}

/**
 * Build a simple affine for a single slice.
 */
function buildSingleSliceAffine(header: DicomHeader): number[] {
  const { affine } = buildDicomAffine(
    header.imagePositionPatient,
    header.imageOrientationPatient,
    header.pixelSpacing,
    header.sliceThickness,
    1
  );

  return affine;
}
