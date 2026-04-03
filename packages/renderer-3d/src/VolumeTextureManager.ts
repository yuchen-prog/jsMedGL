// VolumeTextureManager - Upload NIfTI volume data as WebGL 3D texture

import type { NiftiVolume } from '@jsmedgl/parser-nifti';
import { getDataTypeSize, readVoxel } from '@jsmedgl/parser-nifti';

export interface VolumeTexture {
  texture: WebGLTexture;
  dimensions: [number, number, number];
}

// = 0x8073
const MAX_3D_TEXTURE_SIZE = 0x8073;

/**
 * Manage 3D volume texture lifecycle: normalize data, upload, dispose.
 */
export class VolumeTextureManager {
  private gl: WebGL2RenderingContext;
  private volumeTexture: WebGLTexture | null = null;
  private _dimensions: [number, number, number] = [0, 0, 0];

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }

  /**
   * Normalize volume data to Uint8Array [0, 255] and upload as 3D texture.
   */
  upload(volume: NiftiVolume): VolumeTexture {
    const gl = this.gl;

    this.dispose();

    const normalized = this.normalizeVolumeData(volume);
    const dims: [number, number, number] = [
      volume.dimensions[0],
      volume.dimensions[1],
      volume.dimensions[2],
    ];

    const max3DSize = gl.getParameter(MAX_3D_TEXTURE_SIZE) as number;
    if (dims[0] > max3DSize || dims[1] > max3DSize || dims[2] > max3DSize) {
      throw new Error(
        `Volume dimensions ${dims.join('x')} exceed MAX_3D_TEXTURE_SIZE (${max3DSize}). ` +
        `Downsampling is not yet implemented.`
      );
    }

    const texture = gl.createTexture();
    if (!texture) throw new Error('Failed to create 3D texture');

    gl.bindTexture(gl.TEXTURE_3D, texture);
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.R8,
      dims[0],
      dims[1],
      dims[2],
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      normalized
    );

    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

    this.volumeTexture = texture;
    this._dimensions = dims;

    return { texture, dimensions: dims };
  }

  get dimensions(): [number, number, number] {
    return this._dimensions;
  }

  getTexture(): WebGLTexture | null {
    return this.volumeTexture;
  }

  dispose(): void {
    if (this.volumeTexture) {
      this.gl.deleteTexture(this.volumeTexture);
      this.volumeTexture = null;
    }
    this._dimensions = [0, 0, 0];
  }

  private normalizeVolumeData(volume: NiftiVolume): Uint8Array {
    const { data, header } = volume;
    const datatype = header.datatype;
    const byteSize = getDataTypeSize(datatype);

    if (byteSize === 0) {
      throw new Error(`Unsupported datatype for 3D rendering: ${datatype}`);
    }

    const numVoxels = data.byteLength / byteSize;

    let vMin = Infinity;
    let vMax = -Infinity;
    const sampleStep = Math.max(1, Math.floor(numVoxels / 10000));
    for (let i = 0; i < numVoxels; i += sampleStep) {
      const v = readVoxel(data, i * byteSize, datatype);
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
    const range = vMax - vMin;

    const result = new Uint8Array(numVoxels);
    for (let i = 0; i < numVoxels; i++) {
      const v = readVoxel(data, i * byteSize, datatype);
      const normalized =
        range > 0
          ? Math.round(((v - vMin) / range) * 255)
          : v > 0
            ? 255
            : 0;
      result[i] = Math.max(0, Math.min(255, normalized));
    }

    return result;
  }
}
