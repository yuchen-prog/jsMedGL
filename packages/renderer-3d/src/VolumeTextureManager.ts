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
  private gradientTexture: WebGLTexture | null = null;
  private _dimensions: [number, number, number] = [0, 0, 0];

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }

  /**
   * Normalize volume data to Uint8Array [0, 255] and upload as 3D texture.
   * Also pre-computes the gradient field as an RGBA8 texture.
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

    // Upload volume texture
    const volumeTex = gl.createTexture();
    if (!volumeTex) throw new Error('Failed to create 3D texture');

    gl.bindTexture(gl.TEXTURE_3D, volumeTex);
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

    // Upload pre-computed gradient texture
    const gradientData = this.computeGradientField(normalized, dims);
    const gradTex = gl.createTexture();
    if (!gradTex) throw new Error('Failed to create gradient texture');

    gl.bindTexture(gl.TEXTURE_3D, gradTex);
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.RGBA8,
      dims[0],
      dims[1],
      dims[2],
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      gradientData
    );

    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

    this.volumeTexture = volumeTex;
    this.gradientTexture = gradTex;
    this._dimensions = dims;

    return { texture: volumeTex, dimensions: dims };
  }

  get dimensions(): [number, number, number] {
    return this._dimensions;
  }

  getTexture(): WebGLTexture | null {
    return this.volumeTexture;
  }

  getGradientTexture(): WebGLTexture | null {
    return this.gradientTexture;
  }

  dispose(): void {
    if (this.volumeTexture) {
      this.gl.deleteTexture(this.volumeTexture);
      this.volumeTexture = null;
    }
    if (this.gradientTexture) {
      this.gl.deleteTexture(this.gradientTexture);
      this.gradientTexture = null;
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

  /**
   * Pre-compute the 3D gradient field using central difference.
   * Encoded as RGBA8:
   *   R = normal.x encoded to [0, 255] via (nx + 1) * 127.5
   *   G = normal.y encoded to [0, 255] via (ny + 1) * 127.5
   *   B = normal.z encoded to [0, 255] via (nz + 1) * 127.5
   *   A = gradient magnitude normalized to [0, 255] (max expected = 2.0 / 255 ≈ 0.008)
   */
  private computeGradientField(
    volume: Uint8Array,
    dims: [number, number, number]
  ): Uint8Array {
    const [w, h, d] = dims;
    const gradient = new Uint8Array(w * h * d * 4);
    const idx = (x: number, y: number, z: number): number => x + y * w + z * w * h;

    const step = 1; // 1 voxel step for central difference
    const maxMag = 2.0; // maximum gradient magnitude in [0,255] normalized space (step=1)

    for (let z = 0; z < d; z++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          // Clamp boundary samples to edge
          const x0 = Math.max(0, Math.min(w - 1, x - step));
          const x1 = Math.max(0, Math.min(w - 1, x + step));
          const y0 = Math.max(0, Math.min(h - 1, y - step));
          const y1 = Math.max(0, Math.min(h - 1, y + step));
          const z0 = Math.max(0, Math.min(d - 1, z - step));
          const z1 = Math.max(0, Math.min(d - 1, z + step));

          // Central difference in texture space (where 1 voxel = 1 unit)
          const gx = (volume[idx(x1, y, z)] - volume[idx(x0, y, z)]) / 255.0;
          const gy = (volume[idx(x, y1, z)] - volume[idx(x, y0, z)]) / 255.0;
          const gz = (volume[idx(x, y, z1)] - volume[idx(x, y, z0)]) / 255.0;

          const mag = Math.sqrt(gx * gx + gy * gy + gz * gz);
          const invMag = mag > 0.001 ? 1.0 / mag : 0.0;

          // Normalize gradient direction and encode
          const nx = (gx * invMag + 1.0) * 127.5;
          const ny = (gy * invMag + 1.0) * 127.5;
          const nz = (gz * invMag + 1.0) * 127.5;
          const magnitude = (mag / maxMag) * 255.0;

          const base = (idx(x, y, z)) * 4;
          gradient[base + 0] = Math.max(0, Math.min(255, Math.round(nx)));
          gradient[base + 1] = Math.max(0, Math.min(255, Math.round(ny)));
          gradient[base + 2] = Math.max(0, Math.min(255, Math.round(nz)));
          gradient[base + 3] = Math.max(0, Math.min(255, Math.round(magnitude)));
        }
      }
    }

    return gradient;
  }
}
