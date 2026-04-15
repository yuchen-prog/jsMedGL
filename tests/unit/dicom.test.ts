// Unit tests for @jsmedgl/parser-dicom

import { describe, it, expect } from 'vitest';
import {
  parseDS,
  parseIS,
  trimDicomString,
  mapDicomToNiftiDatatype,
  invertMatrix,
  identityMatrix,
  lookupVR,
  TRANSFER_SYNTAX,
  tagToString,
  parseTagString,
  buildDicomAffine,
  computeSliceSpacing,
  validateOrientation,
  mapUidToTS,
  isSupportedTransferSyntax,
  decodeVR,
  readElements,
  buildHeaderDatatype,
  buildSeriesVolume,
} from '@jsmedgl/parser-dicom';
import type { DicomHeader } from '@jsmedgl/parser-dicom';

// ============================================================
// Utils: Number Parsing
// ============================================================

describe('parseDS — Decimal String', () => {
  it('parses basic decimal string', () => {
    expect(parseDS('1.5')).toBe(1.5);
  });

  it('parses integer string', () => {
    expect(parseDS('42')).toBe(42);
  });

  it('parses string with leading/trailing spaces', () => {
    expect(parseDS('  3.14  ')).toBeCloseTo(3.14);
  });

  it('parses negative number', () => {
    expect(parseDS('-1024')).toBe(-1024);
  });

  it('parses scientific notation', () => {
    expect(parseDS('1.5E2')).toBeCloseTo(150);
  });
});

describe('parseIS — Integer String', () => {
  it('parses basic integer string', () => {
    expect(parseIS('42')).toBe(42);
  });

  it('parses negative integer', () => {
    expect(parseIS('-7')).toBe(-7);
  });

  it('parses zero', () => {
    expect(parseIS('0')).toBe(0);
  });

  it('parses string with spaces', () => {
    expect(parseIS('  100  ')).toBe(100);
  });
});

describe('trimDicomString', () => {
  it('trims trailing spaces', () => {
    expect(trimDicomString('hello   ')).toBe('hello');
  });

  it('trims null characters', () => {
    expect(trimDicomString('test\0\0')).toBe('test');
  });

  it('trims mixed spaces and nulls', () => {
    expect(trimDicomString('abc\0 \0')).toBe('abc');
  });

  it('handles already-trimmed string', () => {
    expect(trimDicomString('hello')).toBe('hello');
  });
});

// ============================================================
// Utils: Datatype Mapping (DICOM → NIfTI)
// ============================================================

describe('mapDicomToNiftiDatatype', () => {
  it('maps 8-bit unsigned to UINT8 (2)', () => {
    expect(mapDicomToNiftiDatatype(8, 0)).toBe(2);
  });

  it('maps 8-bit signed to INT8 (256)', () => {
    expect(mapDicomToNiftiDatatype(8, 1)).toBe(256);
  });

  it('maps 16-bit signed to INT16 (4) — CT Hounsfield units', () => {
    expect(mapDicomToNiftiDatatype(16, 1)).toBe(4);
  });

  it('maps 16-bit unsigned to UINT16 (512)', () => {
    expect(mapDicomToNiftiDatatype(16, 0)).toBe(512);
  });

  it('maps 32-bit signed to INT32 (8)', () => {
    expect(mapDicomToNiftiDatatype(32, 1)).toBe(8);
  });

  it('maps 32-bit unsigned to UINT32 (768)', () => {
    expect(mapDicomToNiftiDatatype(32, 0)).toBe(768);
  });
});

// ============================================================
// Utils: Matrix Operations
// ============================================================

describe('identityMatrix', () => {
  it('creates a 4x4 identity matrix', () => {
    const m = identityMatrix();
    expect(m).toHaveLength(16);
    expect(m[0]).toBe(1);
    expect(m[5]).toBe(1);
    expect(m[10]).toBe(1);
    expect(m[15]).toBe(1);
    // Off-diagonal should be 0
    expect(m[1]).toBe(0);
    expect(m[4]).toBe(0);
  });
});

describe('invertMatrix', () => {
  it('inverts identity matrix', () => {
    const id = identityMatrix();
    const inv = invertMatrix(id);
    for (let i = 0; i < 16; i++) {
      expect(inv[i]).toBeCloseTo(id[i], 10);
    }
  });

  it('inverts a translation matrix', () => {
    const m = [
      1, 0, 0, 10,
      0, 1, 0, 20,
      0, 0, 1, 30,
      0, 0, 0, 1,
    ];
    const inv = invertMatrix(m);
    expect(inv[3]).toBeCloseTo(-10, 10);
    expect(inv[7]).toBeCloseTo(-20, 10);
    expect(inv[11]).toBeCloseTo(-30, 10);
  });

  it('M * M^-1 = Identity', () => {
    const m = [
      2, 0, 0, 5,
      0, 3, 0, 10,
      0, 0, 4, 15,
      0, 0, 0, 1,
    ];
    const inv = invertMatrix(m);
    // Multiply M * inv
    const result = new Array(16).fill(0);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        for (let k = 0; k < 4; k++) {
          result[i * 4 + j] += m[i * 4 + k] * inv[k * 4 + j];
        }
      }
    }
    for (let i = 0; i < 4; i++) {
      expect(result[i * 4 + i]).toBeCloseTo(1, 10);
    }
  });
});

// ============================================================
// Types: Tag Utilities
// ============================================================

describe('tagToString', () => {
  it('formats standard tags', () => {
    expect(tagToString({ group: 0x0028, element: 0x0010 })).toBe('0028,0010');
  });

  it('formats pixel data tag', () => {
    expect(tagToString({ group: 0x7FE0, element: 0x0010 })).toBe('7FE0,0010');
  });

  it('formats meta group tags', () => {
    expect(tagToString({ group: 0x0002, element: 0x0010 })).toBe('0002,0010');
  });
});

describe('parseTagString', () => {
  it('parses standard tag string', () => {
    const tag = parseTagString('0028,0010');
    expect(tag.group).toBe(0x0028);
    expect(tag.element).toBe(0x0010);
  });
});

// ============================================================
// VR Dictionary
// ============================================================

describe('lookupVR — Implicit VR dictionary', () => {
  it('finds Rows (0028,0010)', () => {
    expect(lookupVR(0x0028, 0x0010)).toBe('US');
  });

  it('finds PatientName (0010,0010)', () => {
    expect(lookupVR(0x0010, 0x0010)).toBe('PN');
  });

  it('finds PixelData (7FE0,0010)', () => {
    expect(lookupVR(0x7FE0, 0x0010)).toBe('OW');
  });

  it('finds TransferSyntaxUID (0002,0010)', () => {
    expect(lookupVR(0x0002, 0x0010)).toBe('UI');
  });

  it('returns undefined for unknown tags', () => {
    expect(lookupVR(0x9999, 0x9999)).toBeUndefined();
  });
});

// ============================================================
// Transfer Syntax
// ============================================================

describe('TRANSFER_SYNTAX constants', () => {
  it('has correct Implicit VR LE UID', () => {
    expect(TRANSFER_SYNTAX.IMPLICIT_VR_LE).toBe('1.2.840.10008.1.2');
  });

  it('has correct Explicit VR LE UID', () => {
    expect(TRANSFER_SYNTAX.EXPLICIT_VR_LE).toBe('1.2.840.10008.1.2.1');
  });
});

describe('mapUidToTS', () => {
  it('maps implicit VR LE', () => {
    expect(mapUidToTS('1.2.840.10008.1.2')).toBe('implicit-le');
  });

  it('maps explicit VR LE', () => {
    expect(mapUidToTS('1.2.840.10008.1.2.1')).toBe('explicit-le');
  });

  it('maps explicit VR BE', () => {
    expect(mapUidToTS('1.2.840.10008.1.2.2')).toBe('explicit-be');
  });

  it('maps deflate to implicit-le (after decompression)', () => {
    expect(mapUidToTS('1.2.840.10008.1.2.5')).toBe('implicit-le');
  });
});

describe('isSupportedTransferSyntax', () => {
  it('supports implicit VR LE', () => {
    expect(isSupportedTransferSyntax('1.2.840.10008.1.2')).toBe(true);
  });

  it('supports explicit VR LE', () => {
    expect(isSupportedTransferSyntax('1.2.840.10008.1.2.1')).toBe(true);
  });

  it('does not support JPEG 2000', () => {
    expect(isSupportedTransferSyntax('1.2.840.10008.1.2.4.90')).toBe(false);
  });
});

// ============================================================
// VR Decoder
// ============================================================

describe('decodeVR', () => {
  it('decodes DS (Decimal String)', () => {
    expect(decodeVR('3.14', 'DS')).toBeCloseTo(3.14);
  });

  it('decodes IS (Integer String)', () => {
    expect(decodeVR('42', 'IS')).toBe(42);
  });

  it('decodes UI (Unique Identifier) — trims nulls', () => {
    expect(decodeVR('1.2.3.4\0', 'UI')).toBe('1.2.3.4');
  });

  it('decodes PN (Patient Name) — replaces ^', () => {
    expect(decodeVR('Doe^John^M', 'PN')).toBe('Doe John M');
  });

  it('decodes CS (Code String)', () => {
    expect(decodeVR('CT', 'CS')).toBe('CT');
  });

  it('decodes DA (Date)', () => {
    expect(decodeVR('20260319', 'DA')).toBe('20260319');
  });

  it('decodes SH (Short String)', () => {
    expect(decodeVR('MyStudy', 'SH')).toBe('MyStudy');
  });

  it('decodes LO (Long String)', () => {
    expect(decodeVR('Brain MRI with contrast\0', 'LO')).toBe('Brain MRI with contrast');
  });

  it('decodes SQ (Sequence) — returns null for MVP', () => {
    expect(decodeVR('anything', 'SQ')).toBeNull();
  });

  it('decodes FL (Float)', () => {
    expect(decodeVR(3.14, 'FL')).toBe(3.14);
  });

  it('decodes FD (Double)', () => {
    expect(decodeVR(2.718, 'FD')).toBe(2.718);
  });

  it('decodes US (number)', () => {
    expect(decodeVR(256, 'US')).toBe(256);
  });
});

// ============================================================
// LPS Coordinate System
// ============================================================

describe('buildDicomAffine', () => {
  it('builds identity-like affine for standard axial orientation', () => {
    // Standard axial: Row = L→R, Col = A→P, Slice = I→S
    const result = buildDicomAffine(
      [0, 0, 0],          // IPP at origin
      [1, 0, 0, 0, 1, 0], // IOP: standard axial
      [1, 1],             // 1mm isotropic
      1,                  // 1mm slice thickness
      1                   // 1 slice
    );

    expect(result.affine).toHaveLength(16);
    expect(result.inverseAffine).toHaveLength(16);
    expect(result.spacing).toEqual([1, 1, 1]);
  });

  it('computes correct RAS affine (negated X and Y)', () => {
    const result = buildDicomAffine(
      [100, 200, 300],     // IPP in LPS
      [1, 0, 0, 0, 1, 0], // standard orientation
      [0.5, 0.5],          // 0.5mm spacing
      2,                   // 2mm slice thickness
      1
    );

    // In LPS, origin is (100, 200, 300)
    // After LPS→RAS conversion, origin should be (-100, -200, 300)
    // Column 3 (translation) should be negated for X and Y
    expect(result.affine[3]).toBeCloseTo(-100, 5);
    expect(result.affine[7]).toBeCloseTo(-200, 5);
    expect(result.affine[11]).toBeCloseTo(300, 5);

    // First two direction columns should also be negated
    expect(result.affine[0]).toBeLessThan(0); // Negated X direction
  });

  it('affine * inverse = identity', () => {
    const { affine, inverseAffine } = buildDicomAffine(
      [-128.5, -128.5, -50],
      [1, 0, 0, 0, 1, 0],
      [0.5, 0.5],
      1.0,
      1
    );

    // Multiply affine * inverseAffine
    const result = new Array(16).fill(0);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        for (let k = 0; k < 4; k++) {
          result[i * 4 + j] += affine[i * 4 + k] * inverseAffine[k * 4 + j];
        }
      }
    }

    for (let i = 0; i < 4; i++) {
      expect(result[i * 4 + i]).toBeCloseTo(1, 8);
    }
    // Off-diagonal should be ~0
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        if (i !== j) {
          expect(Math.abs(result[i * 4 + j])).toBeLessThan(1e-8);
        }
      }
    }
  });
});

describe('computeSliceSpacing', () => {
  it('returns 1.0 for single position', () => {
    expect(computeSliceSpacing([[0, 0, 0]])).toBe(1.0);
  });

  it('computes uniform spacing', () => {
    const positions: [number, number, number][] = [
      [0, 0, 0],
      [0, 0, 2],
      [0, 0, 4],
      [0, 0, 6],
    ];
    expect(computeSliceSpacing(positions)).toBeCloseTo(2, 5);
  });

  it('uses median spacing (robust to outliers)', () => {
    const positions: [number, number, number][] = [
      [0, 0, 0],
      [0, 0, 2],
      [0, 0, 4],
      [0, 0, 100], // outlier
    ];
    // Gaps: [2, 2, 96], sorted: [2, 2, 96], median = 2
    expect(computeSliceSpacing(positions)).toBeCloseTo(2, 5);
  });
});

describe('validateOrientation', () => {
  it('validates standard axial IOP', () => {
    expect(validateOrientation([1, 0, 0, 0, 1, 0])).toBe(true);
  });

  it('validates coronal IOP', () => {
    expect(validateOrientation([1, 0, 0, 0, 0, -1])).toBe(true);
  });

  it('rejects non-orthogonal IOP', () => {
    expect(validateOrientation([1, 1, 0, 0, 1, 0])).toBe(false);
  });
});

// ============================================================
// Pixel Data
// ============================================================

describe('buildHeaderDatatype', () => {
  it('maps 16-bit signed CT to INT16', () => {
    expect(buildHeaderDatatype(16, 1)).toBe(4);
  });

  it('maps 8-bit unsigned MR to UINT8', () => {
    expect(buildHeaderDatatype(8, 0)).toBe(2);
  });
});

// ============================================================
// Tag Reader (with synthetic DICOM buffers)
// ============================================================

describe('readElements — synthetic buffer tests', () => {
  function buildDicomBuffer(
    tags: { group: number; element: number; vr: string; data: Uint8Array }[]
  ): ArrayBuffer {
    // Build a minimal DICOM buffer with preamble + DICM + explicit VR elements.
    // Follows DICOM Part 5 §7.1.2: short-form VRs have 2-byte length, long-form have 4-byte.
    const parts: Uint8Array[] = [];

    // 128-byte preamble
    parts.push(new Uint8Array(128));

    // "DICM" magic
    parts.push(new Uint8Array([0x44, 0x49, 0x43, 0x4d]));

    const enc = new TextEncoder();

    const longFormVRs = new Set(['OB', 'OD', 'OF', 'OL', 'OW', 'SQ', 'UC', 'UN', 'UR', 'UT']);

    for (const tag of tags) {
      // Tag: group (2 bytes LE) + element (2 bytes LE)
      const tagBuf = new Uint8Array(4);
      new DataView(tagBuf.buffer).setUint16(0, tag.group, true);
      new DataView(tagBuf.buffer).setUint16(2, tag.element, true);
      parts.push(tagBuf);

      // VR (2 ASCII bytes)
      parts.push(enc.encode(tag.vr));

      if (longFormVRs.has(tag.vr)) {
        // Reserved (2 bytes) + Length (4 bytes LE)
        parts.push(new Uint8Array(2));
        const lenBuf = new Uint8Array(4);
        new DataView(lenBuf.buffer).setUint32(0, tag.data.length, true);
        parts.push(lenBuf);
      } else {
        // Length (2 bytes LE) — short form
        const lenBuf = new Uint8Array(2);
        new DataView(lenBuf.buffer).setUint16(0, tag.data.length, true);
        parts.push(lenBuf);
      }

      // Value
      parts.push(tag.data);
    }

    // Concatenate
    const total = parts.reduce((acc, p) => acc + p.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
      result.set(p, offset);
      offset += p.length;
    }
    return result.buffer;
  }

  it('reads US value (Rows = 256)', () => {
    const data = new Uint8Array(2);
    new DataView(data.buffer).setUint16(0, 256, true);

    const buffer = buildDicomBuffer([
      { group: 0x0028, element: 0x0010, vr: 'US', data },
    ]);

    const elements = readElements(buffer, 'explicit-le');
    const el = elements.get('0028,0010');
    expect(el).toBeDefined();
    expect(el?.value).toBe(256);
  });

  it('reads UI value (Series Instance UID)', () => {
    // Pad UID with null byte (DICOM UIs must have even length)
    const uidBytes = new TextEncoder().encode('1.2.840.10008.1.2.1\0');

    // Build a buffer with UI in explicit VR short form
    const parts: Uint8Array[] = [];
    // preamble
    parts.push(new Uint8Array(128));
    // DICM
    parts.push(new Uint8Array([0x44, 0x49, 0x43, 0x4d]));
    // Tag 0020,000E
    const tagBuf = new Uint8Array(4);
    new DataView(tagBuf.buffer).setUint16(0, 0x0020, true);
    new DataView(tagBuf.buffer).setUint16(2, 0x000E, true);
    parts.push(tagBuf);
    // VR "UI"
    parts.push(new TextEncoder().encode('UI'));
    // Length (2 bytes)
    const lenBuf = new Uint8Array(2);
    new DataView(lenBuf.buffer).setUint16(0, uidBytes.length, true);
    parts.push(lenBuf);
    // Value
    parts.push(uidBytes);

    const total = parts.reduce((acc, p) => acc + p.length, 0);
    const result = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { result.set(p, off); off += p.length; }

    const elements = readElements(result.buffer as ArrayBuffer, 'explicit-le');
    const el = elements.get('0020,000e');
    expect(el).toBeDefined();
    expect(el?.value).toContain('1.2.840.10008.1.2.1');
  });

  it('reads CS value (Modality)', () => {
    const mod = new TextEncoder().encode('CT');

    const buffer = buildDicomBuffer([
      { group: 0x0008, element: 0x0060, vr: 'CS', data: mod },
    ]);

    const elements = readElements(buffer, 'explicit-le');
    const el = elements.get('0008,0060');
    expect(el).toBeDefined();
    expect(el?.value).toBe('CT');
  });

  it('reads DS value (Pixel Spacing = "0.5\\0.5")', () => {
    const ds = new TextEncoder().encode('0.5\\0.5');

    const buffer = buildDicomBuffer([
      { group: 0x0028, element: 0x0030, vr: 'DS', data: ds },
    ]);

    const elements = readElements(buffer, 'explicit-le');
    const el = elements.get('0028,0030');
    expect(el).toBeDefined();
    expect(el?.value).toContain('0.5');
  });

  it('reads multiple elements', () => {
    const rowsData = new Uint8Array(2);
    new DataView(rowsData.buffer).setUint16(0, 512, true);
    const colsData = new Uint8Array(2);
    new DataView(colsData.buffer).setUint16(0, 512, true);

    const buffer = buildDicomBuffer([
      { group: 0x0028, element: 0x0010, vr: 'US', data: rowsData },
      { group: 0x0028, element: 0x0011, vr: 'US', data: colsData },
    ]);

    const elements = readElements(buffer, 'explicit-le');
    expect(elements.get('0028,0010')?.value).toBe(512);
    expect(elements.get('0028,0011')?.value).toBe(512);
    expect(elements.size).toBe(2);
  });

  it('handles empty buffer gracefully', () => {
    const buffer = new ArrayBuffer(132);
    const view = new Uint8Array(buffer);
    // Set DICM at offset 128
    view[128] = 0x44; view[129] = 0x49; view[130] = 0x43; view[131] = 0x4d;

    const elements = readElements(buffer, 'implicit-le');
    expect(elements.size).toBe(0);
  });
});

// ============================================================
// Series Builder
// ============================================================

describe('buildSeriesVolume', () => {
  function makeHeader(overrides: Partial<DicomHeader> = {}): DicomHeader {
    return {
      rows: 4,
      columns: 4,
      bitsAllocated: 16,
      bitsStored: 16,
      highBit: 15,
      pixelRepresentation: 1,
      rescaleSlope: 1,
      rescaleIntercept: 0,
      windowCenter: 40,
      windowWidth: 400,
      imagePositionPatient: [0, 0, 0],
      imageOrientationPatient: [1, 0, 0, 0, 1, 0],
      pixelSpacing: [1, 1],
      sliceThickness: 2,
      modality: 'CT',
      studyDate: '20260319',
      patientName: 'Test',
      seriesDescription: 'Test Series',
      seriesInstanceUid: '1.2.3.4.5',
      sopInstanceUid: '1.2.3.4.5.1',
      studyInstanceUid: '1.2.3.4',
      seriesNumber: 1,
      instanceNumber: 1,
      sliceLocation: 0,
      transferSyntaxUid: '1.2.840.10008.1.2',
      datatype: 4, // INT16
      ...overrides,
    };
  }

  function makeInt16Slice(value: number, rows: number, cols: number): ArrayBuffer {
    const data = new Int16Array(rows * cols);
    data.fill(value);
    return data.buffer;
  }

  it('builds volume from single slice', () => {
    const vol = buildSeriesVolume([{
      header: makeHeader(),
      data: makeInt16Slice(100, 4, 4),
    }]);

    expect(vol.dimensions).toEqual([4, 4, 1]);
    expect(vol.spacing).toEqual([1, 1, 2]);
    expect(vol.data.byteLength).toBe(4 * 4 * 2); // 16 voxels * 2 bytes
  });

  it('builds volume from multiple slices', () => {
    const slices = [0, 1, 2].map(i => ({
      header: makeHeader({
        instanceNumber: i + 1,
        imagePositionPatient: [0, 0, i * 2] as [number, number, number],
        sliceLocation: i * 2,
      }),
      data: makeInt16Slice(i * 100, 4, 4),
    }));

    const vol = buildSeriesVolume(slices);

    expect(vol.dimensions).toEqual([4, 4, 3]);
    expect(vol.spacing[2]).toBeCloseTo(2, 5); // 2mm between slices
    expect(vol.data.byteLength).toBe(4 * 4 * 3 * 2); // 48 voxels * 2 bytes
  });

  it('sorts slices by instanceNumber', () => {
    const slices = [
      { header: makeHeader({ instanceNumber: 3, imagePositionPatient: [0, 0, 4] as [number, number, number] }), data: makeInt16Slice(300, 4, 4) },
      { header: makeHeader({ instanceNumber: 1, imagePositionPatient: [0, 0, 0] as [number, number, number] }), data: makeInt16Slice(100, 4, 4) },
      { header: makeHeader({ instanceNumber: 2, imagePositionPatient: [0, 0, 2] as [number, number, number] }), data: makeInt16Slice(200, 4, 4) },
    ];

    const vol = buildSeriesVolume(slices);
    expect(vol.dimensions[2]).toBe(3);

    // Verify slice ordering: first slice should have value 100
    const firstSliceData = new Int16Array(vol.data, 0, 4 * 4);
    expect(firstSliceData[0]).toBe(100);
  });

  it('throws on empty file list', () => {
    expect(() => buildSeriesVolume([])).toThrow('empty file list');
  });

  it('throws on inconsistent dimensions', () => {
    const slices = [
      { header: makeHeader({ rows: 4, columns: 4 }), data: makeInt16Slice(0, 4, 4) },
      { header: makeHeader({ rows: 8, columns: 8 }), data: makeInt16Slice(0, 8, 8) },
    ];

    expect(() => buildSeriesVolume(slices)).toThrow(/Inconsistent dimensions/);
  });
});
