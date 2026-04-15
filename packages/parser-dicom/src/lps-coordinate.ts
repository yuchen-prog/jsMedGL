// DICOM LPS Coordinate System — Affine Matrix Builder

import { invertMatrix } from './utils';

/**
 * Build a 4x4 affine matrix from DICOM spatial parameters.
 *
 * DICOM uses LPS (Left, Posterior, Superior) coordinates.
 * NIfTI uses RAS (Right, Anterior, Superior).
 * We convert by negating the X and Y columns of the LPS affine.
 *
 * Formula:
 *   physical_LPS = IPP + rowDir * col * pixelSpacing[0] + colDir * row * pixelSpacing[1]
 *
 * Where:
 *   - IPP = ImagePositionPatient (LPS coords of first voxel)
 *   - rowDir = IOP[0..2] (row direction cosines)
 *   - colDir = IOP[3..5] (column direction cosines)
 *   - pixelSpacing = [rowSpacing, colSpacing] (mm)
 *
 * The Z direction is computed as the cross product of rowDir and colDir
 * (perpendicular to the image plane), scaled by sliceThickness.
 *
 * Affine layout (column-major, NIfTI convention):
 *   [ -rowDir[0]*Sr,  -colDir[0]*Sc,  z0*Sz,  -IPP[0] ]
 *   [ -rowDir[1]*Sr,  -colDir[1]*Sc,  z1*Sz,  -IPP[1] ]
 *   [ -rowDir[2]*Sr,  -colDir[2]*Sc,  z2*Sz,   IPP[2] ]
 *   [  0,             0,               0,       1     ]
 *
 * Columns 0 and 1 are negated for LPS → RAS.
 * Column 3: X and Y are negated (LPS→RAS), Z stays.
 */
export function buildDicomAffine(
  ipp: [number, number, number],
  iop: [number, number, number, number, number, number],
  pixelSpacing: [number, number],
  sliceThickness: number,
  _numSlices?: number
): { affine: number[]; inverseAffine: number[]; spacing: [number, number, number] } {
  const row = [iop[0], iop[1], iop[2]];       // row direction cosines
  const col = [iop[3], iop[4], iop[5]];       // column direction cosines
  const [Sr, Sc] = pixelSpacing;               // row and column spacing (mm)
  const Sz = sliceThickness > 0 ? sliceThickness : 1;

  // Z direction = cross(row, col) — perpendicular to image plane
  const z0 = row[1] * col[2] - row[2] * col[1];
  const z1 = row[2] * col[0] - row[0] * col[2];
  const z2 = row[0] * col[1] - row[1] * col[0];

  // Build RAS affine (column-major, NIfTI convention)
  const affineRAS: number[] = [
    -row[0] * Sr, -col[0] * Sc, z0 * Sz, -ipp[0],
    -row[1] * Sr, -col[1] * Sc, z1 * Sz, -ipp[1],
    -row[2] * Sr, -col[2] * Sc, z2 * Sz,  ipp[2],
     0,            0,            0,         1,
  ];

  return {
    affine: affineRAS,
    inverseAffine: invertMatrix(affineRAS),
    spacing: [Sr, Sc, Sz],
  };
}

/**
 * Compute slice spacing from ImagePositionPatient array.
 * Sorts slices by their Z coordinate and computes the average gap.
 */
export function computeSliceSpacing(
  positions: [number, number, number][]
): number {
  if (positions.length < 2) return 1.0;

  // Sort by Z coordinate (slice position)
  const sorted = [...positions].sort((a, b) => a[2] - b[2]);

  // Compute gaps between consecutive slices
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const dz = Math.abs(sorted[i][2] - sorted[i - 1][2]);
    if (dz > 0.01) gaps.push(dz); // Ignore duplicate positions
  }

  if (gaps.length === 0) return 1.0;

  // Use median gap (more robust to outliers than mean)
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/**
 * Validate that IOP is approximately orthogonal.
 * Returns true if the three direction vectors are roughly perpendicular.
 */
export function validateOrientation(
  iop: [number, number, number, number, number, number]
): boolean {
  const r = [iop[0], iop[1], iop[2]];
  const c = [iop[3], iop[4], iop[5]];

  // Dot product of row and column should be ~0
  const dot = r[0] * c[0] + r[1] * c[1] + r[2] * c[2];

  // Each direction vector should have magnitude ~1
  const rMag = Math.sqrt(r[0] ** 2 + r[1] ** 2 + r[2] ** 2);
  const cMag = Math.sqrt(c[0] ** 2 + c[1] ** 2 + c[2] ** 2);

  // Allow 5% tolerance
  return Math.abs(dot) < 0.05 && Math.abs(rMag - 1) < 0.05 && Math.abs(cMag - 1) < 0.05;
}
