// Slice Extractor - Extract 2D slices from 3D volume using WebGL

import type {
  SliceExtractor as ISliceExtractor,
  WindowLevel,
  ExtractedSlice
} from './types';

import type { NiftiVolume } from '@jsmedgl/parser-nifti';
import { getDataTypeSize, readVoxel } from '@jsmedgl/parser-nifti';

export interface SliceExtractor extends ISliceExtractor {}

type SliceOrientation = 'axial' | 'coronal' | 'sagittal';

export function createSliceExtractor(
  gl: WebGL2RenderingContext,
  volume: NiftiVolume
): SliceExtractor {
  return new SliceExtractorImpl(gl, volume);
}

class SliceExtractorImpl implements SliceExtractor {
  private gl: WebGL2RenderingContext;
  private volume: NiftiVolume;
  private sliceTextures: Map<string, WebGLTexture> = new Map();
  private normalizedData: Uint8Array;

  constructor(gl: WebGL2RenderingContext, volume: NiftiVolume) {
    this.gl = gl;
    this.volume = volume;
    this.normalizedData = new Uint8Array(0);

    this.normalizeVolumeData();
  }

  private normalizeVolumeData(): void {
    const { data, header } = this.volume;
    const datatype = header.datatype;
    const byteSize = getDataTypeSize(datatype);
    const numVoxels = data.byteLength / byteSize;

    // Find min/max
    let vMin = Infinity, vMax = -Infinity;
    const step = Math.max(1, Math.floor(numVoxels / 10000));
    for (let i = 0; i < numVoxels; i += step) {
      const v = readVoxel(data, i * byteSize, datatype);
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
    const range = vMax - vMin;

    // Normalize all data to Uint8Array
    this.normalizedData = new Uint8Array(numVoxels);
    for (let i = 0; i < numVoxels; i++) {
      const v = readVoxel(data, i * byteSize, datatype);
      let normalized = range > 0 ? Math.round(((v - vMin) / range) * 255) : (v > 0 ? 255 : 0);
      this.normalizedData[i] = Math.max(0, Math.min(255, normalized));
    }
  }

  extractAxial(sliceIndex: number): ExtractedSlice {
    return this.extractSlice('axial', sliceIndex);
  }

  extractCoronal(sliceIndex: number): ExtractedSlice {
    return this.extractSlice('coronal', sliceIndex);
  }

  extractSagittal(sliceIndex: number): ExtractedSlice {
    return this.extractSlice('sagittal', sliceIndex);
  }

  extractSlice(orientation: SliceOrientation, sliceIndex: number): ExtractedSlice {
    const gl = this.gl;
    const { dimensions } = this.volume;

    const maxIndex = this.getMaxSliceIndex(orientation);
    sliceIndex = Math.max(0, Math.min(sliceIndex, maxIndex));

    const cacheKey = `${orientation}-${sliceIndex}`;

    // Return cached texture if available
    if (this.sliceTextures.has(cacheKey)) {
      const cached = this.sliceTextures.get(cacheKey)!;
      return this.createExtractedSlice(orientation, sliceIndex, cached);
    }

    let width: number, height: number;
    switch (orientation) {
      case 'axial':
        width = dimensions[0];
        height = dimensions[1];
        break;
      case 'coronal':
        width = dimensions[0];
        height = dimensions[2];
        break;
      case 'sagittal':
        width = dimensions[1];
        height = dimensions[2];
        break;
    }

    const sliceTexture = gl.createTexture();
    if (!sliceTexture) throw new Error('Failed to create slice texture');

    gl.bindTexture(gl.TEXTURE_2D, sliceTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const sliceData = this.extractSliceData(orientation, sliceIndex);

    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      width,
      height,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      sliceData
    );

    this.cacheSliceTexture(cacheKey, sliceTexture);

    return this.createExtractedSlice(orientation, sliceIndex, sliceTexture);
  }

  private extractSliceData(orientation: SliceOrientation, sliceIndex: number): Uint8Array {
    const { dimensions } = this.volume;
    const d0 = dimensions[0], d1 = dimensions[1];

    let width: number, height: number;
    let sliceData: Uint8Array;

    if (orientation === 'axial') {
      // Axial: texture X → I (Left-Right), texture Y → J (Anterior-Posterior)
      // Reverse J so that:
      // - texture row 0 → J=d1-1 (Anterior) → rendered at canvas TOP
      // - texture row d1-1 → J=0 (Posterior) → rendered at canvas BOTTOM
      // This makes A at top, P at bottom (radiology standard).
      width = d0;
      height = d1;
      sliceData = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) {
        const ry = height - 1 - y; // reversed J
        for (let x = 0; x < width; x++) {
          const linearIdx = sliceIndex * d0 * d1 + ry * d0 + x;
          sliceData[y * width + x] = this.normalizedData[linearIdx];
        }
      }
    } else if (orientation === 'coronal') {
      // Coronal: texture X → I (Left-Right), texture Y → K (Superior-Inferior)
      // Texture row 0 renders at canvas TOP, so K=0 (Superior) at top, K=d2-1 (Inferior) at bottom.
      width = d0;
      height = dimensions[2];
      sliceData = new Uint8Array(width * height);
      for (let z = 0; z < height; z++) {
        for (let x = 0; x < width; x++) {
          const linearIdx = x + sliceIndex * d0 + z * d0 * d1;
          sliceData[z * width + x] = this.normalizedData[linearIdx];
        }
      }
    } else {
      // sagittal
      // texture X → J (Anterior-Posterior), texture Y → K (Superior-Inferior)
      // No J reversal: Anterior on LEFT, Posterior on RIGHT.
      // No K reversal: Superior (K=0) at canvas TOP, Inferior at canvas BOTTOM.
      width = d1;
      height = dimensions[2];
      sliceData = new Uint8Array(width * height);
      for (let z = 0; z < height; z++) {
        for (let y = 0; y < width; y++) {
          const linearIdx = sliceIndex + y * d0 + z * d0 * d1;
          sliceData[z * width + y] = this.normalizedData[linearIdx];
        }
      }
    }

    return sliceData;
  }

  private cacheSliceTexture(key: string, texture: WebGLTexture): void {
    const maxCacheSize = 30;

    if (this.sliceTextures.size >= maxCacheSize) {
      const oldestKey = this.sliceTextures.keys().next().value;
      if (oldestKey) {
        const oldTexture = this.sliceTextures.get(oldestKey);
        if (oldTexture) {
          this.gl.deleteTexture(oldTexture);
        }
        this.sliceTextures.delete(oldestKey);
      }
    }

    this.sliceTextures.set(key, texture);
  }

  private createExtractedSlice(
    orientation: SliceOrientation,
    sliceIndex: number,
    texture: WebGLTexture
  ): ExtractedSlice {
    const { dimensions } = this.volume;

    let width: number, height: number;
    switch (orientation) {
      case 'axial':
        width = dimensions[0];
        height = dimensions[1];
        break;
      case 'coronal':
        width = dimensions[0];
        height = dimensions[2];
        break;
      case 'sagittal':
        width = dimensions[1];
        height = dimensions[2];
        break;
    }

    return { texture, width, height, orientation, index: sliceIndex };
  }

  private getMaxSliceIndex(orientation: SliceOrientation): number {
    const { dimensions } = this.volume;
    switch (orientation) {
      case 'axial': return dimensions[2] - 1;
      case 'coronal': return dimensions[1] - 1;
      case 'sagittal': return dimensions[0] - 1;
    }
  }

  setWindowLevel(_windowLevel: WindowLevel): void {
    // Clear texture cache when window/level changes
    // (In a more sophisticated implementation, we'd apply W/L in shader)
    for (const texture of this.sliceTextures.values()) {
      this.gl.deleteTexture(texture);
    }
    this.sliceTextures.clear();
    // Window/Level is currently applied during normalization
    // Future: apply in shader for dynamic adjustment
  }

  // Check if a slice has any non-zero data
  hasData(orientation: SliceOrientation, sliceIndex: number): boolean {
    const { dimensions } = this.volume;
    const d0 = dimensions[0], d1 = dimensions[1], d2 = dimensions[2];

    if (orientation === 'axial') {
      const sliceSize = d0 * d1;
      const offset = sliceIndex * sliceSize;
      for (let i = 0; i < sliceSize; i++) {
        if (this.normalizedData[offset + i] > 0) return true;
      }
    } else if (orientation === 'coronal') {
      for (let z = 0; z < d2; z++) {
        for (let x = 0; x < d0; x++) {
          const linearIdx = x + sliceIndex * d0 + z * d0 * d1;
          if (this.normalizedData[linearIdx] > 0) return true;
        }
      }
    } else {
      // sagittal
      for (let z = 0; z < d2; z++) {
        for (let y = 0; y < d1; y++) {
          const linearIdx = sliceIndex + y * d0 + z * d0 * d1;
          if (this.normalizedData[linearIdx] > 0) return true;
        }
      }
    }
    return false;
  }

  // Find the first slice index that has data
  findFirstSliceWithData(orientation: SliceOrientation): number {
    const maxSlice = this.getMaxSliceIndex(orientation);
    for (let i = 0; i <= maxSlice; i++) {
      if (this.hasData(orientation, i)) {
        return i;
      }
    }
    return 0;
  }

  dispose(): void {
    const gl = this.gl;

    for (const texture of this.sliceTextures.values()) {
      gl.deleteTexture(texture);
    }
    this.sliceTextures.clear();
  }
}
