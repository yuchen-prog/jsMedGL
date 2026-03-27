// Unit tests for webgl-slice-view.ts logic

import { describe, it, expect } from 'vitest';
import type { CrosshairPosition } from '@jsmedgl/renderer-2d';

// ─── Pure Logic Tests ────────────────────────────────────────────────────────────

describe('mouseToIJK Logic', () => {
  // Simulates the mouseToIJK logic from webgl-slice-view.ts
  // We test the coordinate transformation without WebGL

  function mouseToIJK(
    localX: number,
    localY: number,
    displayRect: { x: number; y: number; width: number; height: number },
    dimensions: [number, number, number],
    orientation: 'axial' | 'coronal' | 'sagittal',
    sliceIndex: number
  ): CrosshairPosition | null {
    const { x, y, width, height } = displayRect;

    if (localX < x || localX > x + width || localY < y || localY > y + height) {
      return null;
    }

    const nx = (localX - x) / width;
    const ny = (localY - y) / height;

    let sliceW: number, sliceH: number;
    switch (orientation) {
      case 'axial':
        sliceW = dimensions[0];
        sliceH = dimensions[1];
        break;
      case 'coronal':
        sliceW = dimensions[0];
        sliceH = dimensions[2];
        break;
      case 'sagittal':
        sliceW = dimensions[1];
        sliceH = dimensions[2];
        break;
    }

    const px = Math.floor(nx * sliceW);
    const py = Math.floor(ny * sliceH);

    let i: number, j: number, k: number;
    switch (orientation) {
      case 'axial':
        i = Math.min(px, dimensions[0] - 1);
        j = Math.min(py, dimensions[1] - 1);
        k = sliceIndex;
        break;
      case 'coronal':
        i = Math.min(px, dimensions[0] - 1);
        j = sliceIndex;
        k = Math.min(py, dimensions[2] - 1);
        break;
      case 'sagittal':
        i = sliceIndex;
        j = Math.min(px, dimensions[1] - 1);
        k = Math.min(py, dimensions[2] - 1);
        break;
    }

    return { i, j, k };
  }

  describe('Axial orientation', () => {
    const dims: [number, number, number] = [256, 256, 124];
    const rect = { x: 0, y: 0, width: 256, height: 256 };
    const sliceIndex = 50;

    it('should return null for point outside display area (left)', () => {
      expect(mouseToIJK(-1, 128, rect, dims, 'axial', sliceIndex)).toBeNull();
    });

    it('should return null for point outside display area (right)', () => {
      expect(mouseToIJK(300, 128, rect, dims, 'axial', sliceIndex)).toBeNull();
    });

    it('should return null for point outside display area (top)', () => {
      expect(mouseToIJK(128, -1, rect, dims, 'axial', sliceIndex)).toBeNull();
    });

    it('should return null for point outside display area (bottom)', () => {
      expect(mouseToIJK(128, 300, rect, dims, 'axial', sliceIndex)).toBeNull();
    });

    it('should map top-left corner to i=0, j=0', () => {
      const result = mouseToIJK(0, 0, rect, dims, 'axial', sliceIndex);
      expect(result).toEqual({ i: 0, j: 0, k: 50 });
    });

    it('should map bottom-right corner to i=max, j=max', () => {
      const result = mouseToIJK(255, 255, rect, dims, 'axial', sliceIndex);
      expect(result).toEqual({ i: 255, j: 255, k: 50 });
    });

    it('should map center to middle voxel', () => {
      const result = mouseToIJK(128, 128, rect, dims, 'axial', sliceIndex);
      expect(result).toEqual({ i: 128, j: 128, k: 50 });
    });

    it('should keep k equal to slice index', () => {
      const result = mouseToIJK(128, 128, rect, dims, 'axial', 99);
      expect(result?.k).toBe(99);
    });

    it('should clamp at boundaries', () => {
      // Point at x=400, y=400 is inside rect but nx*sliceW exceeds dims
      const wideRect = { x: 0, y: 0, width: 400, height: 400 };
      // scale = min(400/256, 400/256) = 1.56, drawW = 256*1.56 = 400, drawH = 400
      // localX=400 = x+width → nx=1 → px=256 → i clamped to 255
      const result = mouseToIJK(400, 400, wideRect, dims, 'axial', sliceIndex);
      expect(result?.i).toBeLessThanOrEqual(dims[0] - 1);
      expect(result?.j).toBeLessThanOrEqual(dims[1] - 1);
    });
  });

  describe('Coronal orientation', () => {
    const dims: [number, number, number] = [256, 256, 124];
    const rect = { x: 0, y: 0, width: 256, height: 124 };

    it('should map top-left to i=0, k=0', () => {
      const result = mouseToIJK(0, 0, rect, dims, 'coronal', 100);
      expect(result).toEqual({ i: 0, j: 100, k: 0 });
    });

    it('should map bottom-right to i=max, k=max', () => {
      const result = mouseToIJK(255, 123, rect, dims, 'coronal', 50);
      expect(result).toEqual({ i: 255, j: 50, k: 123 });
    });

    it('should keep j equal to slice index', () => {
      const result = mouseToIJK(128, 60, rect, dims, 'coronal', 200);
      expect(result?.j).toBe(200);
    });

    it('should return null outside display area', () => {
      expect(mouseToIJK(-1, 60, rect, dims, 'coronal', 0)).toBeNull();
      expect(mouseToIJK(60, -1, rect, dims, 'coronal', 0)).toBeNull();
      expect(mouseToIJK(300, 60, rect, dims, 'coronal', 0)).toBeNull();
      expect(mouseToIJK(60, 200, rect, dims, 'coronal', 0)).toBeNull();
    });
  });

  describe('Sagittal orientation', () => {
    const dims: [number, number, number] = [256, 256, 124];
    const rect = { x: 0, y: 0, width: 256, height: 124 };

    it('should map top-left to j=0, k=0', () => {
      const result = mouseToIJK(0, 0, rect, dims, 'sagittal', 128);
      expect(result).toEqual({ i: 128, j: 0, k: 0 });
    });

    it('should map bottom-right to j=max, k=max', () => {
      const result = mouseToIJK(255, 123, rect, dims, 'sagittal', 64);
      expect(result).toEqual({ i: 64, j: 255, k: 123 });
    });

    it('should keep i equal to slice index', () => {
      const result = mouseToIJK(128, 62, rect, dims, 'sagittal', 200);
      expect(result?.i).toBe(200);
    });

    it('should return null outside display area', () => {
      expect(mouseToIJK(300, 62, rect, dims, 'sagittal', 0)).toBeNull();
      expect(mouseToIJK(128, 200, rect, dims, 'sagittal', 0)).toBeNull();
    });
  });

  describe('Non-zero display rect offset', () => {
    it('should correctly handle offset display rect', () => {
      const dims: [number, number, number] = [100, 100, 50];
      const rect = { x: 50, y: 25, width: 100, height: 100 };

      // Point at rect top-left (x=50, y=25) → nx=0, ny=0 → i=0, j=0
      const result = mouseToIJK(50, 25, rect, dims, 'axial', 0);
      expect(result).toEqual({ i: 0, j: 0, k: 0 });

      // Point at rect center (x=100, y=75) → nx=0.5, ny=0.5 → i=50, j=50
      const result2 = mouseToIJK(100, 75, rect, dims, 'axial', 0);
      expect(result2).toEqual({ i: 50, j: 50, k: 0 });

      // Point outside rect
      expect(mouseToIJK(49, 25, rect, dims, 'axial', 0)).toBeNull();
      expect(mouseToIJK(151, 75, rect, dims, 'axial', 0)).toBeNull();
    });
  });
});

describe('getDisplayRect Aspect Ratio Logic', () => {
  // Simulates the display rect computation from webgl-slice-view.ts

  function computeDisplayRect(
    containerW: number,
    containerH: number,
    sliceW: number,
    sliceH: number
  ): { x: number; y: number; width: number; height: number } {
    const scale = Math.min(containerW / sliceW, containerH / sliceH);
    const drawW = Math.floor(sliceW * scale);
    const drawH = Math.floor(sliceH * scale);
    const drawX = Math.floor((containerW - drawW) / 2);
    const drawY = Math.floor((containerH - drawH) / 2);
    return { x: drawX, y: drawY, width: drawW, height: drawH };
  }

  it('should scale up to fill square container', () => {
    // Container larger than slice → scale = 2 → image fills container
    const rect = computeDisplayRect(512, 512, 256, 256);
    expect(rect.width).toBe(512);
    expect(rect.height).toBe(512);
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
  });

  it('should fit and center image in wide container', () => {
    // 1024x512 container, 256x256 slice
    // Scale = min(1024/256, 512/256) = 2 → fills height
    const rect = computeDisplayRect(1024, 512, 256, 256);
    expect(rect.width).toBe(512);
    expect(rect.height).toBe(512);
    expect(rect.x).toBe(256); // (1024-512)/2
    expect(rect.y).toBe(0);  // (512-512)/2
  });

  it('should fit and center image in tall container', () => {
    // 512x1024 container, 256x256 slice
    // Scale = min(512/256, 1024/256) = 2 → fills width
    const rect = computeDisplayRect(512, 1024, 256, 256);
    expect(rect.width).toBe(512);
    expect(rect.height).toBe(512);
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(256); // (1024-512)/2
  });

  it('should handle portrait image in landscape container', () => {
    // 800x400 container, 200x400 slice
    // Scale = min(800/200, 400/400) = 1 → fits exactly
    const rect = computeDisplayRect(800, 400, 200, 400);
    expect(rect.width).toBe(200);
    expect(rect.height).toBe(400);
    expect(rect.x).toBe(300); // (800-200)/2
    expect(rect.y).toBe(0);
  });

  it('should handle landscape image in portrait container', () => {
    // 400x800 container, 400x200 slice
    // Scale = min(400/400, 800/200) = 1 → fits exactly
    const rect = computeDisplayRect(400, 800, 400, 200);
    expect(rect.width).toBe(400);
    expect(rect.height).toBe(200);
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(300); // (800-200)/2
  });

  it('should handle anisotropic voxels (wide)', () => {
    // 512x128 slice in 1024x512 container
    // Scale = min(1024/512, 512/128) = 2 → fills width
    const rect = computeDisplayRect(1024, 512, 512, 128);
    expect(rect.width).toBe(1024);
    expect(rect.height).toBe(256);
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(128); // (512-256)/2
  });

  it('should handle anisotropic voxels (tall)', () => {
    // 128x512 slice in 512x1024 container
    // Scale = min(512/128, 1024/512) = 2 → fills height
    const rect = computeDisplayRect(512, 1024, 128, 512);
    expect(rect.width).toBe(256);
    expect(rect.height).toBe(1024);
    expect(rect.x).toBe(128); // (512-256)/2
    expect(rect.y).toBe(0);
  });

  it('should return zero dimensions for zero container', () => {
    const rect = computeDisplayRect(0, 0, 256, 256);
    expect(rect.width).toBe(0);
    expect(rect.height).toBe(0);
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
  });

  it('should handle zero slice width dimension', () => {
    // sliceW=0: scale = min(Infinity, 512/256) = 2
    // drawW = floor(0 * 2) = 0, drawH = floor(256 * 2) = 512
    const rect = computeDisplayRect(512, 512, 0, 256);
    expect(rect.width).toBe(0);
    expect(rect.height).toBe(512);
  });

  it('should never exceed container dimensions', () => {
    const rect = computeDisplayRect(400, 300, 800, 600);
    expect(rect.width).toBeLessThanOrEqual(400);
    expect(rect.height).toBeLessThanOrEqual(300);
  });

  it('should preserve aspect ratio for various slice sizes', () => {
    const sliceSizes: [number, number][] = [
      [256, 256], [512, 512], [100, 100], [256, 128], [128, 256]
    ];

    for (const [sliceW, sliceH] of sliceSizes) {
      const containerW = 500, containerH = 500;
      const rect = computeDisplayRect(containerW, containerH, sliceW, sliceH);
      const displayedAspect = rect.width / rect.height;
      const actualAspect = sliceW / sliceH;

      // Due to floor() the aspect might be slightly off, but should be close
      expect(displayedAspect).toBeCloseTo(actualAspect, 0);
    }
  });
});

describe('setSliceIndex / getSliceIndex Logic', () => {
  // Simulates setSliceIndex clamping logic

  function getMaxSliceIndex(dims: [number, number, number], orientation: 'axial' | 'coronal' | 'sagittal'): number {
    switch (orientation) {
      case 'axial':    return dims[2] - 1;
      case 'coronal':  return dims[1] - 1;
      case 'sagittal': return dims[0] - 1;
    }
  }

  function setSliceIndex(index: number, dims: [number, number, number], orientation: 'axial' | 'coronal' | 'sagittal', currentIndex: number): number {
    const maxIndex = getMaxSliceIndex(dims, orientation);
    index = Math.max(0, Math.min(index, maxIndex));
    if (index === currentIndex) return currentIndex;
    return index;
  }

  it('should clamp negative index to 0', () => {
    const dims: [number, number, number] = [64, 64, 64];
    expect(setSliceIndex(-10, dims, 'axial', 0)).toBe(0);
    expect(setSliceIndex(-1, dims, 'axial', 0)).toBe(0);
  });

  it('should clamp index beyond max', () => {
    const dims: [number, number, number] = [64, 64, 64];
    expect(setSliceIndex(100, dims, 'axial', 0)).toBe(63);
    expect(setSliceIndex(63, dims, 'axial', 0)).toBe(63);
  });

  it('should return current index if unchanged', () => {
    const dims: [number, number, number] = [64, 64, 64];
    const current = 30;
    expect(setSliceIndex(30, dims, 'axial', current)).toBe(30);
    expect(setSliceIndex(31, dims, 'axial', current)).not.toBe(30);
  });

  it('should respect orientation-specific max indices', () => {
    const dims: [number, number, number] = [100, 200, 300];
    expect(getMaxSliceIndex(dims, 'axial')).toBe(299);
    expect(getMaxSliceIndex(dims, 'coronal')).toBe(199);
    expect(getMaxSliceIndex(dims, 'sagittal')).toBe(99);
  });

  it('should handle single-slice volume', () => {
    const dims: [number, number, number] = [64, 64, 1];
    expect(setSliceIndex(0, dims, 'axial', 0)).toBe(0);
    expect(setSliceIndex(-1, dims, 'axial', 0)).toBe(0);
    expect(setSliceIndex(1, dims, 'axial', 0)).toBe(0);
  });
});

describe('Shader Window/Level Guard', () => {
  // The shader guards against zero/negative window width
  // Simulates the guard: Math.max(1, windowWidth)

  function guardWindowWidth(windowWidth: number): number {
    return Math.max(1, windowWidth);
  }

  it('should keep positive values unchanged', () => {
    expect(guardWindowWidth(255)).toBe(255);
    expect(guardWindowWidth(1)).toBe(1);
    expect(guardWindowWidth(1000)).toBe(1000);
  });

  it('should clamp zero to 1', () => {
    expect(guardWindowWidth(0)).toBe(1);
  });

  it('should clamp negative values to 1', () => {
    expect(guardWindowWidth(-10)).toBe(1);
    expect(guardWindowWidth(-255)).toBe(1);
  });

  it('should handle floating point window widths', () => {
    expect(guardWindowWidth(0.5)).toBe(1);
    expect(guardWindowWidth(1.5)).toBe(1.5);
  });
});

describe('Zero Container Early Return', () => {
  // When container has zero dimensions, render should return early
  // without scheduling another RAF

  function shouldSkipRender(containerW: number, containerH: number): boolean {
    return containerW === 0 || containerH === 0;
  }

  it('should skip render for zero width', () => {
    expect(shouldSkipRender(0, 512)).toBe(true);
  });

  it('should skip render for zero height', () => {
    expect(shouldSkipRender(512, 0)).toBe(true);
  });

  it('should skip render for both zero', () => {
    expect(shouldSkipRender(0, 0)).toBe(true);
  });

  it('should render for positive dimensions', () => {
    expect(shouldSkipRender(1, 1)).toBe(false);
    expect(shouldSkipRender(512, 512)).toBe(false);
  });
});
