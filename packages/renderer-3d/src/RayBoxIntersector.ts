// RayBoxIntersector - Ray-AABB intersection (Slab Method)

export interface RayBoxResult {
  tNear: number;
  tFar: number;
  entryPoint: [number, number, number];
  exitPoint: [number, number, number];
}

const EPSILON = 1e-7;

/**
 * Compute intersection of a ray with an axis-aligned bounding box.
 * Uses the Slab Method: for each axis slab, compute entry/exit t values,
 * then take the maximum of all entry t's and minimum of all exit t's.
 *
 * @param rayOrigin - Ray origin in texture space
 * @param rayDir - Ray direction (should be normalized)
 * @param boxMin - AABB minimum corner (default [0,0,0])
 * @param boxMax - AABB maximum corner (default [1,1,1])
 * @returns Intersection result, or null if ray misses the box
 */
export function intersectBox(
  rayOrigin: [number, number, number],
  rayDir: [number, number, number],
  boxMin: [number, number, number] = [0, 0, 0],
  boxMax: [number, number, number] = [1, 1, 1]
): RayBoxResult | null {
  let tMin = -Infinity;
  let tMax = Infinity;

  for (let i = 0; i < 3; i++) {
    const invD = 1.0 / (Math.abs(rayDir[i]) < EPSILON ? EPSILON * Math.sign(rayDir[i] || 1) : rayDir[i]);

    let t0 = (boxMin[i] - rayOrigin[i]) * invD;
    let t1 = (boxMax[i] - rayOrigin[i]) * invD;

    if (t0 > t1) {
      const tmp = t0;
      t0 = t1;
      t1 = tmp;
    }

    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
  }

  // No intersection: box is behind ray or ray misses
  if (tMin > tMax || tMax < 0) {
    return null;
  }

  // Clamp tMin to 0 if ray starts inside the box (for entry point)
  // tFar uses raw tMax so it reflects the full exit distance (for exit point)
  const tNear = Math.max(tMin, 0);
  const tFar = tMax;

  const entryPoint: [number, number, number] = [
    rayOrigin[0] + rayDir[0] * tNear,
    rayOrigin[1] + rayDir[1] * tNear,
    rayOrigin[2] + rayDir[2] * tNear,
  ];

  const exitPoint: [number, number, number] = [
    rayOrigin[0] + rayDir[0] * tFar,
    rayOrigin[1] + rayDir[1] * tFar,
    rayOrigin[2] + rayDir[2] * tFar,
  ];

  return { tNear, tFar, entryPoint, exitPoint };
}
