// WebGL Slice View - Pure WebGL-based slice rendering

import { createSliceExtractor, type SliceExtractor } from './slice-extractor';
import type { SliceOrientation, WindowLevel, OrientationLabels } from './types';
import type { NiftiVolume } from '@jsmedgl/parser-nifti';

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
  render(): void;
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
  private crosshairElement: HTMLElement | null = null;
  private labelsElement: HTMLElement | null = null;
  private listeners: Map<string, Set<(data: any) => void>> = new Map();

  // Display program for rendering textured quad to screen
  private displayProgram: WebGLProgram | null = null;
  private displayBuffer: WebGLBuffer | null = null;
  private displayUniforms: {
    u_texture: WebGLUniformLocation | null;
  } = { u_texture: null };

  constructor(volume: NiftiVolume, options: WebGLSliceViewOptions) {
    this.volume = volume;
    this.container = options.container;
    this.orientation = options.orientation || 'axial';
    this.sliceIndex = options.initialSliceIndex || 0;

    // Create WebGL canvas - this is the ONLY canvas we use
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

    // Initialize slice extractor with OUR WebGL context
    this.extractor = createSliceExtractor(gl, volume);
    this.extractor.setWindowLevel(options.initialWindowLevel || { window: 255, level: 128 });

    // Find first slice with data
    this.sliceIndex = this.findFirstSliceWithData();

    // Initialize display shader
    this.initDisplayShader();

    this.setupDOM();
    this.setupEventHandlers();

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
      varying vec2 v_texCoord;
      void main() {
        // Flip Y coordinate because WebGL texture Y is inverted
        vec2 texCoord = vec2(v_texCoord.x, 1.0 - v_texCoord.y);
        // Texture is R8 format (luminance in red channel), convert to grayscale
        float luminance = texture2D(u_texture, texCoord).r;
        gl_FragColor = vec4(luminance, luminance, luminance, 1.0);
      }
    `;

    // Create and compile vertex shader with error checking
    const vertexShader = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vertexShader, vertexShaderSource);
    gl.compileShader(vertexShader);
    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(vertexShader);
      gl.deleteShader(vertexShader);
      throw new Error('Vertex shader compilation error: ' + error);
    }

    // Create and compile fragment shader with error checking
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

    // Create fullscreen quad buffer
    this.displayBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.displayBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1,  -1, 1,  1, 1
    ]), gl.STATIC_DRAW);

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
  }

  private findFirstSliceWithData(): number {
    // Use extractor to find the first slice with actual data
    return this.extractor.findFirstSliceWithData(this.orientation);
  }

  private setupDOM(): void {
    this.container.innerHTML = '';
    this.container.style.position = 'relative';
    this.container.style.backgroundColor = '#000';
    this.container.style.overflow = 'hidden';

    this.container.appendChild(this.canvas);

    // Crosshair overlay
    this.crosshairElement = document.createElement('div');
    this.crosshairElement.style.cssText = `
      position: absolute; top: 0; left: 0; right: 0; bottom: 0;
      pointer-events: none; z-index: 10;
    `;
    this.crosshairElement.innerHTML = `
      <div style="position:absolute;height:1px;background:rgba(0,255,0,0.7);left:0;right:0;top:50%;"></div>
      <div style="position:absolute;width:1px;background:rgba(0,255,0,0.7);top:0;bottom:0;left:50%;"></div>
    `;
    this.container.appendChild(this.crosshairElement);

    // Orientation labels
    this.labelsElement = document.createElement('div');
    this.labelsElement.style.cssText = `
      position: absolute; top: 0; left: 0; right: 0; bottom: 0;
      pointer-events: none; z-index: 20;
      font-family: Arial; font-size: 14px; color: white;
      text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
    `;
    this.updateLabels();
    this.container.appendChild(this.labelsElement);
  }

  private setupEventHandlers(): void {
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.setSliceIndex(this.sliceIndex + (e.deltaY > 0 ? 1 : -1));
    });
  }

  private updateLabels(): void {
    if (!this.labelsElement) return;
    const labels = this.getOrientationLabels();
    this.labelsElement.innerHTML = `
      <div style="position:absolute;top:8px;left:50%;transform:translateX(-50%);">${labels.top}</div>
      <div style="position:absolute;bottom:8px;left:50%;transform:translateX(-50%);">${labels.bottom}</div>
      <div style="position:absolute;left:8px;top:50%;transform:translateY(-50%);">${labels.left}</div>
      <div style="position:absolute;right:8px;top:50%;transform:translateY(-50%);">${labels.right}</div>
    `;
  }

  private getOrientationLabels(): OrientationLabels {
    switch (this.orientation) {
      case 'axial': return { top: 'A', bottom: 'P', left: 'L', right: 'R' };
      case 'coronal': return { top: 'S', bottom: 'I', left: 'L', right: 'R' };
      case 'sagittal': return { top: 'S', bottom: 'I', left: 'A', right: 'P' };
    }
  }

  render(): void {
    const containerW = this.container.offsetWidth;
    const containerH = this.container.offsetHeight;

    if (containerW === 0 || containerH === 0) {
      requestAnimationFrame(() => this.render());
      return;
    }

    // Update canvas size if needed
    if (this.canvas.width !== containerW || this.canvas.height !== containerH) {
      this.canvas.width = containerW;
      this.canvas.height = containerH;
    }

    const gl = this.gl;
    const { dimensions } = this.volume;

    // Get slice dimensions
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

    // Calculate display area (centered, aspect ratio preserved)
    const scale = Math.min(containerW / sliceW, containerH / sliceH);
    const drawW = Math.floor(sliceW * scale);
    const drawH = Math.floor(sliceH * scale);
    const drawX = Math.floor((containerW - drawW) / 2);
    const drawY = Math.floor((containerH - drawH) / 2);

    // Clear entire canvas to black
    gl.viewport(0, 0, containerW, containerH);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Get the slice texture from extractor
    const slice = this.extractor.extractSlice(this.orientation, this.sliceIndex);

    // Render to the display area only
    gl.viewport(drawX, drawY, drawW, drawH);
    gl.scissor(drawX, drawY, drawW, drawH);
    gl.enable(gl.SCISSOR_TEST);

    // Use display program to render the slice texture
    gl.useProgram(this.displayProgram);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, slice.texture);
    gl.uniform1i(this.displayUniforms.u_texture, 0);

    const posLoc = gl.getAttribLocation(this.displayProgram!, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.displayBuffer);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.disable(gl.SCISSOR_TEST);
  }

  setSliceIndex(index: number): void {
    const maxIndex = this.getMaxSliceIndex();
    index = Math.max(0, Math.min(index, maxIndex));
    if (index === this.sliceIndex) return;
    this.sliceIndex = index;
    this.render();
    this.emit('sliceChange', { orientation: this.orientation, index: this.sliceIndex });
  }

  getSliceIndex(): number {
    return this.sliceIndex;
  }

  setWindowLevel(window: number, level: number): void {
    this.extractor.setWindowLevel({ window, level });
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

  on(event: string, callback: (data: any) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: (data: any) => void): void {
    this.listeners.get(event)?.delete(callback);
  }

  private emit(event: string, data?: any): void {
    this.listeners.get(event)?.forEach(cb => cb(data));
  }

  dispose(): void {
    this.extractor.dispose();

    if (this.displayProgram) {
      this.gl.deleteProgram(this.displayProgram);
    }
    if (this.displayBuffer) {
      this.gl.deleteBuffer(this.displayBuffer);
    }

    this.listeners.clear();
    this.container.innerHTML = '';
  }
}
