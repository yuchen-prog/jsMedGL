// TransferFunction - Maps voxel intensity to color + opacity via 1D lookup textures

import type { ColormapName } from './types';
import { buildColorLUT } from '@jsmedgl/core';
import { buildOpacityLUT } from '@jsmedgl/core';

/**
 * Manages color and opacity transfer functions as WebGL textures.
 */
export class TransferFunction {
  private gl: WebGL2RenderingContext;
  private colorTexture: WebGLTexture | null = null;
  private opacityTexture: WebGLTexture | null = null;
  private currentColormap: ColormapName = 'grayscale';
  private currentWindow = 1.0;
  private currentLevel = 0.5;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.initTextures();
  }

  private initTextures(): void {
    const gl = this.gl;

    // Color LUT: 256×1 RGB texture
    this.colorTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.colorTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Opacity LUT: 256×1 R texture
    this.opacityTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.opacityTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Upload initial data
    this.updateColorLUT(this.currentColormap);
    this.updateOpacityLUT(this.currentWindow, this.currentLevel);
  }

  setColormap(colormap: ColormapName): void {
    if (colormap === this.currentColormap) return;
    this.currentColormap = colormap;
    this.updateColorLUT(colormap);
  }

  setWindowLevel(window: number, level: number): void {
    if (window === this.currentWindow && level === this.currentLevel) return;
    this.currentWindow = window;
    this.currentLevel = level;
    this.updateOpacityLUT(window, level);
  }

  getColorTexture(): WebGLTexture | null {
    return this.colorTexture;
  }

  getOpacityTexture(): WebGLTexture | null {
    return this.opacityTexture;
  }

  getColormap(): ColormapName {
    return this.currentColormap;
  }

  dispose(): void {
    if (this.colorTexture) {
      this.gl.deleteTexture(this.colorTexture);
      this.colorTexture = null;
    }
    if (this.opacityTexture) {
      this.gl.deleteTexture(this.opacityTexture);
      this.opacityTexture = null;
    }
  }

  private updateColorLUT(colormap: ColormapName): void {
    const gl = this.gl;
    const data = buildColorLUT(colormap);
    gl.bindTexture(gl.TEXTURE_2D, this.colorTexture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGB8,
      256, 1, 0,
      gl.RGB, gl.UNSIGNED_BYTE, data
    );
  }

  private updateOpacityLUT(window: number, level: number): void {
    const gl = this.gl;
    const data = buildOpacityLUT(window, level);
    gl.bindTexture(gl.TEXTURE_2D, this.opacityTexture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R8,
      256, 1, 0,
      gl.RED, gl.UNSIGNED_BYTE, data
    );
  }
}
