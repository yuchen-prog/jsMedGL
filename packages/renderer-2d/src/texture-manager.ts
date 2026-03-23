// Texture Manager for 2D textures (uses WebGL2 for 3D support)

import type { TextureManager, TextureManagerOptions, TextureFormat } from './types';

export function createTextureManager(options: TextureManagerOptions): TextureManager {
  return new TextureManagerImpl(options.gl);
}

class TextureManagerImpl implements TextureManager {
  private gl: WebGL2RenderingContext;
  private cache: Map<string, WebGLTexture> = new Map();

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }

  uploadVolume(
    data: ArrayBuffer,
    dimensions: [number, number, number],
    dataType: string = 'uint8'
  ): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();

    if (!texture) {
      throw new Error('Failed to create WebGL texture');
    }

    gl.bindTexture(gl.TEXTURE_3D, texture);

    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const processedData = this.processData(data, dataType);

    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.R8,
      dimensions[0],
      dimensions[1],
      dimensions[2],
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      processedData
    );

    return texture;
  }

  createTexture(
    width: number,
    height: number,
    data: ArrayBufferView | null = null,
    format: TextureFormat = 'luminance'
  ): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();

    if (!texture) {
      throw new Error('Failed to create WebGL texture');
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const { internalFormat, texFormat, type } = this.getFormatConfig(format);

    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      internalFormat,
      width,
      height,
      0,
      texFormat,
      type,
      data
    );

    return texture;
  }

  deleteTexture(texture: WebGLTexture): void {
    this.gl.deleteTexture(texture);
    for (const [key, tex] of this.cache) {
      if (tex === texture) {
        this.cache.delete(key);
        break;
      }
    }
  }

  clearCache(): void {
    for (const texture of this.cache.values()) {
      this.gl.deleteTexture(texture);
    }
    this.cache.clear();
  }

  private getFormatConfig(format: TextureFormat): {
    internalFormat: number;
    texFormat: number;
    type: number;
  } {
    const gl = this.gl;

    switch (format) {
      case 'luminance':
        return { internalFormat: gl.R8, texFormat: gl.RED, type: gl.UNSIGNED_BYTE };
      case 'rgb':
        return { internalFormat: gl.RGB8, texFormat: gl.RGB, type: gl.UNSIGNED_BYTE };
      case 'rgba':
        return { internalFormat: gl.RGBA8, texFormat: gl.RGBA, type: gl.UNSIGNED_BYTE };
      default:
        return { internalFormat: gl.R8, texFormat: gl.RED, type: gl.UNSIGNED_BYTE };
    }
  }

  private processData(data: ArrayBuffer, dataType: string): Uint8Array {
    switch (dataType) {
      case 'uint8':
        return new Uint8Array(data);

      case 'int16': {
        const int16Data = new Int16Array(data);
        return this.normalizeInt16ToUint8(int16Data);
      }

      case 'float32': {
        const float32Data = new Float32Array(data);
        return this.normalizeFloat32ToUint8(float32Data);
      }

      case 'float64': {
        const float64Data = new Float64Array(data);
        return this.normalizeFloat32ToUint8(new Float32Array(float64Data));
      }

      default:
        return new Uint8Array(data);
    }
  }

  private normalizeInt16ToUint8(data: Int16Array): Uint8Array {
    const result = new Uint8Array(data.length);
    let min = Infinity;
    let max = -Infinity;

    for (let i = 0; i < data.length; i++) {
      if (data[i] < min) min = data[i];
      if (data[i] > max) max = data[i];
    }

    const range = max - min;
    if (range === 0) return result;

    for (let i = 0; i < data.length; i++) {
      result[i] = Math.floor(((data[i] - min) / range) * 255);
    }

    return result;
  }

  private normalizeFloat32ToUint8(data: Float32Array): Uint8Array {
    const result = new Uint8Array(data.length);
    let min = Infinity;
    let max = -Infinity;

    for (let i = 0; i < data.length; i++) {
      if (data[i] < min) min = data[i];
      if (data[i] > max) max = data[i];
    }

    const range = max - min;
    if (range === 0) return result;

    for (let i = 0; i < data.length; i++) {
      result[i] = Math.floor(((data[i] - min) / range) * 255);
    }

    return result;
  }
}
