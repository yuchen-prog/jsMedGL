// Tests for demo DICOM folder loading logic
// RED phase: These tests define the expected behavior for loading DICOM folders
// in the demo app. They should FAIL until the implementation is complete.

import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadDicomFolder } from '../../apps/demo/src/dicom-loader';

// Helper: read a real DICOM file into an ArrayBuffer
function loadBuffer(filePath: string): ArrayBuffer {
  const buffer = readFileSync(filePath);
  const bytes = new Uint8Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) bytes[i] = buffer[i];
  return bytes.buffer as ArrayBuffer;
}

const SERIES_DIR = join(__dirname, '../fixtures/1.3.12.2.1107.5.1.4.76360.30000023022800083166200349175');

describe('loadDicomFolder', () => {
  // We test with real File objects to simulate the browser FileList scenario.
  // In Node.js, we use the File constructor (available in Node 20+).
  let dicomFiles: File[];

  beforeAll(() => {
    const fileNames = readdirSync(SERIES_DIR)
      .filter(f => f.endsWith('.dcm'))
      .sort();

    dicomFiles = fileNames.map(name => {
      const buffer = readFileSync(join(SERIES_DIR, name));
      return new File([buffer], name, { type: 'application/dicom' });
    });
  });

  it('should parse all DICOM files from a File array and return a DicomVolume', async () => {
    const volume = await loadDicomFolder(dicomFiles);

    expect(volume).toBeDefined();
    expect(volume.dimensions).toHaveLength(3);
    expect(volume.dimensions[0]).toBeGreaterThan(0); // columns
    expect(volume.dimensions[1]).toBeGreaterThan(0); // rows
    expect(volume.dimensions[2]).toBe(dicomFiles.length); // Z = number of slices
  });

  it('should produce a volume with valid merged pixel data', async () => {
    const volume = await loadDicomFolder(dicomFiles);

    expect(volume.data.byteLength).toBeGreaterThan(0);
    // Total data should be roughly cols * rows * slices * bytesPerVoxel
    const bytesPerVoxel = volume.header.bitsAllocated / 8;
    const expectedSize = volume.dimensions[0] * volume.dimensions[1] * volume.dimensions[2] * bytesPerVoxel;
    expect(volume.data.byteLength).toBeGreaterThanOrEqual(expectedSize * 0.9);
  });

  it('should have valid spacing with computed Z spacing', async () => {
    const volume = await loadDicomFolder(dicomFiles);

    expect(volume.spacing).toHaveLength(3);
    expect(volume.spacing[0]).toBeGreaterThan(0);
    expect(volume.spacing[1]).toBeGreaterThan(0);
    expect(volume.spacing[2]).toBeGreaterThan(0);
    // Z spacing should be reasonable for CT (< 10mm per slice)
    expect(volume.spacing[2]).toBeLessThan(10);
  });

  it('should have valid affine and inverse affine matrices', async () => {
    const volume = await loadDicomFolder(dicomFiles);

    expect(volume.affine).toHaveLength(16);
    expect(volume.inverseAffine).toHaveLength(16);

    // No NaN values
    for (const v of volume.affine) {
      expect(Number.isNaN(v)).toBe(false);
    }
    for (const v of volume.inverseAffine) {
      expect(Number.isNaN(v)).toBe(false);
    }
  });

  it('should throw an error for empty file list', async () => {
    await expect(loadDicomFolder([])).rejects.toThrow();
  });

  it('should handle a single DICOM file', async () => {
    const singleFile = [dicomFiles[0]];
    const volume = await loadDicomFolder(singleFile);

    expect(volume).toBeDefined();
    expect(volume.dimensions[2]).toBe(1);
  });

  it('should extract modality from the DICOM files', async () => {
    const volume = await loadDicomFolder(dicomFiles);

    expect(volume.header.modality).toBeTruthy();
    expect(typeof volume.header.modality).toBe('string');
  });

  it('should apply DICOM window/level from header', async () => {
    const volume = await loadDicomFolder(dicomFiles);

    // Window width should be positive
    expect(volume.header.windowWidth).toBeGreaterThan(0);
    expect(typeof volume.header.windowCenter).toBe('number');
  });
});
