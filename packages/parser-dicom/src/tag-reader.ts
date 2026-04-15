// DICOM Tag Reader — DICOM Part 5 Section 7

import type { DicomElement, DicomTag } from './types';
import { lookupVR, readFixedString } from './utils';

export type TransferSyntax = 'implicit-le' | 'explicit-le' | 'explicit-be';

export interface ReadElementsOptions {
  /** Skip elements from this group number entirely */
  skipGroup?: number;
  /** Only parse elements from this group number (stop when group changes) */
  onlyGroup?: number;
}

/**
 * Parse all DICOM elements from a buffer.
 * Returns a Map keyed by "GGGG,EEEE" string for O(1) lookup.
 *
 * @param buffer       - DICOM file buffer
 * @param ts           - Transfer syntax for data elements
 * @param options      - Optional: { skipGroup } to skip a group, { onlyGroup } to parse only one group
 */
export function readElements(
  buffer: ArrayBuffer,
  ts: TransferSyntax,
  options?: ReadElementsOptions
): Map<string, DicomElement> {
  const elements = new Map<string, DicomElement>();
  const dv = new DataView(buffer);
  let offset = 0;

  // Skip preamble (128 bytes) + "DICM" (4 bytes) if present
  if (buffer.byteLength >= 132) {
    const magic = new Uint8Array(buffer, 128, 4);
    if (magic[0] === 0x44 && magic[1] === 0x49 && magic[2] === 0x43 && magic[3] === 0x4D) {
      offset = 132;
    }
  }

  // Track whether we are in the meta group (0002) to determine VR encoding.
  // DICOM Part 10 says meta group uses Implicit VR LE, but many real-world files
  // encode it as Explicit VR LE. We auto-detect by checking if the bytes at
  // offset+4 look like a 2-char ASCII VR code.
  let inMetaGroup = true;
  let metaIsExplicit = false;

  while (offset + 4 <= buffer.byteLength) {
    const group = dv.getUint16(offset, true);
    const element = dv.getUint16(offset + 2, true);
    const tagKey = `${group.toString(16).toUpperCase().padStart(4, '0')},${element.toString(16).toUpperCase().padStart(4, '0')}`;

    // Exit meta group when we see a non-0002 group
    if (inMetaGroup && group !== 0x0002) {
      inMetaGroup = false;
    }

    // Stop parsing if onlyGroup was specified and we've moved past it
    if (options?.onlyGroup !== undefined && group !== options.onlyGroup) {
      break;
    }

    // Skip elements from the specified group
    if (options?.skipGroup !== undefined && group === options.skipGroup) {
      // We still need to skip past this element to continue parsing
      // Detect VR encoding for skipped elements
      const b4 = new Uint8Array(buffer, offset + 4, 1)[0];
      const b5 = new Uint8Array(buffer, offset + 5, 1)[0];
      const looksLikeVR = (b4 >= 0x41 && b4 <= 0x5A) && (b5 >= 0x41 && b5 <= 0x5A);
      if (looksLikeVR) {
        const vrStr = new TextDecoder('ascii').decode(new Uint8Array(buffer, offset + 4, 2));
        const isLongForm = ['OB','OD','OF','OL','OW','SQ','UC','UN','UR','UT'].includes(vrStr);
        if (isLongForm) {
          if (offset + 12 > buffer.byteLength) break;
          const len = dv.getUint32(offset + 8, true);
          if (len === 0xFFFFFFFF) break; // can't skip undefined length easily
          offset = offset + 12 + len;
        } else {
          if (offset + 8 > buffer.byteLength) break;
          const len = dv.getUint16(offset + 6, true);
          offset = offset + 8 + len;
        }
      } else {
        // Implicit VR — 4-byte length
        if (offset + 8 > buffer.byteLength) break;
        const len = dv.getUint32(offset + 4, true);
        if (len === 0xFFFFFFFF) break;
        offset = offset + 8 + len;
      }
      continue;
    }

    // For meta group, auto-detect whether it uses implicit or explicit VR
    // by checking if the bytes at offset+4 look like a valid 2-char VR code.
    if (inMetaGroup && !metaIsExplicit && group === 0x0002 && offset + 6 <= buffer.byteLength) {
      const b4 = new Uint8Array(buffer, offset + 4, 1)[0];
      const b5 = new Uint8Array(buffer, offset + 5, 1)[0];
      if ((b4 >= 0x41 && b4 <= 0x5A) && (b5 >= 0x41 && b5 <= 0x5A)) {
        metaIsExplicit = true;
      }
    }

    const effectiveTS: TransferSyntax = inMetaGroup
      ? (metaIsExplicit ? 'explicit-le' : 'implicit-le')
      : ts;

    let vr: string;
    let valueLength: number;

    if (effectiveTS === 'explicit-le' || effectiveTS === 'explicit-be') {
      if (offset + 6 > buffer.byteLength) break;

      vr = readFixedString(buffer, offset + 4, 2);

      const isLongForm = vr === 'OB' || vr === 'OD' || vr === 'OF' ||
        vr === 'OL' || vr === 'OW' || vr === 'SQ' ||
        vr === 'UC' || vr === 'UN' || vr === 'UR' || vr === 'UT';

      if (isLongForm) {
        if (offset + 12 > buffer.byteLength) break;
        valueLength = dv.getUint32(offset + 8, effectiveTS === 'explicit-le');
        offset += 12;
      } else {
        if (offset + 8 > buffer.byteLength) break;
        valueLength = dv.getUint16(offset + 6, effectiveTS === 'explicit-le');
        offset += 8;
      }
    } else {
      vr = lookupVR(group, element) ?? 'UN';
      if (offset + 8 > buffer.byteLength) break;
      valueLength = dv.getUint32(offset + 4, true);
      offset += 8;
    }

    const tag: DicomTag = { group, element };

    // Handle undefined length (0xFFFFFFFF) — SQ sequences, pixel data
    if (valueLength === 0xFFFFFFFF) {
      elements.set(tagKey, { tag, vr, length: valueLength, value: null });

      if (vr === 'SQ') {
        // Skip SQ content: count nesting depth
        let depth = 1;
        while (offset + 8 <= buffer.byteLength && depth > 0) {
          const sg = dv.getUint16(offset, true);
          const se = dv.getUint16(offset + 2, true);

          if (sg === 0xFFFE) {
            if (se === 0xE0DD) {
              // Sequence Delimitation — closes the SQ
              depth--;
              offset += 8;
            } else if (se === 0xE00D) {
              // Item Delimitation — closes an undefined-length Item
              depth--;
              offset += 8;
            } else if (se === 0xE000) {
              const sl = dv.getUint32(offset + 4, true);
              if (sl === 0xFFFFFFFF) {
                depth++;
                offset += 8;
              } else {
                offset += 8 + sl;
              }
            } else {
              offset += 8;
            }
            continue;
          }

          // Regular element inside SQ — parse length and skip value
          if (effectiveTS === 'explicit-le' || effectiveTS === 'explicit-be') {
            if (offset + 6 > buffer.byteLength) { depth = 0; break; }
            const svr = readFixedString(buffer, offset + 4, 2);
            const sIsLong = svr === 'OB' || svr === 'OD' || svr === 'OF' ||
              svr === 'OL' || svr === 'OW' || svr === 'SQ' ||
              svr === 'UC' || svr === 'UN' || svr === 'UR' || svr === 'UT';
            let sl: number;
            if (sIsLong) {
              if (offset + 12 > buffer.byteLength) { depth = 0; break; }
              sl = dv.getUint32(offset + 8, effectiveTS === 'explicit-le');
              if (sl === 0xFFFFFFFF) { depth++; offset += 12; continue; }
              offset += 12;
            } else {
              if (offset + 8 > buffer.byteLength) { depth = 0; break; }
              sl = dv.getUint16(offset + 6, effectiveTS === 'explicit-le');
              offset += 8;
            }
            if (offset + sl <= buffer.byteLength) offset += sl; else { depth = 0; break; }
          } else {
            if (offset + 8 > buffer.byteLength) { depth = 0; break; }
            const sl = dv.getUint32(offset + 4, true);
            if (sl === 0xFFFFFFFF) { depth++; offset += 8; continue; }
            offset += 8;
            if (offset + sl <= buffer.byteLength) offset += sl; else { depth = 0; break; }
          }
        }
      }
      continue;
    }

    // Bounds check
    if (offset + valueLength > buffer.byteLength) break;

    // Read element value
    const value = readElementValue(buffer, offset, tag, vr, valueLength, effectiveTS);

    elements.set(tagKey, { tag, vr, length: valueLength, value });

    // Advance past value
    offset += valueLength;
  }

  return elements;
}

/**
 * Read the value of a DICOM element given its VR and offset.
 */
function readElementValue(
  buffer: ArrayBuffer,
  valueOffset: number,
  tag: DicomTag,
  vr: string,
  length: number,
  ts: TransferSyntax
): unknown {
  if (length === 0) return null;

  const view = new DataView(buffer, valueOffset, length);
  const littleEndian = ts !== 'explicit-be';

  // Pixel data is always returned as raw slice
  if (tag.group === 0x7FE0 && tag.element === 0x0010) {
    return buffer.slice(valueOffset, valueOffset + length);
  }

  // String-type VRs — read as ASCII text
  const stringVRs = new Set([
    'UI', 'SH', 'CS', 'LO', 'DA', 'TM', 'DS', 'IS',
    'PN', 'LT', 'SQ', 'UN', 'AE', 'AS', 'UC',
  ]);
  if (stringVRs.has(vr)) {
    return readFixedString(buffer, valueOffset, length);
  }

  // Binary VRs with known sizes
  switch (vr) {
    case 'US': return view.getUint16(0, littleEndian);
    case 'SS': return view.getInt16(0, littleEndian);
    case 'FL': return view.getFloat32(0, littleEndian);
    case 'FD': return view.getFloat64(0, littleEndian);
    case 'SL': return view.getInt32(0, littleEndian);
    case 'UL': return view.getUint32(0, littleEndian);
    case 'AT':
      if (length === 2) return view.getUint16(0, littleEndian);
      if (length === 4) return view.getUint32(0, littleEndian);
      break;
  }

  // OB/OW — raw bytes (pixel data, overlay)
  if (vr === 'OB' || vr === 'OW') {
    return buffer.slice(valueOffset, valueOffset + length);
  }

  // Unknown / unsupported VR — return raw bytes as fallback
  return buffer.slice(valueOffset, valueOffset + length);
}
