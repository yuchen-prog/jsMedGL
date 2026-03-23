// Decompression utilities for NIfTI files

export { isGzipCompressed } from './utils';

/**
 * Decompress gzip data using native browser API
 */
export async function decompressGzip(data: ArrayBuffer): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream not available in this environment');
  }

  const uint8Data = new Uint8Array(data);

  // Detect compression format
  const format = detectGzipFormat(uint8Data);

  // Create decompression stream
  const stream = new DecompressionStream(format);

  // Wrap in a response to use the stream
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(uint8Data);
        controller.close();
      }
    }).pipeThrough(stream)
  );

  return response.arrayBuffer();
}

/**
 * Detect gzip format variant
 */
function detectGzipFormat(data: Uint8Array): 'gzip' | 'deflate' | 'deflate-raw' {
  if (data[0] === 0x1f && data[1] === 0x8b) {
    return 'gzip';
  }

  if ((data[0] & 0x0F) === 0x08 && (data[0] >> 4) <= 7) {
    return 'deflate';
  }

  return 'deflate-raw';
}
