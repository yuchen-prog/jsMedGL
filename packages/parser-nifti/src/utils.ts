// Utility functions for NIfTI parsing

/**
 * Convert endianness
 */
export function swapEndianness(buffer: ArrayBuffer, dataSize: number): ArrayBuffer {
  const view = new Uint8Array(buffer);
  const swapped = new Uint8Array(buffer.byteLength);

  for (let i = 0; i < buffer.byteLength; i += dataSize) {
    for (let j = 0; j < dataSize; j++) {
      swapped[i + j] = view[i + dataSize - 1 - j];
    }
  }

  return swapped.buffer;
}

/**
 * Check if system is little endian
 */
export function isLittleEndian(): boolean {
  const buffer = new ArrayBuffer(2);
  const view = new Uint8Array(buffer);
  const int16 = new Int16Array(buffer);
  int16[0] = 1;
  return view[0] === 1;
}

/**
 * Read string from buffer (null-terminated)
 */
export function readCString(buffer: ArrayBuffer, offset: number, maxLength: number): string {
  const view = new Uint8Array(buffer);
  let end = offset;
  while (end < offset + maxLength && view[end] !== 0) {
    end++;
  }
  const bytes = view.slice(offset, end);
  return new TextDecoder('ascii').decode(bytes);
}

/**
 * Detect if data is gzip compressed
 */
export function isGzipCompressed(data: ArrayBuffer): boolean {
  const view = new Uint8Array(data);
  return view[0] === 0x1f && view[1] === 0x8b;
}

/**
 * Get size of data type in bytes
 */
export function getDataTypeSize(datatype: number): number {
  const sizes: Record<number, number> = {
    0: 0,   // UNKNOWN
    1: 1,   // BINARY
    2: 1,   // UINT8
    4: 2,   // INT16
    8: 4,   // INT32
    16: 4,  // FLOAT32
    64: 8,  // FLOAT64
    256: 1, // INT8
    512: 2, // UINT16
    768: 4, // UINT32
    1024: 8, // INT64
    1280: 8, // UINT64
    128: 3, // RGB24
    2304: 4, // RGBA32
  };
  return sizes[datatype] || 0;
}

/**
 * Create identity matrix (4x4)
 */
export function identityMatrix(): number[] {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ];
}

/**
 * Multiply two 4x4 matrices
 */
export function multiplyMatrix(a: number[], b: number[]): number[] {
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

/**
 * Transpose a 4x4 matrix
 */
export function transposeMatrix(m: number[]): number[] {
  return [
    m[0], m[4], m[8], m[12],
    m[1], m[5], m[9], m[13],
    m[2], m[6], m[10], m[14],
    m[3], m[7], m[11], m[15]
  ];
}

/**
 * Invert a 4x4 matrix
 */
export function invertMatrix(m: number[]): number[] {
  const result = new Array(16).fill(0);
  const temp = new Array(16).fill(0);

  for (let i = 0; i < 4; i++) {
    result[i * 4 + i] = 1;
  }

  for (let i = 0; i < 16; i++) {
    temp[i] = m[i];
  }

  for (let i = 0; i < 4; i++) {
    let pivot = i;
    for (let j = i + 1; j < 4; j++) {
      if (Math.abs(temp[j * 4 + i]) > Math.abs(temp[pivot * 4 + i])) {
        pivot = j;
      }
    }

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

    const pivotVal = temp[i * 4 + i];
    for (let j = 0; j < 4; j++) {
      temp[i * 4 + j] /= pivotVal;
      result[i * 4 + j] /= pivotVal;
    }

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
