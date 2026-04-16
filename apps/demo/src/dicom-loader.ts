// DICOM folder loading utility for the demo app
// Parses multiple DICOM files from a folder selection and builds a 3D volume.

import { parseDicom, buildSeriesVolume } from '@jsmedgl/parser-dicom';
import type { DicomVolume, DicomHeader } from '@jsmedgl/parser-dicom';

/**
 * Load a DICOM series from an array of File objects (e.g. from folder selection).
 * Parses each file, groups by SeriesInstanceUID, and builds the largest series into a 3D volume.
 */
export async function loadDicomFolder(files: File[]): Promise<DicomVolume> {
  if (files.length === 0) {
    throw new Error('No DICOM files provided');
  }

  // Parse all files in parallel
  const parsedSlices = await Promise.all(
    files.map(async (file) => {
      const buffer = await file.arrayBuffer();
      const volume = await parseDicom(buffer);
      return { header: volume.header, data: volume.data };
    })
  );

  // Group by SeriesInstanceUID
  const groups = new Map<string, Array<{ header: DicomHeader; data: ArrayBuffer }>>();
  for (const slice of parsedSlices) {
    const uid = slice.header.seriesInstanceUid;
    if (!groups.has(uid)) {
      groups.set(uid, []);
    }
    groups.get(uid)!.push(slice);
  }

  // Pick the largest group (most slices)
  let largestGroup: Array<{ header: DicomHeader; data: ArrayBuffer }> | null = null;
  for (const group of groups.values()) {
    if (!largestGroup || group.length > largestGroup.length) {
      largestGroup = group;
    }
  }

  // Build 3D volume from the series
  return buildSeriesVolume(largestGroup!);
}
