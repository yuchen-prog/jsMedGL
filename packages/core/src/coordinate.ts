// Coordinate system utilities for jsMedgl
// Migrated from parser-nifti — these are business logic, not parsing logic.

import type { NiftiHeader } from '@jsmedgl/parser-nifti';

/**
 * Axis code representing anatomical direction
 */
export type AxisCode = 'R' | 'L' | 'A' | 'P' | 'S' | 'I';

/**
 * Orientation report for coordinate system validation
 */
export interface OrientationReport {
  axcodes: [AxisCode, AxisCode, AxisCode];
  isOblique: boolean;
  spacing: [number, number, number];
  affine: number[];
}

// ============================================
// Matrix utilities
// ============================================

/**
 * Create 4x4 identity matrix
 */
export function identityMatrix(): number[] {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

/**
 * Invert a 4x4 matrix (Gauss-Jordan elimination)
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

// ============================================
// Affine matrix extraction
// ============================================

/**
 * Extract the best affine matrix from NIfTI header.
 * Priority: sform > qform > fallback (pixdim only)
 */
export function extractAffineMatrix(header: NiftiHeader): number[] {
  if (header.sform_code > 0) {
    return extractSform(header);
  }
  if (header.qform_code > 0) {
    return extractQform(header);
  }
  return createFallbackMatrix(header);
}

function extractSform(header: NiftiHeader): number[] {
  return header.sform;
}

function extractQform(header: NiftiHeader): number[] {
  const { quatern_b, quatern_c, quatern_d, qoffset_x, qoffset_y, qoffset_z, pixdim } = header;

  const quatMagSq = quatern_b * quatern_b + quatern_c * quatern_c + quatern_d * quatern_d;
  let qb = quatern_b;
  let qc = quatern_c;
  let qd = quatern_d;

  if (quatMagSq > 1) {
    const scale = 1 / Math.sqrt(quatMagSq);
    qb *= scale;
    qc *= scale;
    qd *= scale;
  }

  const a = Math.sqrt(Math.max(0, 1 - qb * qb - qc * qc - qd * qd));

  const R = [
    a * a + qb * qb - qc * qc - qd * qd,
    2 * (qb * qc - a * qd),
    2 * (qb * qd + a * qc),

    2 * (qb * qc + a * qd),
    a * a + qc * qc - qb * qb - qd * qd,
    2 * (qc * qd - a * qb),

    2 * (qb * qd - a * qc),
    2 * (qc * qd + a * qb),
    a * a + qd * qd - qb * qb - qc * qc,
  ];

  const qfac = pixdim[0] < 0 ? -1 : 1;
  const sx = Math.abs(pixdim[1]);
  const sy = Math.abs(pixdim[2]);
  const sz = Math.abs(pixdim[3]);

  const affine = new Array(16).fill(0);
  affine[0] = R[0] * sx;
  affine[1] = R[1] * sy;
  affine[2] = R[2] * sz;
  affine[3] = qoffset_x;

  affine[4] = R[3] * sx;
  affine[5] = R[4] * sy;
  affine[6] = R[5] * sz;
  affine[7] = qoffset_y;

  affine[8] = R[6] * sx * qfac;
  affine[9] = R[7] * sy * qfac;
  affine[10] = R[8] * sz;
  affine[11] = qoffset_z;

  affine[15] = 1;

  return affine;
}

function createFallbackMatrix(header: NiftiHeader): number[] {
  const { pixdim } = header;
  const affine = identityMatrix();

  affine[0] = Math.abs(pixdim[1]);
  affine[5] = Math.abs(pixdim[2]);
  affine[10] = Math.abs(pixdim[3]);

  return affine;
}

// ============================================
// Coordinate transforms
// ============================================

/**
 * Convert IJK (voxel) coordinates to RAS (physical) coordinates
 */
export function ijkToRas(ijk: [number, number, number], affine: number[]): [number, number, number] {
  const x = affine[0] * ijk[0] + affine[1] * ijk[1] + affine[2] * ijk[2] + affine[3];
  const y = affine[4] * ijk[0] + affine[5] * ijk[1] + affine[6] * ijk[2] + affine[7];
  const z = affine[8] * ijk[0] + affine[9] * ijk[1] + affine[10] * ijk[2] + affine[11];
  return [x, y, z];
}

/**
 * Convert RAS (physical) coordinates to IJK (voxel) coordinates
 */
export function rasToIjk(ras: [number, number, number], inverseAffine: number[]): [number, number, number] {
  const i = inverseAffine[0] * ras[0] + inverseAffine[1] * ras[1] + inverseAffine[2] * ras[2] + inverseAffine[3];
  const j = inverseAffine[4] * ras[0] + inverseAffine[5] * ras[1] + inverseAffine[6] * ras[2] + inverseAffine[7];
  const k = inverseAffine[8] * ras[0] + inverseAffine[9] * ras[1] + inverseAffine[10] * ras[2] + inverseAffine[11];
  return [i, j, k];
}

/**
 * Convert RAS (NIfTI) to LPS (DICOM) coordinates.
 * RAS: Right, Anterior, Superior → LPS: Left, Posterior, Superior
 */
export function rasToLps(ras: [number, number, number]): [number, number, number] {
  return [-ras[0], -ras[1], ras[2]];
}

/**
 * Convert LPS (DICOM) to RAS (NIfTI) coordinates.
 */
export function lpsToRas(lps: [number, number, number]): [number, number, number] {
  return [-lps[0], -lps[1], lps[2]];
}

// ============================================
// Orientation validation
// ============================================

/**
 * Generate orientation report for coordinate system validation
 */
export function validateOrientation(header: NiftiHeader): OrientationReport {
  const affine = extractAffineMatrix(header);
  const axcodes = getAxisCodes(affine);
  const isOblique = checkIfOblique(affine);
  const spacing = extractSpacing(header);

  return { axcodes, isOblique, spacing, affine };
}

/**
 * Get axis codes (R/L, A/P, S/I) from affine matrix
 */
function getAxisCodes(affine: number[]): [AxisCode, AxisCode, AxisCode] {
  const codes: AxisCode[] = [];

  for (let i = 0; i < 3; i++) {
    const x = affine[i * 4];
    const y = affine[i * 4 + 1];
    const z = affine[i * 4 + 2];

    const absX = Math.abs(x);
    const absY = Math.abs(y);
    const absZ = Math.abs(z);

    if (absX > absY && absX > absZ) {
      codes.push(x > 0 ? 'R' : 'L');
    } else if (absY > absZ) {
      codes.push(y > 0 ? 'A' : 'P');
    } else {
      codes.push(z > 0 ? 'S' : 'I');
    }
  }

  return codes as [AxisCode, AxisCode, AxisCode];
}

/**
 * Check if affine matrix represents an oblique image
 */
function checkIfOblique(affine: number[]): boolean {
  const R = [
    affine[0], affine[1], affine[2],
    affine[4], affine[5], affine[6],
    affine[8], affine[9], affine[10],
  ];

  for (let i = 0; i < 3; i++) {
    const row = [R[i * 3], R[i * 3 + 1], R[i * 3 + 2]];
    const maxVal = Math.max(...row.map(Math.abs));
    const sum = row.reduce((acc, val) => acc + Math.abs(val), 0);

    if (maxVal / sum < 0.95) {
      return true;
    }
  }

  return false;
}

/**
 * Extract voxel spacing from header
 */
function extractSpacing(header: NiftiHeader): [number, number, number] {
  return [
    Math.abs(header.pixdim[1]),
    Math.abs(header.pixdim[2]),
    Math.abs(header.pixdim[3]),
  ];
}
