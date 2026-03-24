// Slice Extractor - Extract 2D slices from 3D volume using WebGL

import type {
  SliceExtractor as ISliceExtractor,
  WindowLevel,
  ExtractedSlice
} from './types';

import type { NiftiVolume } from '@jsmedgl/parser-nifti';

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

  private getDataTypeSize(datatype: number): number {
    const sizes: Record<number, number> = {
      2: 1, 4: 2, 8: 4, 16: 4, 64: 8,
      256: 1, 512: 2, 768: 4, 1024: 8, 1280: 8
    };
    return sizes[datatype] || 1;
  }

  private readVoxel(data: ArrayBuffer, datatype: number, byteOffset: number): number {
    const view = new DataView(data, byteOffset);
    switch (datatype) {
      case 2:   return view.getUint8(0);
      case 4:   return view.getInt16(0, true);
      case 8:   return view.getInt32(0, true);
      case 16:  return view.getFloat32(0, true);
      case 64:  return view.getFloat64(0, true);
      case 256: return view.getInt8(0);
      case 512: return view.getUint16(0, true);
      case 768: return view.getUint32(0, true);
      default:  return view.getUint8(0);
    }
  }

  private normalizeVolumeData(): void {
    const { data, header } = this.volume;
    const datatype = header.datatype;
    const byteSize = this.getDataTypeSize(datatype);
    const numVoxels = data.byteLength / byteSize;

    // Find min/max
    let vMin = Infinity, vMax = -Infinity;
    const step = Math.max(1, Math.floor(numVoxels / 10000));
    for (let i = 0; i < numVoxels; i += step) {
      const v = this.readVoxel(data, datatype, i * byteSize);
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
    const range = vMax - vMin;

    // Normalize all data to Uint8Array
    this.normalizedData = new Uint8Array(numVoxels);
    for (let i = 0; i < numVoxels; i++) {
      const v = this.readVoxel(data, datatype, i * byteSize);
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
      width = d0;
      height = d1;
      sliceData = new Uint8Array(width * height);
      const offset = sliceIndex * width * height;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          sliceData[y * width + x] = this.normalizedData[offset + y * width + x];
        }
      }
    } else if (orientation === 'coronal') {
      // Coronal: texture row maps to Z (slice thickness).
      // WebGL uploads row 0 to rendered bottom, so we reverse the Z index
      // so that Z=d2-1 (Superior, top of head) appears at rendered top.
      width = d0;
      height = dimensions[2];
      sliceData = new Uint8Array(width * height);
      for (let z = 0; z < height; z++) {
        const rz = height - 1 - z; // reversed Z: 0→bottom, height-1→top
        for (let x = 0; x < width; x++) {
          const linearIdx = x + sliceIndex * d0 + rz * d0 * d1;
          sliceData[z * width + x] = this.normalizedData[linearIdx];
        }
      }
    } else {
      // sagittal
      // texture X → J (Left/Right), texture Y → K (Superior/Inferior)
      // Reverse K so Superior (K=d2-1) appears at rendered top.
      width = d1;
      height = dimensions[2];
      sliceData = new Uint8Array(width * height);
      for (let z = 0; z < height; z++) {
        const rz = height - 1 - z; // reversed K: 0→bottom, height-1→top
        for (let y = 0; y < width; y++) {
          const linearIdx = sliceIndex + y * d0 + rz * d0 * d1;
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
