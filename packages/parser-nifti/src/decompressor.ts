// Decompression utilities for NIfTI files

import pako from 'pako';

export { isGzipCompressed } from './utils';

/**
 * Decompress gzip data using pako (works in both browser and Node.js)
 */
export function decompressGzip(data: ArrayBuffer): ArrayBuffer {
  const uint8Data = new Uint8Array(data);
  const decompressed = pako.ungzip(uint8Data);
  return decompressed.buffer as ArrayBuffer;
}
