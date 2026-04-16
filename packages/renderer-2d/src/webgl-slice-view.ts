// WebGL Slice View - Pure rendering engine. All interaction (mouse, wheel, crosshair)
// is handled by the React layer. This module only manages WebGL rendering.

import { createSliceExtractor, type SliceExtractor } from './slice-extractor';
import type { SliceOrientation, WindowLevel, CrosshairPosition } from './types';
import type { NiftiVolume } from '@jsmedgl/parser-nifti';
import type { ObliquePlaneComputed } from './oblique/types';
import type { ObliqueExtractor } from './oblique/ObliqueExtractor';

export interface WebGLSliceViewOptions {
  container: HTMLElement;
  orientation?: SliceOrientation;
  initialWindowLevel?: WindowLevel;
  initialSliceIndex?: number;
}

export interface WebGLSliceView {
  setSliceIndex(index: number): void;
  getSliceIndex(): number;
  setWindowLevel(window: number, level: number): void;
  /** Get the display rect (image area within container) */
  getDisplayRect(): { x: number; y: number; width: number; height: number };
  /**
   * Convert pixel coords (relative to container top-left) to volume IJK coords.
   * Returns null if the point is outside the image area.
   */
  mouseToIJK(localX: number, localY: number): CrosshairPosition | null;
  /** Trigger a render. Call after slice/windowLevel changes. */
  render(): void;
  /** Set oblique plane for rendering (replaces orthogonal slice) */
  setObliquePlane(plane: ObliquePlaneComputed, extractor: ObliqueExtractor): void;
  /** Clear oblique mode, return to orthogonal slice rendering */
  clearObliquePlane(): void;
  /** Get normalized Uint8Array [0, 255] for sharing with ObliqueExtractor */
  getNormalizedData(): Uint8Array;
  dispose(): void;
}

export function createWebGLSliceView(
  volume: NiftiVolume,
  options: WebGLSliceViewOptions
): WebGLSliceView {
  return new WebGLSliceViewImpl(volume, options);
}

class WebGLSliceViewImpl implements WebGLSliceView {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private extractor: SliceExtractor;
  private orientation: SliceOrientation;
  private sliceIndex: number = 0;
  private volume: NiftiVolume;

  // Display program for rendering textured quad to screen
  private displayProgram: WebGLProgram | null = null;
  private displayBuffer: WebGLBuffer | null = null;
  private displayUniforms: {
    u_texture: WebGLUniformLocation | null;
    u_windowWidth: WebGLUniformLocation | null;
    u_windowCenter: WebGLUniformLocation | null;
  } = { u_texture: null, u_windowWidth: null, u_windowCenter: null };

  // Current window/level settings
  private windowLevel: WindowLevel = { window: 255, level: 128 };

  // Cached display rect (updated on render)
  private displayRect = { x: 0, y: 0, width: 0, height: 0 };

  // Oblique mode state
  private obliquePlane: ObliquePlaneComputed | null = null;
  private obliqueExtractor: ObliqueExtractor | null = null;
  private obliqueTexture: WebGLTexture | null = null;

  constructor(volume: NiftiVolume, options: WebGLSliceViewOptions) {
    this.volume = volume;
    this.container = options.container;
    this.orientation = options.orientation || 'axial';
    this.sliceIndex = options.initialSliceIndex || 0;

    // Create WebGL canvas
    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';

    // Get WebGL2 context
    const gl = this.canvas.getContext('webgl2', {
      preserveDrawingBuffer: true,
      premultipliedAlpha: false
    });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;

    // Initialize slice extractor
    this.extractor = createSliceExtractor(gl, volume);

    // Store initial window/level
    this.windowLevel = options.initialWindowLevel || { window: 255, level: 128 };

    // Use provided initialSliceIndex if given, otherwise find first slice with data
    if (options.initialSliceIndex !== undefined) {
      this.sliceIndex = options.initialSliceIndex;
    } else {
      this.sliceIndex = this.findFirstSliceWithData();
    }

    this.initDisplayShader();
    this.setupDOM();

    // Delay first render to ensure container has proper size
    requestAnimationFrame(() => this.render());
  }

  private initDisplayShader(): void {
    const gl = this.gl;

    const vertexShaderSource = `
      attribute vec2 a_position;
      varying vec2 v_texCoord;
      void main() {
        v_texCoord = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    const fragmentShaderSource = `
      precision mediump float;
      uniform sampler2D u_texture;
      uniform float u_windowWidth;
      uniform float u_windowCenter;
      varying vec2 v_texCoord;
      void main() {
        float intensity = texture2D(u_texture, v_texCoord).r * 255.0;

        float minValue = u_windowCenter - u_windowWidth / 2.0;
        float maxValue = u_windowCenter + u_windowWidth / 2.0;
        float normalized = (intensity - minValue) / (maxValue - minValue);
        normalized = clamp(normalized, 0.0, 1.0);

        gl_FragColor = vec4(normalized, normalized, normalized, 1.0);
      }
    `;

    const vertexShader = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vertexShader, vertexShaderSource);
    gl.compileShader(vertexShader);
    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(vertexShader);
      gl.deleteShader(vertexShader);
      throw new Error('Vertex shader compilation error: ' + error);
    }

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fragmentShader, fragmentShaderSource);
    gl.compileShader(fragmentShader);
    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(fragmentShader);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      throw new Error('Fragment shader compilation error: ' + error);
    }

    this.displayProgram = gl.createProgram()!;
    gl.attachShader(this.displayProgram, vertexShader);
    gl.attachShader(this.displayProgram, fragmentShader);
    gl.linkProgram(this.displayProgram);

    if (!gl.getProgramParameter(this.displayProgram, gl.LINK_STATUS)) {
      const error = gl.getProgramInfoLog(this.displayProgram);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      gl.deleteProgram(this.displayProgram);
      this.displayProgram = null;
      throw new Error('Display shader link error: ' + error);
    }

    this.displayUniforms.u_texture = gl.getUniformLocation(this.displayProgram, 'u_texture');
    this.displayUniforms.u_windowWidth = gl.getUniformLocation(this.displayProgram, 'u_windowWidth');
    this.displayUniforms.u_windowCenter = gl.getUniformLocation(this.displayProgram, 'u_windowCenter');

    this.displayBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.displayBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1,  -1, 1,  1, 1
    ]), gl.STATIC_DRAW);

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
  }

  private findFirstSliceWithData(): number {
    return this.extractor.findFirstSliceWithData(this.orientation);
  }

  private setupDOM(): void {
    // Don't clear innerHTML — the container may contain React-rendered overlays
    // (e.g. crosshair elements) that we must preserve.
    // Note: position, backgroundColor, overflow are set via CSS classes.
    this.container.appendChild(this.canvas);
  }

  /** Get the display rect (image area within container, centered, aspect preserved) */
  getDisplayRect(): { x: number; y: number; width: number; height: number } {
    return { ...this.displayRect };
  }

  /**
   * Convert pixel coords (relative to container top-left) to volume IJK coords.
   * Returns null if the point is outside the image area.
   */
  mouseToIJK(localX: number, localY: number): CrosshairPosition | null {
    const { x, y, width, height } = this.displayRect;
    const { dimensions } = this.volume;

    if (localX < x || localX > x + width || localY < y || localY > y + height) {
      return null;
    }

    const nx = (localX - x) / width;
    // Shader Y-flip: texture row 0 renders at canvas TOP
    const ny = (localY - y) / height;

    let sliceW: number, sliceH: number;
    switch (this.orientation) {
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
    switch (this.orientation) {
      case 'axial':
        i = Math.min(px, dimensions[0] - 1);
        j = Math.min(py, dimensions[1] - 1);
        k = this.sliceIndex;
        break;
      case 'coronal':
        i = Math.min(px, dimensions[0] - 1);
        j = this.sliceIndex;
        k = Math.min(py, dimensions[2] - 1);
        break;
      case 'sagittal':
        i = this.sliceIndex;
        j = Math.min(px, dimensions[1] - 1);
        k = Math.min(py, dimensions[2] - 1);
        break;
    }

    return { i, j, k };
  }

  render(): void {
    const containerW = this.container.offsetWidth;
    const containerH = this.container.offsetHeight;

    if (containerW === 0 || containerH === 0) {
      return;
    }

    if (this.canvas.width !== containerW || this.canvas.height !== containerH) {
      this.canvas.width = containerW;
      this.canvas.height = containerH;
    }

    const gl = this.gl;
    const { dimensions, spacing } = this.volume;

    let sliceW: number, sliceH: number;
    let texture: WebGLTexture;

    if (this.obliquePlane && this.obliqueExtractor) {
      // Oblique mode: extract slice via CPU, upload as texture
      const result = this.obliqueExtractor.extractSlice(this.obliquePlane);
      sliceW = result.width;
      sliceH = result.height;
      texture = this.uploadObliqueTexture(result.data, sliceW, sliceH);
    } else {
      // Orthogonal mode: use WebGL slice extractor
      switch (this.orientation) {
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
      const slice = this.extractor.extractSlice(this.orientation, this.sliceIndex);
      texture = slice.texture;
    }

    // Calculate display area (centered, aspect ratio preserved).
    // Use physical dimensions so that the rendered proportions match the
    // real-world object geometry (e.g. anisotropic DICOM data with
    // 0.5×0.5×2mm voxels won't look stretched).
    let physW: number, physH: number;
    if (this.obliquePlane && this.obliqueExtractor) {
      // Oblique: result dimensions are already in physical units (mm)
      physW = sliceW;
      physH = sliceH;
    } else {
      // Orthogonal: compute physical size from voxel count × spacing
      switch (this.orientation) {
        case 'axial':
          physW = dimensions[0] * spacing[0];
          physH = dimensions[1] * spacing[1];
          break;
        case 'coronal':
          physW = dimensions[0] * spacing[0];
          physH = dimensions[2] * spacing[2];
          break;
        case 'sagittal':
          physW = dimensions[1] * spacing[1];
          physH = dimensions[2] * spacing[2];
          break;
      }
    }

    const scale = Math.min(containerW / physW, containerH / physH);
    const drawW = Math.floor(physW * scale);
    const drawH = Math.floor(physH * scale);
    const drawX = Math.floor((containerW - drawW) / 2);
    const drawY = Math.floor((containerH - drawH) / 2);

    // Cache display rect for coordinate transforms
    this.displayRect = { x: drawX, y: drawY, width: drawW, height: drawH };

    // Clear entire canvas to black
    gl.viewport(0, 0, containerW, containerH);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Render to the display area only
    gl.viewport(drawX, drawY, drawW, drawH);
    gl.scissor(drawX, drawY, drawW, drawH);
    gl.enable(gl.SCISSOR_TEST);

    gl.useProgram(this.displayProgram);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this.displayUniforms.u_texture, 0);
    const safeWindowWidth = Math.max(1, this.windowLevel.window);
    gl.uniform1f(this.displayUniforms.u_windowWidth, safeWindowWidth);
    gl.uniform1f(this.displayUniforms.u_windowCenter, this.windowLevel.level);

    const posLoc = gl.getAttribLocation(this.displayProgram!, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.displayBuffer);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.disable(gl.SCISSOR_TEST);
  }

  /**
   * Upload oblique slice data (Uint8Array) as a WebGL texture
   */
  private uploadObliqueTexture(data: Uint8Array, width: number, height: number): WebGLTexture {
    const gl = this.gl;

    // Reuse or create texture
    if (!this.obliqueTexture) {
      this.obliqueTexture = gl.createTexture();
    }

    gl.bindTexture(gl.TEXTURE_2D, this.obliqueTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      width,
      height,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      data
    );

    return this.obliqueTexture;
  }

  setObliquePlane(plane: ObliquePlaneComputed, extractor: ObliqueExtractor): void {
    this.obliquePlane = plane;
    this.obliqueExtractor = extractor;
    this.render();
  }

  clearObliquePlane(): void {
    this.obliquePlane = null;
    this.obliqueExtractor = null;
    if (this.obliqueTexture) {
      this.gl.deleteTexture(this.obliqueTexture);
      this.obliqueTexture = null;
    }
    this.render();
  }

  getNormalizedData(): Uint8Array {
    return this.extractor.getNormalizedData();
  }

  setSliceIndex(index: number): void {
    const maxIndex = this.getMaxSliceIndex();
    index = Math.max(0, Math.min(index, maxIndex));
    if (index === this.sliceIndex) return;
    this.sliceIndex = index;
    this.render();
  }

  getSliceIndex(): number {
    return this.sliceIndex;
  }

  setWindowLevel(window: number, level: number): void {
    this.windowLevel = { window, level };
    this.render();
  }

  private getMaxSliceIndex(): number {
    const dims = this.volume.dimensions;
    switch (this.orientation) {
      case 'axial': return dims[2] - 1;
      case 'coronal': return dims[1] - 1;
      case 'sagittal': return dims[0] - 1;
    }
  }

  dispose(): void {
    this.extractor.dispose();

    if (this.obliqueTexture) {
      this.gl.deleteTexture(this.obliqueTexture);
      this.obliqueTexture = null;
    }

    if (this.displayProgram) {
      this.gl.deleteProgram(this.displayProgram);
    }
    if (this.displayBuffer) {
      this.gl.deleteBuffer(this.displayBuffer);
    }

    // R-01: Remove canvas from DOM to prevent element accumulation
    this.canvas.remove();
  }
}
