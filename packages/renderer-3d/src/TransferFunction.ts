// TransferFunction - Maps voxel intensity to color + opacity via 1D lookup textures

import type { ColormapName } from './types';

/**
 * Colormap data: array of [position (0-1), R, G, B] control points.
 * These are interpolated to fill a 256-entry LUT.
 */
const COLORMAP_DATA: Record<ColormapName, [number, number, number, number][]> = {
  grayscale: [
    [0.0, 0, 0, 0],
    [1.0, 255, 255, 255],
  ],
  hot: [
    [0.0, 0, 0, 0],
    [0.3, 255, 0, 0],
    [0.6, 255, 255, 0],
    [1.0, 255, 255, 255],
  ],
  bone: [
    [0.0, 0, 0, 0],
    [0.3, 80, 80, 90],
    [0.6, 160, 160, 170],
    [1.0, 255, 255, 255],
  ],
  iron: [
    [0.0, 0, 0, 20],
    [0.25, 30, 0, 120],
    [0.5, 200, 0, 0],
    [0.75, 255, 200, 0],
    [1.0, 255, 255, 255],
  ],
  viridis: [
    [0.0, 68, 1, 84],
    [0.25, 59, 82, 139],
    [0.5, 33, 145, 140],
    [0.75, 94, 201, 98],
    [1.0, 253, 231, 37],
  ],
  airways: [
    [0.0, 0, 0, 0],
    [0.2, 0, 40, 60],
    [0.5, 0, 120, 160],
    [0.8, 100, 200, 230],
    [1.0, 220, 255, 255],
  ],
  angiography: [
    [0.0, 0, 0, 0],
    [0.2, 80, 80, 80],
    [0.4, 200, 200, 200],
    [0.6, 255, 100, 50],
    [0.8, 255, 180, 0],
    [1.0, 255, 255, 100],
  ],
  pet: [
    [0.0, 0, 0, 0],
    [0.15, 50, 0, 80],
    [0.3, 0, 0, 180],
    [0.45, 0, 120, 200],
    [0.6, 0, 200, 80],
    [0.75, 200, 220, 0],
    [0.9, 255, 80, 0],
    [1.0, 255, 255, 255],
  ],
  soft_tissue: [
    [0.0, 0, 0, 0],
    [0.3, 60, 40, 35],
    [0.6, 160, 130, 110],
    [1.0, 255, 240, 225],
  ],
  lung: [
    [0.0, 0, 0, 0],
    [0.15, 0, 30, 30],
    [0.4, 50, 90, 90],
    [0.7, 150, 160, 160],
    [1.0, 255, 255, 255],
  ],
};

/**
 * Interpolate colormap control points into a 256-entry RGB array.
 */
function buildColorLUT(colormap: ColormapName): Uint8Array {
  const controlPoints = COLORMAP_DATA[colormap];
  const lut = new Uint8Array(256 * 3);

  for (let i = 0; i < 256; i++) {
    const t = i / 255;

    // Find surrounding control points
    let lo = controlPoints[0];
    let hi = controlPoints[controlPoints.length - 1];

    for (let j = 0; j < controlPoints.length - 1; j++) {
      if (t >= controlPoints[j][0] && t <= controlPoints[j + 1][0]) {
        lo = controlPoints[j];
        hi = controlPoints[j + 1];
        break;
      }
    }

    // Interpolate
    const range = hi[0] - lo[0];
    const f = range > 0 ? (t - lo[0]) / range : 0;

    lut[i * 3 + 0] = Math.round(lo[1] + (hi[1] - lo[1]) * f);
    lut[i * 3 + 1] = Math.round(lo[2] + (hi[2] - lo[2]) * f);
    lut[i * 3 + 2] = Math.round(lo[3] + (hi[3] - lo[3]) * f);
  }

  return lut;
}

/**
 * Build opacity LUT from window/level.
 * Opacity ramp: 0 below window, smoothstep ramp within window, full above.
 */
function buildOpacityLUT(window: number, level: number): Uint8Array {
  const lut = new Uint8Array(256);
  const halfW = window / 2;
  const lo = level - halfW;
  const hi = level + halfW;

  for (let i = 0; i < 256; i++) {
    const intensity = i / 255;
    if (intensity <= lo) {
      lut[i] = 0;
    } else if (intensity >= hi) {
      lut[i] = 255;
    } else {
      // Smoothstep for soft transition
      const t = (intensity - lo) / (hi - lo);
      const smooth = t * t * (3 - 2 * t);
      lut[i] = Math.round(smooth * 255);
    }
  }

  return lut;
}

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
