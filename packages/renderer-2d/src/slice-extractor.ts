// Slice Extractor - Extract 2D slices from 3D volume

import type {
  SliceExtractor,
  SliceOrientation,
  WindowLevel,
  ExtractedSlice
} from './types';

import type { NiftiVolume } from '@jsmedgl/parser-nifti';

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
  private volumeTexture: WebGLTexture | null = null;
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

  constructor(gl: WebGL2RenderingContext, volume: NiftiVolume) {
    this.gl = gl;
    this.volume = volume;
    this.initShaders();
    this.initBuffers();
    this.uploadVolumeData();
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

  private uploadVolumeData(): void {
    const gl = this.gl;
    const { dimensions, data } = this.volume;

    console.log('[SliceExtractor] Uploading volume data');
    console.log('[SliceExtractor] Dimensions:', dimensions);
    console.log('[SliceExtractor] Data byteLength:', data.byteLength);
    console.log('[SliceExtractor] Data constructor:', data.constructor.name);

    // Check raw data at multiple positions
    const raw = new Uint8Array(data);
    console.log('[SliceExtractor] Raw bytes [0:10]:', Array.from(raw.slice(0, 10)));
    console.log('[SliceExtractor] Raw bytes [352:362]:', Array.from(raw.slice(352, 362)));
    console.log('[SliceExtractor] Raw bytes [10000:10010]:', Array.from(raw.slice(10000, 10010)));

    // Find min/max and first non-zero position
    let min = 255, max = 0, firstNonZero = -1;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] > max) max = raw[i];
      if (raw[i] < min) min = raw[i];
      if (firstNonZero < 0 && raw[i] > 0) firstNonZero = i;
    }
    console.log('[SliceExtractor] Full volume data - min:', min, 'max:', max, 'firstNonZero:', firstNonZero);

    // Scan a few slices to find where data is
    const sliceSize = dimensions[0] * dimensions[1];
    for (let z = 0; z < Math.min(10, dimensions[2]); z++) {
      const offset = z * sliceSize;
      let nonZero = 0;
      for (let i = 0; i < sliceSize; i++) {
        if (raw[offset + i] > 0) nonZero++;
      }
      console.log('[SliceExtractor] Slice', z, '- nonZero voxels:', nonZero, '/', sliceSize);
    }

    const texture = gl.createTexture();
    if (!texture) throw new Error('Failed to create 3D texture');

    gl.bindTexture(gl.TEXTURE_3D, texture);

    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // Convert data to Uint8Array and normalize to visible range
    let uint8Data: Uint8Array;
    if (data instanceof Uint8Array) {
      uint8Data = data;
    } else {
      uint8Data = new Uint8Array(data);
    }

    // Normalize data to [0, 255] based on actual min/max in the volume
    let dataMin = 255, dataMax = 0;
    for (let i = 0; i < uint8Data.length; i++) {
      if (uint8Data[i] > dataMax) dataMax = uint8Data[i];
      if (uint8Data[i] < dataMin) dataMin = uint8Data[i];
    }
    const range = dataMax - dataMin;
    console.log('[SliceExtractor] Data range: min=', dataMin, 'max=', dataMax, 'range=', range);

    if (range > 0 && range < 255) {
      // Normalize to fill 0-255 range for better visibility
      for (let i = 0; i < uint8Data.length; i++) {
        uint8Data[i] = Math.round(((uint8Data[i] - dataMin) / range) * 255);
      }
      console.log('[SliceExtractor] Data normalized to 0-255 range');
    }

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
      uint8Data
    );

    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
      console.error('[SliceExtractor] WebGL error after texImage3D:', error);
    } else {
      console.log('[SliceExtractor] Volume data uploaded successfully');
    }

    this.volumeTexture = texture;
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
    const { dimensions, data } = this.volume;
    const volumeData = new Uint8Array(data);

    let width: number, height: number, depth: number;
    let offset: number, strideX: number, strideY: number;

    switch (orientation) {
      case 'axial':
        width = dimensions[0];
        height = dimensions[1];
        depth = dimensions[2];
        offset = sliceIndex * width * height;
        strideX = 1;
        strideY = width;
        break;

      case 'coronal':
        width = dimensions[0];
        height = dimensions[2];
        depth = dimensions[1];
        offset = sliceIndex * width;
        strideX = 1;
        strideY = width * depth;
        break;

      case 'sagittal':
        width = dimensions[1];
        height = dimensions[2];
        depth = dimensions[0];
        offset = sliceIndex;
        strideX = depth;
        strideY = width * depth;
        break;
    }

    const sliceData = new Uint8Array(width * height);

    // Debug: check extracted slice data
    let nonZero = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIndex = offset + y * strideY + x * strideX;
        const val = volumeData[srcIndex];
        sliceData[y * width + x] = val;
        if (val > 0) nonZero++;
      }
    }
    console.log('[SliceExtractor] extractSlice', orientation, 'slice', sliceIndex, '- nonZero in slice:', nonZero, '/', width * height);

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
      case 'axial':
        return dimensions[2] - 1;
      case 'coronal':
        return dimensions[1] - 1;
      case 'sagittal':
        return dimensions[0] - 1;
    }
  }

  setWindowLevel(windowLevel: WindowLevel): void {
    this.windowLevel = windowLevel;
  }

  renderToCanvas(
    canvas: HTMLCanvasElement,
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

    console.log('[SliceExtractor] renderToCanvas:', orientation, 'slice', sliceIndex, 'canvas size', canvas.width, 'x', canvas.height, 'volume slice', width, 'x', height);

    // Keep canvas size matching container, use viewport to control render area
    gl.viewport(0, 0, canvas.width, canvas.height);

    const slice = this.extractSlice(orientation, sliceIndex);

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

    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
      console.error('[SliceExtractor] WebGL error after draw:', error);
    }
  }

  dispose(): void {
    const gl = this.gl;

    for (const texture of this.sliceTextures.values()) {
      gl.deleteTexture(texture);
    }
    this.sliceTextures.clear();

    if (this.volumeTexture) {
      gl.deleteTexture(this.volumeTexture);
    }

    if (this.positionBuffer) {
      gl.deleteBuffer(this.positionBuffer);
    }

    if (this.program) {
      gl.deleteProgram(this.program);
    }
  }
}
