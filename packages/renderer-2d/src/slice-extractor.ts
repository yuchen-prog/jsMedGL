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

const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_texCoord;

void main() {
  v_texCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision mediump float;

uniform sampler2D u_sliceTexture;
uniform float u_windowWidth;
uniform float u_windowCenter;

varying vec2 v_texCoord;

void main() {
  float intensity = texture2D(u_sliceTexture, v_texCoord).r;

  float minValue = u_windowCenter - u_windowWidth / 2.0;
  float maxValue = u_windowCenter + u_windowWidth / 2.0;

  float normalized = (intensity - minValue) / (maxValue - minValue);
  normalized = clamp(normalized, 0.0, 1.0);

  gl_FragColor = vec4(vec3(normalized), 1.0);
}
`;

class SliceExtractorImpl implements SliceExtractor {
  private gl: WebGL2RenderingContext;
  private volume: NiftiVolume;
  private program: WebGLProgram | null = null;
  private positionBuffer: WebGLBuffer | null = null;
  private uniforms: {
    sliceTexture: WebGLUniformLocation | null;
    windowWidth: WebGLUniformLocation | null;
    windowCenter: WebGLUniformLocation | null;
  } = {
    sliceTexture: null,
    windowWidth: null,
    windowCenter: null
  };
  private windowLevel: WindowLevel = { window: 255, level: 128 };
  private sliceTextures: Map<string, WebGLTexture> = new Map();
  private normalizedData: Uint8Array;

  constructor(gl: WebGL2RenderingContext, volume: NiftiVolume) {
    this.gl = gl;
    this.volume = volume;
    this.normalizedData = new Uint8Array(0);

    this.initShaders();
    this.initBuffers();
    this.normalizeVolumeData();
  }

  private initShaders(): void {
    const gl = this.gl;

    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    if (!vertexShader) throw new Error('Failed to create vertex shader');

    gl.shaderSource(vertexShader, VERTEX_SHADER);
    gl.compileShader(vertexShader);

    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
      throw new Error(`Vertex shader error: ${gl.getShaderInfoLog(vertexShader)}`);
    }

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    if (!fragmentShader) throw new Error('Failed to create fragment shader');

    gl.shaderSource(fragmentShader, FRAGMENT_SHADER);
    gl.compileShader(fragmentShader);

    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      gl.deleteShader(vertexShader);
      throw new Error(`Fragment shader error: ${gl.getShaderInfoLog(fragmentShader)}`);
    }

    const program = gl.createProgram();
    if (!program) throw new Error('Failed to create program');

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link error: ${gl.getProgramInfoLog(program)}`);
    }

    this.program = program;

    this.uniforms.sliceTexture = gl.getUniformLocation(program, 'u_sliceTexture');
    this.uniforms.windowWidth = gl.getUniformLocation(program, 'u_windowWidth');
    this.uniforms.windowCenter = gl.getUniformLocation(program, 'u_windowCenter');

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
  }

  private initBuffers(): void {
    const gl = this.gl;

    const vertices = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1
    ]);

    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('Failed to create buffer');

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    this.positionBuffer = buffer;
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

  setWindowLevel(windowLevel: WindowLevel): void {
    this.windowLevel = windowLevel;
  }

  renderToCanvas(
    _canvas: HTMLCanvasElement,
    orientation: SliceOrientation,
    sliceIndex: number
  ): void {
    const gl = this.gl;
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

    // Bind this.gl's framebuffer to null (default framebuffer)
    // But we need to render to the canvas that was passed in
    // The issue is that this.gl belongs to a different canvas
    // So we need to copy the result

    // Actually, we render to the internal canvas, then copy
    gl.viewport(0, 0, width, height);

    // Clear with red to see if rendering happens at all
    gl.clearColor(0.2, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const slice = this.extractSlice(orientation, sliceIndex);

    // Debug: check slice data
    console.log('[renderToCanvas] slice:', orientation, sliceIndex, 'size:', width, 'x', height);

    gl.useProgram(this.program);

    gl.uniform1i(this.uniforms.sliceTexture, 0);
    gl.uniform1f(this.uniforms.windowWidth, this.windowLevel.window);
    gl.uniform1f(this.uniforms.windowCenter, this.windowLevel.level);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, slice.texture);

    const positionLocation = gl.getAttribLocation(this.program!, 'a_position');
    gl.enableVertexAttribArray(positionLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Check for GL errors
    const err = gl.getError();
    if (err !== gl.NO_ERROR) {
      console.error('[renderToCanvas] GL error:', err);
    }
  }

  // Render to a specific viewport in the provided GL context
  renderToViewport(
    gl: WebGL2RenderingContext,
    orientation: SliceOrientation,
    sliceIndex: number,
    _width: number,
    _height: number
  ): void {
    // Get the slice data (this creates texture in our internal GL context)
    const slice = this.extractSlice(orientation, sliceIndex);

    // Use our internal GL context for rendering
    const internalGl = this.gl;

    // First render to our internal canvas
    const { dimensions } = this.volume;
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

    // Render to internal canvas
    internalGl.viewport(0, 0, sliceW, sliceH);
    internalGl.clearColor(0.1, 0.1, 0.1, 1.0);
    internalGl.clear(internalGl.COLOR_BUFFER_BIT);

    internalGl.useProgram(this.program);
    internalGl.uniform1i(this.uniforms.sliceTexture, 0);
    internalGl.uniform1f(this.uniforms.windowWidth, this.windowLevel.window);
    internalGl.uniform1f(this.uniforms.windowCenter, this.windowLevel.level);

    internalGl.activeTexture(internalGl.TEXTURE0);
    internalGl.bindTexture(internalGl.TEXTURE_2D, slice.texture);

    const positionLocation = internalGl.getAttribLocation(this.program!, 'a_position');
    internalGl.enableVertexAttribArray(positionLocation);
    internalGl.bindBuffer(internalGl.ARRAY_BUFFER, this.positionBuffer);
    internalGl.vertexAttribPointer(positionLocation, 2, internalGl.FLOAT, false, 0, 0);

    internalGl.drawArrays(internalGl.TRIANGLE_STRIP, 0, 4);

    // Now read pixels and draw to target context
    // Note: This is inefficient but works for now
    const pixels = new Uint8Array(sliceW * sliceH * 4);
    internalGl.readPixels(0, 0, sliceW, sliceH, internalGl.RGBA, internalGl.UNSIGNED_BYTE, pixels);

    // Flip the image (WebGL has origin at bottom-left)
    const flippedPixels = new Uint8Array(sliceW * sliceH * 4);
    for (let y = 0; y < sliceH; y++) {
      for (let x = 0; x < sliceW; x++) {
        const srcIdx = (y * sliceW + x) * 4;
        const dstIdx = ((sliceH - 1 - y) * sliceW + x) * 4;
        flippedPixels[dstIdx] = pixels[srcIdx];
        flippedPixels[dstIdx + 1] = pixels[srcIdx + 1];
        flippedPixels[dstIdx + 2] = pixels[srcIdx + 2];
        flippedPixels[dstIdx + 3] = pixels[srcIdx + 3];
      }
    }

    // Create a texture in the target GL context and upload
    const targetTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, targetTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, sliceW, sliceH, 0, gl.RGBA, gl.UNSIGNED_BYTE, flippedPixels);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // We need a simple program to render a textured quad
    // For now, clean up and return - we'll use a different approach
    gl.deleteTexture(targetTexture);
  }

  dispose(): void {
    const gl = this.gl;

    for (const texture of this.sliceTextures.values()) {
      gl.deleteTexture(texture);
    }
    this.sliceTextures.clear();

    if (this.positionBuffer) {
      gl.deleteBuffer(this.positionBuffer);
    }

    if (this.program) {
      gl.deleteProgram(this.program);
    }
  }
}
