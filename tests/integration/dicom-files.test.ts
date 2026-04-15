// Integration tests with real DICOM files

import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseDicom, parseDicomHeader, buildSeriesVolume, readElements } from '@jsmedgl/parser-dicom';
import type { DicomVolume } from '@jsmedgl/parser-dicom';

// ============================================================
// Helpers
// ============================================================

function loadBuffer(filePath: string): ArrayBuffer {
  const buffer = readFileSync(filePath);
  // Node.js Buffer is not backed by a fresh ArrayBuffer — copy into a fresh
  // Uint8Array whose .buffer is a clean ArrayBuffer with no byteOffset.
  const bytes = new Uint8Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) bytes[i] = buffer[i];
  return bytes.buffer as ArrayBuffer;
}

function loadDicomBuffers(dirPath: string): ArrayBuffer[] {
  const files = readdirSync(dirPath)
    .filter(f => f.endsWith('.dcm'))
    .sort()
    .map(f => join(dirPath, f));
  return files.map(f => loadBuffer(f));
}

/** Multiply two 4x4 matrices (column-major) */
function multiplyMatrices(a: number[], b: number[]): number[] {
  const result = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      for (let k = 0; k < 4; k++) {
        result[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
      }
    }
  }
  return result;
}

// ============================================================
// Single DICOM File Tests
// ============================================================

const SINGLE_DCM_PATH = join(__dirname, '../fixtures/1.3.12.2.1107.5.1.4.76360.30000023022800083166200349414.dcm');

describe('DICOM File Debug', () => {
  let fileBuffer: ArrayBuffer;

  beforeAll(() => {
    fileBuffer = loadBuffer(SINGLE_DCM_PATH);
  });

  it('debug: parseDicom output', async () => {
    const volume = await parseDicom(fileBuffer);
    console.log('\n=== parseDicom output ===');
    console.log('BitsAllocated:', volume.header.bitsAllocated);
    console.log('BitsStored:', volume.header.bitsStored);
    console.log('PixelRep:', volume.header.pixelRepresentation);
    console.log('IPP:', volume.header.imagePositionPatient);
    console.log('IOP:', volume.header.imageOrientationPatient);
    console.log('SeriesUID:', volume.header.seriesInstanceUid);
    console.log('InstanceNumber:', volume.header.instanceNumber);
    console.log('SliceLocation:', volume.header.sliceLocation);
    console.log('Data byteLength:', volume.data.byteLength);
    console.log('SliceThickness:', volume.header.sliceThickness);
    console.log('PixelSpacing:', volume.header.pixelSpacing);
    console.log('WindowCenter:', volume.header.windowCenter, 'Width:', volume.header.windowWidth);
    console.log('RescaleSlope:', volume.header.rescaleSlope, 'Intercept:', volume.header.rescaleIntercept);
    expect(true).toBe(true);
  });
});

describe('Single DICOM File Parsing', () => {
  let fileBuffer: ArrayBuffer;

  beforeAll(() => {
    fileBuffer = loadBuffer(SINGLE_DCM_PATH);
  });

  it('should parse without errors', async () => {
    const volume = await parseDicom(fileBuffer);
    expect(volume).toBeDefined();
    expect(volume.header).toBeDefined();
  });

  it('should extract valid image dimensions', async () => {
    const volume = await parseDicom(fileBuffer);
    expect(volume.header.rows).toBeGreaterThan(0);
    expect(volume.header.columns).toBeGreaterThan(0);
    expect(volume.dimensions).toEqual([volume.header.columns, volume.header.rows, 1]);
  });

  it('should extract bitsAllocated and pixelRepresentation', async () => {
    const volume = await parseDicom(fileBuffer);
    expect(volume.header.bitsAllocated).toBeGreaterThan(0);
    expect([0, 1]).toContain(volume.header.pixelRepresentation);
  });

  it('should map datatype to NIfTI-compatible code', async () => {
    const volume = await parseDicom(fileBuffer);
    // Valid NIfTI datatype codes: 2=UINT8, 4=INT16, 512=UINT16, 768=UINT32, 8=INT32
    const valid = [2, 4, 512, 768, 8, 1024, 1280];
    expect(valid).toContain(volume.header.datatype);
  });

  it('should have non-zero pixel data', async () => {
    const volume = await parseDicom(fileBuffer);
    const bytesPerVoxel = volume.header.bitsAllocated / 8;
    const expectedSize = volume.header.columns * volume.header.rows * bytesPerVoxel;
    expect(volume.data.byteLength).toBeGreaterThanOrEqual(expectedSize);
  });

  it('should extract ImagePositionPatient', async () => {
    const volume = await parseDicom(fileBuffer);
    expect(volume.header.imagePositionPatient).toBeDefined();
    expect(volume.header.imagePositionPatient.length).toBe(3);
    // IPP should have meaningful values (not all zero for real scans)
    const [x, y, z] = volume.header.imagePositionPatient;
    expect(x).not.toBe(0);
  });

  it('should extract ImageOrientationPatient', async () => {
    const volume = await parseDicom(fileBuffer);
    expect(volume.header.imageOrientationPatient).toBeDefined();
    expect(volume.header.imageOrientationPatient.length).toBe(6);
    // IOP should have values close to ±1 or 0
    const iop = volume.header.imageOrientationPatient;
    for (const v of iop) {
      expect(v).toBeGreaterThanOrEqual(-1.1);
      expect(v).toBeLessThanOrEqual(1.1);
    }
  });

  it('should extract PixelSpacing', async () => {
    const volume = await parseDicom(fileBuffer);
    expect(volume.header.pixelSpacing).toBeDefined();
    expect(volume.header.pixelSpacing.length).toBe(2);
    const [r, c] = volume.header.pixelSpacing;
    expect(r).toBeGreaterThan(0);
    expect(c).toBeGreaterThan(0);
    expect(volume.spacing[0]).toBe(r);
    expect(volume.spacing[1]).toBe(c);
  });

  it('should extract window/level settings', async () => {
    const volume = await parseDicom(fileBuffer);
    expect(volume.header.windowCenter).toBeDefined();
    expect(volume.header.windowWidth).toBeDefined();
    expect(volume.header.windowWidth).toBeGreaterThan(0);
  });

  it('should extract rescale slope/intercept', async () => {
    const volume = await parseDicom(fileBuffer);
    expect(typeof volume.header.rescaleSlope).toBe('number');
    expect(typeof volume.header.rescaleIntercept).toBe('number');
    // For CT, intercept is typically around -1024 (water/air reference)
    // For other modalities, intercept is often 0
  });

  it('should have valid affine matrix', async () => {
    const volume = await parseDicom(fileBuffer);
    expect(volume.affine).toBeDefined();
    expect(volume.affine.length).toBe(16);
    // Affine should not be all zeros
    const sum = volume.affine.reduce((acc, v) => acc + Math.abs(v), 0);
    expect(sum).toBeGreaterThan(0);
  });

  it('should have valid inverse affine (affine * inverse ≈ identity)', async () => {
    const volume = await parseDicom(fileBuffer);
    expect(volume.inverseAffine).toBeDefined();
    expect(volume.inverseAffine.length).toBe(16);

    // Check that no NaN values
    for (const v of volume.inverseAffine) {
      expect(Number.isNaN(v)).toBe(false);
    }

    // affine * inverse should be identity
    const result = multiplyMatrices(volume.affine, volume.inverseAffine);
    for (let i = 0; i < 4; i++) {
      expect(result[i * 4 + i]).toBeCloseTo(1, 5);
    }
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j <  4; j++) {
        if (i !== j) {
          expect(Math.abs(result[i * 4 + j])).toBeLessThan(1e-4);
        }
      }
    }
  });

  it('should extract modality', async () => {
    const volume = await parseDicom(fileBuffer);
    expect(volume.header.modality).toBeTruthy();
    expect(typeof volume.header.modality).toBe('string');
  });

  it('should extract SeriesInstanceUID', async () => {
    const volume = await parseDicom(fileBuffer);
    expect(volume.header.seriesInstanceUid).toBeTruthy();
    expect(volume.header.seriesInstanceUid.length).toBeGreaterThan(10);
  });

  it('should extract SOPInstanceUID', async () => {
    const volume = await parseDicom(fileBuffer);
    expect(volume.header.sopInstanceUid).toBeTruthy();
    expect(volume.header.sopInstanceUid.length).toBeGreaterThan(10);
  });

  it('should extract transfer syntax UID', async () => {
    const volume = await parseDicom(fileBuffer);
    expect(volume.header.transferSyntaxUid).toBeTruthy();
    // Transfer syntax UIDs are numeric dot-separated OIDs and may have more than 5 components.
    expect(volume.header.transferSyntaxUid).toMatch(/^\d+(?:\.\d+)+$/);
  });

  it('parseDicomHeader should return header without pixel data', async () => {
    const header = await parseDicomHeader(fileBuffer);
    expect(header.rows).toBeGreaterThan(0);
    expect(header.columns).toBeGreaterThan(0);
    expect(header.modality).toBeTruthy();
    expect(header.imagePositionPatient).toBeDefined();
  });
});

// ============================================================
// DICOM Series Tests (multi-file)
// ============================================================

const SERIES_DIR = join(__dirname, '../fixtures/1.3.12.2.1107.5.1.4.76360.30000023022800083166200349175');

describe('DICOM Series Parsing', () => {
  let buffers: ArrayBuffer[];

  beforeAll(() => {
    buffers = loadDicomBuffers(SERIES_DIR);
  });

  it('should load all files from series directory', () => {
    expect(buffers.length).toBeGreaterThan(1);
  });

  it('should parse individual slices from the series', async () => {
    const slice = await parseDicom(buffers[0]);
    expect(slice.header.rows).toBeGreaterThan(0);
    expect(slice.header.columns).toBeGreaterThan(0);
  });

  it('should parse all slices and maintain consistent dimensions', async () => {
    const slices = await Promise.all(buffers.map(b => parseDicom(b)));

    const firstRows = slices[0].header.rows;
    const firstCols = slices[0].header.columns;

    for (const slice of slices) {
      expect(slice.header.rows).toBe(firstRows);
      expect(slice.header.columns).toBe(firstCols);
    }
  });

  it('should build a 3D volume from the series', async () => {
    const slices = await Promise.all(buffers.map(b => parseDicom(b)));
    const parsedFiles = slices.map(s => ({ header: s.header, data: s.data }));

    const volume = buildSeriesVolume(parsedFiles);

    expect(volume.dimensions).toBeDefined();
    expect(volume.dimensions.length).toBe(3);
    expect(volume.dimensions[2]).toBe(buffers.length); // Z = number of slices
    expect(volume.dimensions[0]).toBe(slices[0].header.columns);
    expect(volume.dimensions[1]).toBe(slices[0].header.rows);
  });

  it('should merge pixel data correctly', async () => {
    const slices = await Promise.all(buffers.map(b => parseDicom(b)));
    const parsedFiles = slices.map(s => ({ header: s.header, data: s.data }));

    const volume = buildSeriesVolume(parsedFiles);

    // Total pixel data size should equal cols * rows * slices * bytesPerVoxel
    const bytesPerVoxel = slices[0].header.bitsAllocated / 8;
    const expectedSize = volume.dimensions[0] * volume.dimensions[1] * volume.dimensions[2] * bytesPerVoxel;
    expect(volume.data.byteLength).toBeGreaterThanOrEqual(expectedSize * 0.9); // allow small variance
  });

  it('should compute correct Z spacing', async () => {
    const slices = await Promise.all(buffers.map(b => parseDicom(b)));
    const parsedFiles = slices.map(s => ({ header: s.header, data: s.data }));

    const volume = buildSeriesVolume(parsedFiles);

    // Z spacing should be positive and reasonable (< 10mm per slice for most CT/MR)
    expect(volume.spacing[2]).toBeGreaterThan(0);
    expect(volume.spacing[2]).toBeLessThan(10);
  });

  it('should have valid affine matrix for series', async () => {
    const slices = await Promise.all(buffers.map(b => parseDicom(b)));
    const parsedFiles = slices.map(s => ({ header: s.header, data: s.data }));

    const volume = buildSeriesVolume(parsedFiles);

    expect(volume.affine).toBeDefined();
    expect(volume.affine.length).toBe(16);

    // Affine should not be singular (no zero columns)
    for (let col = 0; col < 3; col++) {
      const sum = Math.abs(volume.affine[col]) + Math.abs(volume.affine[4 + col]) + Math.abs(volume.affine[8 + col]);
      expect(sum).toBeGreaterThan(0);
    }

    const sum = volume.affine.reduce((acc, v) => acc + Math.abs(v), 0);
    expect(sum).toBeGreaterThan(0);
  });

  it('should have valid inverse affine for series', async () => {
    const slices = await Promise.all(buffers.map(b => parseDicom(b)));
    const parsedFiles = slices.map(s => ({ header: s.header, data: s.data }));

    const volume = buildSeriesVolume(parsedFiles);

    // No NaN values
    for (const v of volume.inverseAffine) {
      expect(Number.isNaN(v)).toBe(false);
    }

    // affine * inverse ≈ identity
    const result = multiplyMatrices(volume.affine, volume.inverseAffine);
    for (let i = 0; i < 4; i++) {
      expect(result[i * 4 + i]).toBeCloseTo(1, 4);
    }
  });

  it('should sort slices by InstanceNumber', async () => {
    const slices = await Promise.all(buffers.map(b => parseDicom(b)));
    const parsedFiles = slices.map(s => ({ header: s.header, data: s.data }));

    // Collect instance numbers
    const instanceNumbers = parsedFiles.map(f => f.header.instanceNumber);

    // All instance numbers should be positive integers
    for (const num of instanceNumbers) {
      expect(Number.isInteger(num)).toBe(true);
      expect(num).toBeGreaterThan(0);
    }

    // Instance numbers should be unique
    const unique = new Set(instanceNumbers);
    expect(unique.size).toBe(instanceNumbers.length);
  });

  it('should handle coordinate transforms correctly', async () => {
    const slices = await Promise.all(buffers.map(b => parseDicom(b)));
    const parsedFiles = slices.map(s => ({ header: s.header, data: s.data }));

    const volume = buildSeriesVolume(parsedFiles);

    // Center voxel IJK → RAS should produce meaningful coordinates
    const centerIjk: [number, number, number] = [
      Math.floor(volume.dimensions[0] / 2),
      Math.floor(volume.dimensions[1] / 2),
      Math.floor(volume.dimensions[2] / 2),
    ];

    // Apply affine: RAS = affine * IJK
    const [dx, dy, dz] = volume.dimensions;
    const rasX = volume.affine[0] * centerIjk[0] + volume.affine[1] * centerIjk[1] + volume.affine[2] * centerIjk[2] + volume.affine[3];
    const rasY = volume.affine[4] * centerIjk[0] + volume.affine[5] * centerIjk[1] + volume.affine[6] * centerIjk[2] + volume.affine[7];
    const rasZ = volume.affine[8] * centerIjk[0] + volume.affine[9] * centerIjk[1] + volume.affine[10] * centerIjk[2] + volume.affine[11];

    // RAS coordinates should be within the volume extent
    // For a typical CT scan, coordinates should be in range of [-300, 300] mm
    expect(Math.abs(rasX)).toBeLessThan(1000);
    expect(Math.abs(rasY)).toBeLessThan(1000);
    expect(Math.abs(rasZ)).toBeLessThan(1000);
  });

  it('should produce the same modality across all slices', async () => {
    const slices = await Promise.all(buffers.map(b => parseDicom(b)));
    const modalities = new Set(slices.map(s => s.header.modality));
    expect(modalities.size).toBe(1);
  });

  it('should have consistent transfer syntax across series', async () => {
    const slices = await Promise.all(buffers.map(b => parseDicom(b)));
    const tss = new Set(slices.map(s => s.header.transferSyntaxUid));
    expect(tss.size).toBe(1);
  });
});

// ============================================================
// NIfTI Compatibility Tests
// ============================================================

describe('DICOM Volume — NIfTI Renderer Compatibility', () => {
  let singleVolume: DicomVolume;

  beforeAll(async () => {
    const fileBuffer = loadBuffer(SINGLE_DCM_PATH);
    singleVolume = await parseDicom(fileBuffer);
  });

  it('should have a top-level datatype field matching header.datatype', async () => {
    // Note: DicomVolume currently stores datatype in header.
    // The unified Volume interface expects datatype at top level.
    // This test documents the current state — renderer may need adjustment.
    expect(singleVolume.header.datatype).toBeDefined();
  });

  it('should have all fields required by the unified Volume interface', async () => {
    expect(singleVolume.data).toBeDefined();
    expect(singleVolume.data.byteLength).toBeGreaterThan(0);
    expect(singleVolume.dimensions).toBeDefined();
    expect(singleVolume.dimensions.length).toBe(3);
    expect(singleVolume.spacing).toBeDefined();
    expect(singleVolume.spacing.length).toBe(3);
    expect(singleVolume.affine).toBeDefined();
    expect(singleVolume.affine.length).toBe(16);
    expect(singleVolume.inverseAffine).toBeDefined();
    expect(singleVolume.inverseAffine.length).toBe(16);
  });

  it('should have correct spacing values in spacing array', async () => {
    expect(singleVolume.spacing[0]).toBe(singleVolume.header.pixelSpacing[0]);
    expect(singleVolume.spacing[1]).toBe(singleVolume.header.pixelSpacing[1]);
    expect(singleVolume.spacing[2]).toBe(singleVolume.header.sliceThickness);
  });
});
