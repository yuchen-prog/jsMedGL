// DICOM Transfer Syntax detection and decoder selection

import { TRANSFER_SYNTAX } from './types';
import type { TransferSyntax } from './tag-reader';

/**
 * Detect Transfer Syntax from the File Meta Information.
 * Falls back to Implicit VR Little Endian if not found.
 */
export function detectTransferSyntax(
  elements: Map<string, unknown>
): { ts: TransferSyntax; tsUid: string } {
  // (0002,0010) Transfer Syntax UID
  const raw = elements.get('0002,0010');

  // Handle both raw strings and DicomElement objects
  let meta: unknown = raw;
  if (raw !== null && raw !== undefined && typeof raw === 'object' && 'value' in (raw as object)) {
    meta = (raw as { value: unknown }).value;
  }

  if (typeof meta === 'string' && meta.trim()) {
    const uid = meta.trim();
    const ts = mapUidToTS(uid);
    return { ts, tsUid: uid };
  }

  // Fallback: assume most common format
  return { ts: 'implicit-le', tsUid: TRANSFER_SYNTAX.IMPLICIT_VR_LE };
}

/**
 * Map a Transfer Syntax UID to internal transfer syntax type.
 */
export function mapUidToTS(uid: string): TransferSyntax {
  switch (uid) {
    case TRANSFER_SYNTAX.IMPLICIT_VR_LE:
      return 'implicit-le';
    case TRANSFER_SYNTAX.EXPLICIT_VR_LE:
      return 'explicit-le';
    case TRANSFER_SYNTAX.EXPLICIT_VR_BE:
      return 'explicit-be';
    case TRANSFER_SYNTAX.DEFLATE:
      // Deflate uses implicit LE after decompression
      return 'implicit-le';
    default:
      // Unknown — treat as implicit LE (most compatible)
      return 'implicit-le';
  }
}

/**
 * Check if a Transfer Syntax is supported for decoding.
 */
export function isSupportedTransferSyntax(uid: string): boolean {
  return uid === TRANSFER_SYNTAX.IMPLICIT_VR_LE ||
         uid === TRANSFER_SYNTAX.EXPLICIT_VR_LE ||
         uid === TRANSFER_SYNTAX.EXPLICIT_VR_BE ||
         uid === TRANSFER_SYNTAX.DEFLATE;
}

/**
 * Check if a Transfer Syntax requires decompression.
 */
export function needsDecompression(uid: string): boolean {
  return uid === TRANSFER_SYNTAX.DEFLATE;
}

/**
 * Decompress a DICOM Deflate (zlib) compressed buffer.
 * Uses the browser's native DecompressionStream API.
 */
export async function decompressDeflate(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new DecompressionStream('deflate');
  const reader = stream.readable.getReader();
  const writer = stream.writable.getWriter();

  const chunks: Uint8Array[] = [];

  // Write the compressed data
  const input = new Uint8Array(buffer);
  const result = await writer.write(input);
  void result;
  await writer.close();

  // Read decompressed data
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  // Concatenate all chunks
  const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
  const result2 = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result2.set(chunk, offset);
    offset += chunk.length;
  }

  return result2.buffer;
}
