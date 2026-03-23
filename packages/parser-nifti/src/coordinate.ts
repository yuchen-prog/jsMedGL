// Coordinate system utilities for NIfTI

import type { NiftiHeader, OrientationReport } from './types';
import { identityMatrix } from './utils';

/**
 * Extract the best affine matrix from NIfTI header
 * Priority: sform > qform > fallback (pixdim only)
 */
export function extractAffineMatrix(header: NiftiHeader): number[] {
  // Priority 1: sform (method 3)
  if (header.sform_code > 0) {
    return extractSform(header);
  }

  // Priority 2: qform (method 2)
  if (header.qform_code > 0) {
    return extractQform(header);
  }

  // Fallback: diagonal matrix from pixdim (no orientation info)
  return createFallbackMatrix(header);
}

/**
 * Extract sform matrix (method 3)
 * Note: NIfTI-1 stores the forward transform (IJK to RAS), not the inverse
 */
function extractSform(header: NiftiHeader): number[] {
  // The sform matrix is already the forward transform (IJK -> RAS)
  // Return it directly, no inversion needed
  return header.sform_inv; // Note: field is misnamed in our type, it's actually sform (forward)
}

/**
 * Extract qform matrix (method 2)
 */
function extractQform(header: NiftiHeader): number[] {
  const { quatern_b, quatern_c, quatern_d, qoffset_x, qoffset_y, qoffset_z, pixdim } = header;

  // Calculate quaternion
  const a = Math.sqrt(1 - quatern_b * quatern_b - quatern_c * quatern_c - quatern_d * quatern_d);

  // Build rotation matrix from quaternion
  const R = [
    a * a + quatern_b * quatern_b - quatern_c * quatern_c - quatern_d * quatern_d,
    2 * (quatern_b * quatern_c - a * quatern_d),
    2 * (quatern_b * quatern_d + a * quatern_c),

    2 * (quatern_b * quatern_c + a * quatern_d),
    a * a + quatern_c * quatern_c - quatern_b * quatern_b - quatern_d * quatern_d,
    2 * (quatern_c * quatern_d - a * quatern_b),

    2 * (quatern_b * quatern_d - a * quatern_c),
    2 * (quatern_c * quatern_d + a * quatern_b),
    a * a + quatern_d * quatern_d - quatern_b * quatern_b - quatern_c * quatern_c
  ];

  // Get voxel spacing
  const qfac = pixdim[0] < 0 ? -1 : 1;
  const sx = Math.abs(pixdim[1]);
  const sy = pixdim[2];
  const sz = pixdim[3];

  // Build affine matrix: [R * diag([sx, sy* qfac, sz]), qoffset]
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

/**
 * Create fallback matrix (method 1 - pixdim only)
 */
function createFallbackMatrix(header: NiftiHeader): number[] {
  const { pixdim } = header;
  const affine = identityMatrix();

  // Set diagonal elements to voxel spacing
  affine[0] = Math.abs(pixdim[1]);
  affine[5] = pixdim[2];
  affine[10] = pixdim[3];

  return affine;
}

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
 * Convert RAS (NIfTI) to LPS (DICOM) coordinates
 * RAS: Right, Anterior, Superior
 * LPS: Left, Posterior, Superior
 */
export function rasToLps(ras: [number, number, number]): [number, number, number] {
  return [-ras[0], -ras[1], ras[2]];
}

/**
 * Convert LPS (DICOM) to RAS (NIfTI) coordinates
 */
export function lpsToRas(lps: [number, number, number]): [number, number, number] {
  return [-lps[0], -lps[1], lps[2]];
}

/**
 * Generate orientation report for coordinate system validation
 */
export function validateOrientation(header: NiftiHeader): OrientationReport {
  const affine = extractAffineMatrix(header);

  // Extract axis codes from affine matrix
  const axcodes = getAxisCodes(affine);

  // Check if image is oblique
  const isOblique = checkIfOblique(affine);

  // Extract spacing
  const spacing = extractSpacing(header);

  return {
    axcodes,
    isOblique,
    spacing,
    affine
  };
}

/**
 * Get axis codes (R/L, A/P, S/I) from affine matrix
 */
function getAxisCodes(affine: number[]): ['R' | 'L' | 'A' | 'P' | 'S' | 'I', 'R' | 'L' | 'A' | 'P' | 'S' | 'I', 'R' | 'L' | 'A' | 'P' | 'S' | 'I'] {
  const codes: ('R' | 'L' | 'A' | 'P' | 'S' | 'I')[] = [];

  for (let i = 0; i < 3; i++) {
    const x = affine[i * 4];
    const y = affine[i * 4 + 1];
    const z = affine[i * 4 + 2];

    // Find the dominant direction
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

  return codes as ['R' | 'L' | 'A' | 'P' | 'S' | 'I', 'R' | 'L' | 'A' | 'P' | 'S' | 'I', 'R' | 'L' | 'A' | 'P' | 'S' | 'I'];
}

/**
 * Check if affine matrix represents an oblique image
 */
function checkIfOblique(affine: number[]): boolean {
  // Extract the rotation matrix (upper 3x3)
  const R = [
    affine[0], affine[1], affine[2],
    affine[4], affine[5], affine[6],
    affine[8], affine[9], affine[10]
  ];

  // Check if any axis is not aligned with cardinal axes
  // An axis is aligned if it's mostly along one direction
  for (let i = 0; i < 3; i++) {
    const row = [R[i * 3], R[i * 3 + 1], R[i * 3 + 2]];
    const maxVal = Math.max(...row.map(Math.abs));
    const sum = row.reduce((acc, val) => acc + Math.abs(val), 0);

    // If the dominant direction is less than 95% of total, it's oblique
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
    header.pixdim[2],
    header.pixdim[3]
  ];
}

export { invertMatrix } from './utils';
