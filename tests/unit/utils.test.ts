// Unit tests for utility functions

import { describe, it, expect } from 'vitest';
import {
  identityMatrix,
  multiplyMatrix,
  transposeMatrix,
  invertMatrix,
  swapEndianness,
  isLittleEndian,
  readCString,
  isGzipCompressed,
  getDataTypeSize
} from '@jsmedgl/parser-nifti/utils';

describe('Matrix Operations', () => {
  describe('identityMatrix', () => {
    it('should create 4x4 identity matrix', () => {
      const matrix = identityMatrix();

      expect(matrix).toHaveLength(16);
      expect(matrix[0]).toBe(1);
      expect(matrix[5]).toBe(1);
      expect(matrix[10]).toBe(1);
      expect(matrix[15]).toBe(1);

      // Check all other elements are 0
      const expected = [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
      ];
      expect(matrix).toEqual(expected);
    });
  });

  describe('multiplyMatrix', () => {
    it('should multiply two identity matrices', () => {
      const a = identityMatrix();
      const b = identityMatrix();
      const result = multiplyMatrix(a, b);

      expect(result).toEqual(identityMatrix());
    });

    it('should multiply matrix by identity', () => {
      const a = [
        2, 0, 0, 0,
        0, 2, 0, 0,
        0, 0, 2, 0,
        0, 0, 0, 2
      ];
      const b = identityMatrix();
      const result = multiplyMatrix(a, b);

      expect(result).toEqual(a);
    });

    it('should multiply scaling matrices correctly', () => {
      const a = [ // Scale by 2 in X
        2, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
      ];
      const b = [ // Scale by 3 in Y
        1, 0, 0, 0,
        0, 3, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
      ];
      const result = multiplyMatrix(a, b);

      const expected = [
        2, 0, 0, 0,
        0, 3, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
      ];
      expect(result).toEqual(expected);
    });

    it('should handle translation', () => {
      const translate = [ // Translate by (1, 2, 3)
        1, 0, 0, 1,
        0, 1, 0, 2,
        0, 0, 1, 3,
        0, 0, 0, 1
      ];
      const scale = [ // Scale by 2
        2, 0, 0, 0,
        0, 2, 0, 0,
        0, 0, 2, 0,
        0, 0, 0, 1
      ];
      const result = multiplyMatrix(translate, scale);

      // Result should have translation (1, 2, 3) * 2 and scale 2
      expect(result[0]).toBe(2);
      expect(result[5]).toBe(2);
      expect(result[10]).toBe(2);
      expect(result[3]).toBe(1);
      expect(result[7]).toBe(2);
      expect(result[11]).toBe(3);
    });
  });

  describe('transposeMatrix', () => {
    it('should transpose identity matrix', () => {
      const matrix = identityMatrix();
      const result = transposeMatrix(matrix);

      expect(result).toEqual(matrix);
    });

    it('should transpose matrix correctly', () => {
      const matrix = [
        1, 2, 3, 4,
        5, 6, 7, 8,
        9, 10, 11, 12,
        13, 14, 15, 16
      ];
      const result = transposeMatrix(matrix);

      const expected = [
        1, 5, 9, 13,
        2, 6, 10, 14,
        3, 7, 11, 15,
        4, 8, 12, 16
      ];
      expect(result).toEqual(expected);
    });

    it('should handle rotation matrix', () => {
      const rotation = [
        0, -1, 0, 0,
        1, 0, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
      ];
      const result = transposeMatrix(rotation);

      // Transpose of rotation is its inverse
      const expected = [
        0, 1, 0, 0,
        -1, 0, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
      ];
      expect(result).toEqual(expected);
    });
  });

  describe('invertMatrix', () => {
    it('should invert identity matrix', () => {
      const matrix = identityMatrix();
      const result = invertMatrix(matrix);

      expect(result).toEqual(matrix);
    });

    it('should invert scaling matrix', () => {
      const matrix = [
        2, 0, 0, 0,
        0, 3, 0, 0,
        0, 0, 4, 0,
        0, 0, 0, 1
      ];
      const result = invertMatrix(matrix);

      expect(result[0]).toBeCloseTo(0.5, 5);
      expect(result[5]).toBeCloseTo(1/3, 5);
      expect(result[10]).toBeCloseTo(0.25, 5);
    });

    it('should invert affine matrix with translation', () => {
      const matrix = [
        1, 0, 0, 10,
        0, 1, 0, 20,
        0, 0, 1, 30,
        0, 0, 0, 1
      ];
      const result = invertMatrix(matrix);

      // Inverse should have negative translation
      expect(result[3]).toBeCloseTo(-10, 5);
      expect(result[7]).toBeCloseTo(-20, 5);
      expect(result[11]).toBeCloseTo(-30, 5);
    });

    it('should invert combined scale and translation', () => {
      const matrix = [
        2, 0, 0, 10,
        0, 2, 0, 20,
        0, 0, 2, 30,
        0, 0, 0, 1
      ];
      const result = invertMatrix(matrix);

      // Inverse should scale by 0.5 and translate by (-5, -10, -15)
      expect(result[0]).toBeCloseTo(0.5, 5);
      expect(result[5]).toBeCloseTo(0.5, 5);
      expect(result[10]).toBeCloseTo(0.5, 5);
      expect(result[3]).toBeCloseTo(-5, 5);
      expect(result[7]).toBeCloseTo(-10, 5);
      expect(result[11]).toBeCloseTo(-15, 5);
    });

    it('should handle rotation matrix', () => {
      const matrix = [
        0, -1, 0, 0,
        1, 0, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
      ];
      const result = invertMatrix(matrix);

      // Inverse of rotation is its transpose
      expect(result[0]).toBeCloseTo(0, 5);
      expect(result[1]).toBeCloseTo(1, 5);
      expect(result[4]).toBeCloseTo(-1, 5);
      expect(result[5]).toBeCloseTo(0, 5);
    });

    it('should return identity when multiplying matrix by its inverse', () => {
      const matrix = [
        2, 0, 0, 10,
        0, 3, 0, 20,
        0, 0, 4, 30,
        0, 0, 0, 1
      ];
      const inverse = invertMatrix(matrix);
      const result = multiplyMatrix(matrix, inverse);

      // Result should be identity matrix
      for (let i = 0; i < 16; i++) {
        const expected = (i === 0 || i === 5 || i === 10 || i === 15) ? 1 : 0;
        expect(result[i]).toBeCloseTo(expected, 4);
      }
    });
  });
});

describe('Endianness Utilities', () => {
  describe('swapEndianness', () => {
    it('should swap 16-bit values', () => {
      const buffer = new ArrayBuffer(4);
      const view = new Uint16Array(buffer);
      view[0] = 0x1234;
      view[1] = 0xABCD;

      const swapped = swapEndianness(buffer, 2);
      const swappedView = new Uint16Array(swapped);

      expect(swappedView[0]).toBe(0x3412);
      expect(swappedView[1]).toBe(0xCDAB);
    });

    it('should swap 32-bit values', () => {
      const buffer = new ArrayBuffer(4);
      const view = new Uint32Array(buffer);
      view[0] = 0x12345678;

      const swapped = swapEndianness(buffer, 4);
      const swappedView = new Uint32Array(swapped);

      expect(swappedView[0]).toBe(0x78563412);
    });
  });

  describe('isLittleEndian', () => {
    it('should return boolean', () => {
      const result = isLittleEndian();
      expect(typeof result).toBe('boolean');
    });

    it('should be consistent', () => {
      const result1 = isLittleEndian();
      const result2 = isLittleEndian();
      expect(result1).toBe(result2);
    });
  });
});

describe('String Utilities', () => {
  describe('readCString', () => {
    it('should read null-terminated string', () => {
      const buffer = new ArrayBuffer(10);
      const view = new Uint8Array(buffer);
      view[0] = 'H'.charCodeAt(0);
      view[1] = 'e'.charCodeAt(0);
      view[2] = 'l'.charCodeAt(0);
      view[3] = 'l'.charCodeAt(0);
      view[4] = 'o'.charCodeAt(0);
      view[5] = 0; // Null terminator
      view[6] = 'W'.charCodeAt(0);

      const result = readCString(buffer, 0, 10);
      expect(result).toBe('Hello');
    });

    it('should read string without null terminator', () => {
      const buffer = new ArrayBuffer(5);
      const view = new Uint8Array(buffer);
      view[0] = 'T'.charCodeAt(0);
      view[1] = 'e'.charCodeAt(0);
      view[2] = 's'.charCodeAt(0);
      view[3] = 't'.charCodeAt(0);
      view[4] = '!'.charCodeAt(0);

      const result = readCString(buffer, 0, 5);
      expect(result).toBe('Test!');
    });

    it('should read empty string', () => {
      const buffer = new ArrayBuffer(5);
      const view = new Uint8Array(buffer);
      view[0] = 0; // Null at start

      const result = readCString(buffer, 0, 5);
      expect(result).toBe('');
    });
  });
});

describe('Compression Utilities', () => {
  describe('isGzipCompressed', () => {
    it('should detect gzip magic number', () => {
      const buffer = new ArrayBuffer(2);
      const view = new Uint8Array(buffer);
      view[0] = 0x1f; // gzip magic byte 1
      view[1] = 0x8b; // gzip magic byte 2

      const result = isGzipCompressed(buffer);
      expect(result).toBe(true);
    });

    it('should return false for non-gzip', () => {
      const buffer = new ArrayBuffer(2);
      const view = new Uint8Array(buffer);
      view[0] = 0x00;
      view[1] = 0x01;

      const result = isGzipCompressed(buffer);
      expect(result).toBe(false);
    });

    it('should return false for empty buffer', () => {
      const buffer = new ArrayBuffer(0);

      const result = isGzipCompressed(buffer);
      expect(result).toBe(false);
    });
  });
});

describe('Data Type Utilities', () => {
  describe('getDataTypeSize', () => {
    it('should return correct size for common types', () => {
      expect(getDataTypeSize(2)).toBe(1); // UINT8
      expect(getDataTypeSize(4)).toBe(2); // INT16
      expect(getDataTypeSize(8)).toBe(4); // INT32
      expect(getDataTypeSize(16)).toBe(4); // FLOAT32
      expect(getDataTypeSize(64)).toBe(8); // FLOAT64
      expect(getDataTypeSize(256)).toBe(1); // INT8
      expect(getDataTypeSize(512)).toBe(2); // UINT16
      expect(getDataTypeSize(768)).toBe(4); // UINT32
      expect(getDataTypeSize(1024)).toBe(8); // INT64
      expect(getDataTypeSize(1280)).toBe(8); // UINT64
    });

    it('should return 0 for unknown types', () => {
      expect(getDataTypeSize(0)).toBe(0); // UNKNOWN
      expect(getDataTypeSize(999)).toBe(0); // Invalid
    });
  });
});