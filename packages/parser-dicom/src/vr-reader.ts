// DICOM Value Representation Reader

import { parseDS, parseIS, trimDicomString } from './utils';

/**
 * Read a VR value from a raw string or byte buffer.
 * Handles multi-value strings (backslash-separated).
 */

export interface VRReader {
  read(value: unknown, vr: string): unknown;
}

/**
 * Decode a DICOM element value given its VR.
 *
 * Supported VRs for MVP:
 * - UI, SH, CS, LO, DA, TM, LT, SQ, UN, AE, AS, UC → string
 * - PN → string (patient name, handles ^ separator)
 * - DS → number
 * - IS → number
 * - US → number
 * - SS → number
 * - UL → number
 * - SL → number
 * - FL → number
 * - FD → number
 * - OB, OW → Uint8Array / Uint16Array (raw pixel data)
 * - AT → [number, number] (attribute tag pair)
 */
export function decodeVR(value: unknown, vr: string): unknown {
  if (value === null || value === undefined) return null;

  switch (vr) {
    // ─── String types ───
    case 'UI': {
      // Unique Identifier — trim nulls
      const s = typeof value === 'string' ? trimDicomString(value) : String(value);
      return s;
    }
    case 'PN': {
      // Patient Name — handle ^ separator (Last^First^Middle^Prefix^Suffix)
      const s = typeof value === 'string' ? trimDicomString(value) : String(value);
      // DICOM PN format: LastName^FirstName^MiddleName
      return s.replace(/\^/g, ' ').trim();
    }
    case 'SH':  // Short String (max 16 chars)
    case 'CS':  // Code String (max 16 chars)
    case 'LO':  // Long String
    case 'LT':  // Long Text
    case 'UC':  // Unlimited Characters
    case 'DA':  // Date (YYYYMMDD)
    case 'TM':  // Time (HHMMSS.FRAC)
    case 'AE':  // Application Entity
    case 'AS':  // Age String (e.g., "030Y")
    case 'LO': {
      const s = typeof value === 'string' ? trimDicomString(value) : String(value);
      return s;
    }
    case 'SQ': {
      // Sequence — not parsed in MVP
      return null;
    }
    case 'UN': {
      // Unknown — return as-is (usually bytes)
      return value;
    }
    case 'US': {
      // Unsigned Short
      if (typeof value === 'number') return value;
      if (value instanceof Uint8Array || value instanceof Uint16Array) {
        // Multi-value: return first value or array
        if (value.length === 1) return value[0];
        return Array.from(value);
      }
      if (typeof value === 'string') {
        const parts = trimDicomString(value).split('\\');
        if (parts.length === 1) return parseInt(parts[0], 10);
        return parts.map(p => parseInt(p, 10));
      }
      return value;
    }
    case 'SS': {
      // Signed Short
      if (typeof value === 'number') return value;
      if (value instanceof Int16Array) {
        if (value.length === 1) return value[0];
        return Array.from(value);
      }
      if (typeof value === 'string') {
        const parts = trimDicomString(value).split('\\');
        if (parts.length === 1) return parseInt(parts[0], 10);
        return parts.map(p => parseInt(p, 10));
      }
      return value;
    }
    case 'UL': {
      // Unsigned Long
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const parts = trimDicomString(value).split('\\');
        if (parts.length === 1) return parseInt(parts[0], 10);
        return parts.map(p => parseInt(p, 10));
      }
      return value;
    }
    case 'SL': {
      // Signed Long
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const parts = trimDicomString(value).split('\\');
        if (parts.length === 1) return parseInt(parts[0], 10);
        return parts.map(p => parseInt(p, 10));
      }
      return value;
    }
    case 'FL': {
      // Floating Point Single
      if (typeof value === 'number') return value;
      if (typeof value === 'string') return parseFloat(trimDicomString(value));
      return value;
    }
    case 'FD': {
      // Floating Point Double
      if (typeof value === 'number') return value;
      if (typeof value === 'string') return parseFloat(trimDicomString(value));
      return value;
    }
    case 'DS': {
      // Decimal String → number or number[]
      if (typeof value === 'string') {
        const trimmed = trimDicomString(value);
        const parts = trimmed.split('\\').map(part => parseDS(part));
        return parts.length === 1 ? parts[0] : parts.filter(part => !isNaN(part));
      }
      if (typeof value === 'number') return value;
      return value;
    }
    case 'IS': {
      // Integer String → number or number[]
      if (typeof value === 'string') {
        const trimmed = trimDicomString(value);
        const parts = trimmed.split('\\').map(part => parseIS(part));
        return parts.length === 1 ? parts[0] : parts.filter(part => !isNaN(part));
      }
      if (typeof value === 'number') return value;
      return value;
    }
    case 'AT': {
      // Attribute Tag — two US values
      if (typeof value === 'string') {
        const parts = trimDicomString(value).split('\\');
        return [parseInt(parts[0], 16), parseInt(parts[1], 16)];
      }
      return value;
    }
    case 'OB':
    case 'OW':
    case 'OD':
    case 'OL':
    case 'OV':
      // Other Byte/Word/Double/Long/Very — caller handles pixel data separately
      return value;
    default:
      // Unknown VR — try as string
      if (typeof value === 'string') return trimDicomString(value);
      return value;
  }
}

/**
 * Parse a multi-value string into an array of numbers (for IS, DS, US, SS).
 */
export function parseMultiNumber(value: string): number[] {
  return value.split('\\').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
}
