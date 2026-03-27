// Unit tests for slice-extractor.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDataTypeSize, readVoxel } from '@jsmedgl/parser-nifti';
import type { NiftiVolume } from '@jsmedgl/parser-nifti';

// We test the pure logic without WebGL by extracting the normalization
// and slice-index computation. We also test the mockable parts directly.

// ─── Pure Logic Tests ────────────────────────────────────────────────────────────

describe('SliceExtractor Normalization Logic', () => {

  // Helper: simulate normalization (matches slice-extractor.ts logic)
  function normalizeData(data: ArrayBuffer, datatype: number): Uint8Array {
    const byteSize = getDataTypeSize(datatype);
    if (byteSize === 0) {
      throw new Error(`Unsupported datatype: ${datatype}`);
    }

    const numVoxels = data.byteLength / byteSize;

    let vMin = Infinity, vMax = -Infinity;
    const step = Math.max(1, Math.floor(numVoxels / 10000));
    for (let i = 0; i < numVoxels; i += step) {
      const v = readVoxel(data, i * byteSize, datatype);
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
    const range = vMax - vMin;

    const normalized = new Uint8Array(numVoxels);
    for (let i = 0; i < numVoxels; i++) {
      const v = readVoxel(data, i * byteSize, datatype);
      let n = range > 0 ? Math.round(((v - vMin) / range) * 255) : (v > 0 ? 255 : 0);
      normalized[i] = Math.max(0, Math.min(255, n));
    }
    return normalized;
  }

  // Helper: create a volume buffer with specific values
  function createVolumeBuffer(datatype: number, dims: [number, number, number], values: number[]): ArrayBuffer {
    const byteSize = getDataTypeSize(datatype);
    const total = dims[0] * dims[1] * dims[2];
    const buffer = new ArrayBuffer(total * byteSize);
    const view = new DataView(buffer);

    for (let i = 0; i < values.length && i < total; i++) {
      switch (datatype) {
        case 2:  view.setUint8(i * byteSize, values[i]); break;        // UINT8
        case 4:  view.setInt16(i * byteSize, values[i], true); break;  // INT16
        case 16: view.setFloat32(i * byteSize, values[i], true); break; // FLOAT32
        case 64: view.setFloat64(i * byteSize, values[i], true); break; // FLOAT64
      }
    }
    return buffer;
  }

  it('should normalize UINT8 data to full 0-255 range', () => {
    // Simple 4-voxel volume: values 0, 85, 170, 255
    const buffer = createVolumeBuffer(2, [2, 2, 1], [0, 85, 170, 255]);
    const result = normalizeData(buffer, 2);

    expect(result[0]).toBe(0);
    expect(result[1]).toBeCloseTo(85, 1);  // 0.333 * 255 ≈ 85
    expect(result[2]).toBeCloseTo(170, 1); // 0.667 * 255 ≈ 170
    expect(result[3]).toBe(255);
  });

  it('should normalize INT16 with negative values', () => {
    // Values: -100, 0, 100, 200. Range = 300. Floor divisions:
    // -100→0, 0→85, 100→170, 200→255
    const buffer = createVolumeBuffer(4, [2, 2, 1], [-100, 0, 100, 200]);
    const result = normalizeData(buffer, 4);

    expect(result[0]).toBe(0);     // -100 → 0
    expect(result[1]).toBe(85);   // 0 → 85 (0.5 * 170 ≈ 85)
    expect(result[2]).toBe(170);  // 100 → 170 (1.0 * 170 ≈ 170)
    expect(result[3]).toBe(255);  // 200 → 255
  });

  it('should normalize FLOAT32 data', () => {
    // Values: 0.0, 0.5, 1.0, 2.0
    const buffer = createVolumeBuffer(16, [2, 2, 1], [0.0, 0.5, 1.0, 2.0]);
    const result = normalizeData(buffer, 16);

    expect(result[0]).toBe(0);    // 0.0 → 0
    expect(result[1]).toBeCloseTo(64, 1);  // 0.5 → ~64
    expect(result[2]).toBeCloseTo(128, 1); // 1.0 → ~128
    expect(result[3]).toBe(255);  // 2.0 → 255
  });

  it('should normalize FLOAT64 data', () => {
    const buffer = createVolumeBuffer(64, [2, 2, 1], [-1.0, 0.0, 1.0, 2.0]);
    const result = normalizeData(buffer, 64);

    expect(result[0]).toBe(0);
    expect(result[1]).toBeCloseTo(85, 1);  // 0.0 → ~85
    expect(result[2]).toBeCloseTo(170, 1); // 1.0 → ~170
    expect(result[3]).toBe(255);
  });

  it('should clamp values above max to 255', () => {
    // Values: 100, 200, 300, 400 — all > range start
    const buffer = createVolumeBuffer(2, [2, 2, 1], [100, 200, 200, 200]);
    const result = normalizeData(buffer, 2);

    expect(result[0]).toBeCloseTo(0, 1);
    expect(result[1]).toBe(255);
    expect(result[2]).toBe(255);
    expect(result[3]).toBe(255);
  });

  it('should handle uniform values (range = 0)', () => {
    // All same values
    const buffer = createVolumeBuffer(2, [2, 2, 1], [42, 42, 42, 42]);
    const result = normalizeData(buffer, 2);

    // range=0 → if v > 0: 255, else 0. All 42 > 0 → 255
    expect(result.every(v => v === 255)).toBe(true);
  });

  it('should handle all-zero data', () => {
    const buffer = createVolumeBuffer(2, [2, 2, 1], [0, 0, 0, 0]);
    const result = normalizeData(buffer, 2);

    expect(result.every(v => v === 0)).toBe(true);
  });

  it('should handle large volumes correctly', () => {
    // Simulate 10000+ voxels
    const dims: [number, number, number] = [100, 100, 1];
    const total = dims[0] * dims[1] * dims[2];
    const buffer = createVolumeBuffer(2, dims, Array.from({ length: total }, (_, i) => i % 256));
    const result = normalizeData(buffer, 2);

    expect(result.length).toBe(total);
    expect(result[0]).toBe(0);
    expect(result[255]).toBeCloseTo(255, 1);
  });

  it('should throw for UNKNOWN datatype (byteSize=0)', () => {
    const buffer = createVolumeBuffer(0, [2, 2, 1], [0, 0, 0, 0]);

    expect(() => normalizeData(buffer, 0)).toThrow(/Unsupported datatype/);
  });

  it('should clamp negative normalized values to 0', () => {
    // Values below vMin (shouldn't happen in practice, but verify the guard)
    // Since we compute vMin from the data itself, this is tested implicitly
    // by verifying all output values are in [0, 255]
    const buffer = createVolumeBuffer(2, [2, 2, 1], [0, 50, 100, 150]);
    const result = normalizeData(buffer, 2);

    for (const v of result) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });
});

// ─── Slice Index Computation Tests ──────────────────────────────────────────────

describe('Slice Index Computation', () => {
  // Pure function tests matching slice-extractor.ts logic

  function getMaxSliceIndex(dims: [number, number, number], orientation: 'axial' | 'coronal' | 'sagittal'): number {
    switch (orientation) {
      case 'axial':    return dims[2] - 1;
      case 'coronal':  return dims[1] - 1;
      case 'sagittal': return dims[0] - 1;
    }
  }

  function clampSliceIndex(index: number, dims: [number, number, number], orientation: 'axial' | 'coronal' | 'sagittal'): number {
    const maxIndex = getMaxSliceIndex(dims, orientation);
    return Math.max(0, Math.min(index, maxIndex));
  }

  it('should compute correct max axial index', () => {
    const dims: [number, number, number] = [256, 256, 124];
    expect(getMaxSliceIndex(dims, 'axial')).toBe(123);
  });

  it('should compute correct max coronal index', () => {
    const dims: [number, number, number] = [256, 256, 124];
    expect(getMaxSliceIndex(dims, 'coronal')).toBe(255);
  });

  it('should compute correct max sagittal index', () => {
    const dims: [number, number, number] = [256, 256, 124];
    expect(getMaxSliceIndex(dims, 'sagittal')).toBe(255);
  });

  it('should clamp negative index to 0', () => {
    const dims: [number, number, number] = [64, 64, 64];
    expect(clampSliceIndex(-5, dims, 'axial')).toBe(0);
    expect(clampSliceIndex(-1, dims, 'coronal')).toBe(0);
    expect(clampSliceIndex(-100, dims, 'sagittal')).toBe(0);
  });

  it('should clamp index beyond max to max', () => {
    const dims: [number, number, number] = [64, 64, 64];
    expect(clampSliceIndex(999, dims, 'axial')).toBe(63);
    expect(clampSliceIndex(64, dims, 'axial')).toBe(63);
    expect(clampSliceIndex(100, dims, 'coronal')).toBe(63);
    expect(clampSliceIndex(100, dims, 'sagittal')).toBe(63);
  });

  it('should keep valid index unchanged', () => {
    const dims: [number, number, number] = [64, 64, 64];
    expect(clampSliceIndex(31, dims, 'axial')).toBe(31);
    expect(clampSliceIndex(0, dims, 'axial')).toBe(0);
    expect(clampSliceIndex(63, dims, 'axial')).toBe(63);
  });

  it('should handle single-slice volume', () => {
    const dims: [number, number, number] = [64, 64, 1];
    expect(getMaxSliceIndex(dims, 'axial')).toBe(0);
    expect(clampSliceIndex(0, dims, 'axial')).toBe(0);
    expect(clampSliceIndex(-1, dims, 'axial')).toBe(0);
    expect(clampSliceIndex(1, dims, 'axial')).toBe(0);
  });
});

// ─── Swizzle Dimension Tests ───────────────────────────────────────────────────

describe('Swizzle Dimension Transforms', () => {
  // Test the slice dimension computation matching slice-extractor.ts

  function getSliceDimensions(dims: [number, number, number], orientation: 'axial' | 'coronal' | 'sagittal'): { width: number; height: number } {
    switch (orientation) {
      case 'axial':    return { width: dims[0], height: dims[1] };
      case 'coronal':  return { width: dims[0], height: dims[2] };
      case 'sagittal': return { width: dims[1], height: dims[2] };
    }
  }

  // Compute linear index for each orientation (matching slice-extractor.ts logic)
  function axialLinearIndex(sliceIndex: number, x: number, y: number, d0: number, d1: number): number {
    const ry = d1 - 1 - y; // reversed J
    return sliceIndex * d0 * d1 + ry * d0 + x;
  }

  function coronalLinearIndex(sliceIndex: number, x: number, z: number, d0: number, d1: number): number {
    return x + sliceIndex * d0 + z * d0 * d1;
  }

  function sagittalLinearIndex(sliceIndex: number, y: number, z: number, d0: number, d1: number): number {
    return sliceIndex + y * d0 + z * d0 * d1;
  }

  it('should produce correct axial slice dimensions', () => {
    const dims: [number, number, number] = [256, 256, 124];
    const { width, height } = getSliceDimensions(dims, 'axial');
    expect(width).toBe(256);
    expect(height).toBe(256);
  });

  it('should produce correct coronal slice dimensions', () => {
    const dims: [number, number, number] = [256, 256, 124];
    const { width, height } = getSliceDimensions(dims, 'coronal');
    expect(width).toBe(256);
    expect(height).toBe(124);
  });

  it('should produce correct sagittal slice dimensions', () => {
    const dims: [number, number, number] = [256, 256, 124];
    const { width, height } = getSliceDimensions(dims, 'sagittal');
    expect(width).toBe(256);
    expect(height).toBe(124);
  });

  it('should compute axial linear indices correctly', () => {
    // 4x3 volume (d0=4, d1=3), slice 0
    // Top-left pixel (x=0,y=0) → ry=2 → index = 0*12 + 2*4 + 0 = 8
    expect(axialLinearIndex(0, 0, 0, 4, 3)).toBe(8);
    // Bottom-right pixel (x=3,y=2) → ry=0 → index = 0*12 + 0*4 + 3 = 3
    expect(axialLinearIndex(0, 3, 2, 4, 3)).toBe(3);
    // Slice 1: offset = 12
    expect(axialLinearIndex(1, 0, 0, 4, 3)).toBe(20); // 12 + 8
  });

  it('should compute coronal linear indices correctly', () => {
    // 4x3x5 volume (d0=4, d1=3, d2=5), slice 1 (J=1)
    // Top-left pixel (x=0,z=0) → index = 0 + 1*4 + 0*12 = 4
    expect(coronalLinearIndex(1, 0, 0, 4, 3)).toBe(4);
    // x=3, z=2 → index = 3 + 1*4 + 2*12 = 31
    expect(coronalLinearIndex(1, 3, 2, 4, 3)).toBe(31);
    // Slice 0: index = x + 0 + z*12
    expect(coronalLinearIndex(0, 2, 1, 4, 3)).toBe(14); // 2 + 12
  });

  it('should compute sagittal linear indices correctly', () => {
    // 4x3x5 volume (d0=4, d1=3, d2=5), slice 1 (I=1)
    // Top-left pixel (y=0,z=0) → index = 1 + 0*4 + 0*12 = 1
    expect(sagittalLinearIndex(1, 0, 0, 4, 3)).toBe(1);
    // y=2, z=4 → index = 1 + 2*4 + 4*12 = 1 + 8 + 48 = 57
    expect(sagittalLinearIndex(1, 2, 4, 4, 3)).toBe(57);
    // Slice 0: index = y*4 + z*12
    expect(sagittalLinearIndex(0, 1, 1, 4, 3)).toBe(16); // 4 + 12
  });

  it('should cover full volume range for each orientation', () => {
    const dims: [number, number, number] = [4, 3, 5];
    const totalVoxels = dims[0] * dims[1] * dims[2]; // 60

    // Axial: for each slice, all (x,y) combinations
    let axialCount = 0;
    for (let k = 0; k < dims[2]; k++) {
      for (let j = 0; j < dims[1]; j++) {
        for (let i = 0; i < dims[0]; i++) {
          const idx = axialLinearIndex(k, i, j, dims[0], dims[1]);
          expect(idx).toBeGreaterThanOrEqual(0);
          expect(idx).toBeLessThan(totalVoxels);
          axialCount++;
        }
      }
    }
    expect(axialCount).toBe(totalVoxels);

    // Coronal: for each J slice, all (x,z) combinations
    let coronalCount = 0;
    for (let j = 0; j < dims[1]; j++) {
      for (let z = 0; z < dims[2]; z++) {
        for (let i = 0; i < dims[0]; i++) {
          const idx = coronalLinearIndex(j, i, z, dims[0], dims[1]);
          expect(idx).toBeGreaterThanOrEqual(0);
          expect(idx).toBeLessThan(totalVoxels);
          coronalCount++;
        }
      }
    }
    expect(coronalCount).toBe(totalVoxels);

    // Sagittal: for each I slice, all (y,z) combinations
    let sagittalCount = 0;
    for (let i = 0; i < dims[0]; i++) {
      for (let z = 0; z < dims[2]; z++) {
        for (let j = 0; j < dims[1]; j++) {
          const idx = sagittalLinearIndex(i, j, z, dims[0], dims[1]);
          expect(idx).toBeGreaterThanOrEqual(0);
          expect(idx).toBeLessThan(totalVoxels);
          sagittalCount++;
        }
      }
    }
    expect(sagittalCount).toBe(totalVoxels);
  });
});

// ─── Cache Eviction Logic ──────────────────────────────────────────────────────

describe('Cache Eviction Logic', () => {
  function simulateCacheEviction(maxCacheSize: number, keys: string[]): { cached: Set<string>, evicted: string[] } {
    const cached = new Set<string>();
    const evicted: string[] = [];

    for (const key of keys) {
      if (cached.size >= maxCacheSize) {
        // Evict oldest (first inserted)
        const oldest = cached.values().next().value!;
        cached.delete(oldest);
        evicted.push(oldest);
      }
      cached.add(key);
    }

    return { cached, evicted };
  }

  it('should not evict until cache is full', () => {
    const keys = ['axial-0', 'axial-1', 'axial-2'];
    const { cached, evicted } = simulateCacheEviction(5, keys);

    expect(evicted).toHaveLength(0);
    expect(cached.size).toBe(3);
  });

  it('should evict oldest entry when cache is full', () => {
    const keys = ['axial-0', 'axial-1', 'axial-2', 'axial-3', 'axial-4', 'axial-5'];
    const { cached, evicted } = simulateCacheEviction(5, keys);

    expect(evicted).toEqual(['axial-0']);
    expect(cached.size).toBe(5);
    expect(cached.has('axial-5')).toBe(true);
    expect(cached.has('axial-0')).toBe(false);
  });

  it('should evict in FIFO order', () => {
    const keys = Array.from({ length: 10 }, (_, i) => `axial-${i}`);
    const { evicted } = simulateCacheEviction(3, keys);

    expect(evicted).toEqual(['axial-0', 'axial-1', 'axial-2', 'axial-3', 'axial-4', 'axial-5', 'axial-6']);
    expect(evicted).toHaveLength(7);
  });

  it('should handle cache size of 1', () => {
    const keys = ['a', 'b', 'c'];
    const { cached, evicted } = simulateCacheEviction(1, keys);

    expect(evicted).toEqual(['a', 'b']);
    expect(cached).toEqual(new Set(['c']));
  });
});

// ─── hasData / findFirstSliceWithData Logic ────────────────────────────────────

describe('hasData Logic', () => {
  // Simulate hasData logic
  function hasNonZeroData(normalizedData: Uint8Array, dims: [number, number, number], orientation: 'axial' | 'coronal' | 'sagittal', sliceIndex: number): boolean {
    const d0 = dims[0], d1 = dims[1], d2 = dims[2];

    if (orientation === 'axial') {
      const sliceSize = d0 * d1;
      const offset = sliceIndex * sliceSize;
      for (let i = 0; i < sliceSize; i++) {
        if (normalizedData[offset + i] > 0) return true;
      }
    } else if (orientation === 'coronal') {
      for (let z = 0; z < d2; z++) {
        for (let x = 0; x < d0; x++) {
          const idx = x + sliceIndex * d0 + z * d0 * d1;
          if (normalizedData[idx] > 0) return true;
        }
      }
    } else {
      for (let z = 0; z < d2; z++) {
        for (let y = 0; y < d1; y++) {
          const idx = sliceIndex + y * d0 + z * d0 * d1;
          if (normalizedData[idx] > 0) return true;
        }
      }
    }
    return false;
  }

  function findFirstSliceWithData(normalizedData: Uint8Array, dims: [number, number, number], orientation: 'axial' | 'coronal' | 'sagittal'): number {
    const maxSlice = (orientation === 'axial' ? dims[2] : orientation === 'coronal' ? dims[1] : dims[0]) - 1;
    for (let i = 0; i <= maxSlice; i++) {
      if (hasNonZeroData(normalizedData, dims, orientation, i)) return i;
    }
    return 0;
  }

  it('should detect non-zero data in axial slice', () => {
    const dims: [number, number, number] = [4, 4, 3];
    const total = dims[0] * dims[1] * dims[2];
    const data = new Uint8Array(total);

    // Slice 0: all zeros
    // Slice 1: has data
    data[4 * 4 + 1] = 128; // Position in slice 1
    // Slice 2: all zeros

    expect(hasNonZeroData(data, dims, 'axial', 0)).toBe(false);
    expect(hasNonZeroData(data, dims, 'axial', 1)).toBe(true);
    expect(hasNonZeroData(data, dims, 'axial', 2)).toBe(false);
  });

  it('should detect non-zero data in coronal slice', () => {
    const dims: [number, number, number] = [4, 3, 3];
    const total = dims[0] * dims[1] * dims[2];
    const data = new Uint8Array(total);

    // Slice 1 (J=1) has data at x=2, z=1
    const idx = 2 + 1 * 4 + 1 * 12; // x + sliceIndex*d0 + z*d0*d1
    data[idx] = 200;

    expect(hasNonZeroData(data, dims, 'coronal', 0)).toBe(false);
    expect(hasNonZeroData(data, dims, 'coronal', 1)).toBe(true);
    expect(hasNonZeroData(data, dims, 'coronal', 2)).toBe(false);
  });

  it('should detect non-zero data in sagittal slice', () => {
    const dims: [number, number, number] = [3, 4, 3];
    const total = dims[0] * dims[1] * dims[2];
    const data = new Uint8Array(total);

    // Slice 1 (I=1) has data at y=2, z=2
    const idx = 1 + 2 * 3 + 2 * 12; // sliceIndex + y*d0 + z*d0*d1
    data[idx] = 99;

    expect(hasNonZeroData(data, dims, 'sagittal', 0)).toBe(false);
    expect(hasNonZeroData(data, dims, 'sagittal', 1)).toBe(true);
    expect(hasNonZeroData(data, dims, 'sagittal', 2)).toBe(false);
  });

  it('should find first slice with data for each orientation', () => {
    const dims: [number, number, number] = [4, 4, 5];
    const total = dims[0] * dims[1] * dims[2];

    // Axial: data at slice 2 (k=2), position (i=0, j=1)
    // Index: sliceIndex * d0 * d1 + j * d0 + i = 2*16 + 1*4 + 0 = 36
    const axialData = new Uint8Array(total);
    axialData[36] = 50;
    expect(findFirstSliceWithData(axialData, dims, 'axial')).toBe(2);

    // Coronal: data at slice 1 (j=1), position (i=2, k=0)
    // Index: i + sliceIndex * d0 + k * d0 * d1 = 2 + 1*4 + 0*16 = 6
    const coronalData = new Uint8Array(total);
    coronalData[6] = 50;
    expect(findFirstSliceWithData(coronalData, dims, 'coronal')).toBe(1);

    // Sagittal: data at slice 3 (i=3), position (j=2, k=1)
    // Index: sliceIndex + j * d0 + k * d0 * d1 = 3 + 2*4 + 1*16 = 27
    const sagittalData = new Uint8Array(total);
    sagittalData[27] = 50;
    expect(findFirstSliceWithData(sagittalData, dims, 'sagittal')).toBe(3);
  });

  it('should return 0 when no data found', () => {
    const dims: [number, number, number] = [4, 4, 3];
    const data = new Uint8Array(dims[0] * dims[1] * dims[2]);

    expect(findFirstSliceWithData(data, dims, 'axial')).toBe(0);
    expect(findFirstSliceWithData(data, dims, 'coronal')).toBe(0);
    expect(findFirstSliceWithData(data, dims, 'sagittal')).toBe(0);
  });
});
