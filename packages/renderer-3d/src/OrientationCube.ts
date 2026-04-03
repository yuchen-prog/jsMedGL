// OrientationCube - 3D orientation indicator with L/R/A/P/S/I labels
// Renders a wireframe cube that rotates with the main camera

import type { AxisLabel, OrientationCubeConfig } from './types';
import { DEFAULT_ORIENTATION_CUBE_CONFIG } from './types';

const CUBE_VERTICES = new Float32Array([
  // Front face (z=1)
  -1, -1, 1,   1, -1, 1,   1, 1, 1,   -1, 1, 1,
  // Back face (z=-1)
  -1, -1, -1,  1, -1, -1,  1, 1, -1,  -1, 1, -1,
]);

const CUBE_EDGES = new Uint8Array([
  // Front face
  0, 1,  1, 2,  2, 3,  3, 0,
  // Back face
  4, 5,  5, 6,  6, 7,  7, 4,
  // Connecting edges
  0, 4,  1, 5,  2, 6,  3, 7,
]);

// Face centers in normalized device coordinates (for label positioning)
const FACE_CENTERS: Record<AxisLabel, [number, number, number]> = {
  L: [-1.15, 0, 0],      // Left face center (x negative, slightly outside)
  R: [1.15, 0, 0],       // Right face center (x positive)
  A: [0, 0, 1.15],       // Anterior (front, z positive in RAS)
  P: [0, 0, -1.15],      // Posterior (back, z negative)
  S: [0, 1.15, 0],       // Superior (top, y positive)
  I: [0, -1.15, 0],      // Inferior (bottom, y negative)
};

// Axis vectors for visibility testing (currently unused but kept for future use)
// const FACE_NORMALS: Record<AxisLabel, [number, number, number]> = {
//   L: [-1, 0, 0],
//   R: [1, 0, 0],
//   A: [0, 0, 1],
//   P: [0, 0, -1],
//   S: [0, 1, 0],
//   I: [0, -1, 0],
// };

/**
 * OrientationCube renders a small wireframe cube with L/R/A/P/S/I labels
 * that rotates to indicate the current viewing orientation.
 */
export class OrientationCube {
  private gl: WebGL2RenderingContext;
  private config: OrientationCubeConfig;
  private canvas: HTMLCanvasElement;

  // WebGL resources
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private positionBuffer: WebGLBuffer | null = null;
  private indexBuffer: WebGLBuffer | null = null;

  // Uniform locations
  private locMvpMatrix: WebGLUniformLocation | null = null;
  private locColor: WebGLUniformLocation | null = null;

  // Cached matrices
  private projectionMatrix = new Float32Array(16);
  private viewMatrix = new Float32Array(16);

  constructor(
    gl: WebGL2RenderingContext,
    canvas: HTMLCanvasElement,
    config: Partial<OrientationCubeConfig> = {}
  ) {
    this.gl = gl;
    this.canvas = canvas;
    this.config = { ...DEFAULT_ORIENTATION_CUBE_CONFIG, ...config };

    this.initShaders();
    this.initGeometry();
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<OrientationCubeConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): OrientationCubeConfig {
    return { ...this.config };
  }

  /**
   * Render the orientation cube with the given rotation matrix.
   * The rotation matrix should be extracted from the main camera's view matrix.
   */
  render(rotationMatrix: Float32Array | number[]): void {
    const gl = this.gl;
    const { size, position } = this.config;

    if (!this.program || !this.vao) return;

    // Save current viewport
    const prevViewport = gl.getParameter(gl.VIEWPORT);

    // Calculate viewport position
    const canvasWidth = this.canvas.width || this.canvas.clientWidth || 512;
    const canvasHeight = this.canvas.height || this.canvas.clientHeight || 512;
    const dpr = window.devicePixelRatio || 1;

    // Calculate cube viewport (square, in pixels)
    const cubeSize = Math.round(size * dpr);
    let x = 0, y = 0;

    switch (position) {
      case 'bottom-right':
        x = canvasWidth * dpr - cubeSize - Math.round(10 * dpr);
        y = Math.round(10 * dpr);
        break;
      case 'bottom-left':
        x = Math.round(10 * dpr);
        y = Math.round(10 * dpr);
        break;
      case 'top-right':
        x = canvasWidth * dpr - cubeSize - Math.round(10 * dpr);
        y = canvasHeight * dpr - cubeSize - Math.round(10 * dpr);
        break;
      case 'top-left':
        x = Math.round(10 * dpr);
        y = canvasHeight * dpr - cubeSize - Math.round(10 * dpr);
        break;
    }

    // Set viewport for cube
    gl.viewport(x, y, cubeSize, cubeSize);

    // Enable depth test and scissor for clean rendering
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, y, cubeSize, cubeSize);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    // Setup orthographic projection for cube (view from +z towards origin)
    this.setupOrthographicProjection();

    // Build MVP: projection * view * rotation
    // View: look from +z towards origin
    const eye = [0, 0, 3];
    const center = [0, 0, 0];
    const up = [0, 1, 0];
    this.lookAt(this.viewMatrix, eye, center, up);

    // Apply the camera rotation
    const rotView = this.multiplyMatrices(this.viewMatrix, rotationMatrix);
    const mvp = this.multiplyMatrices(this.projectionMatrix, rotView);

    // Use cube shader
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    // Set uniforms
    gl.uniformMatrix4fv(this.locMvpMatrix, false, mvp);
    gl.uniform3f(this.locColor, 0.8, 0.8, 0.8); // Light gray

    // Draw wireframe edges
    gl.drawElements(gl.LINES, CUBE_EDGES.length, gl.UNSIGNED_BYTE, 0);

    // Disable scissor
    gl.disable(gl.SCISSOR_TEST);

    // Restore viewport
    gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
  }

  /**
   * Draw axis labels using Canvas 2D overlay.
   * Call this after WebGL render, passing the 2D context of an overlay canvas.
   */
  drawLabels(
    ctx: CanvasRenderingContext2D,
    rotationMatrix: Float32Array | number[]
  ): void {
    const { size, position } = this.config;
    const dpr = window.devicePixelRatio || 1;

    // Calculate cube center position in screen coordinates
    const canvasWidth = ctx.canvas.width || ctx.canvas.clientWidth || 512;
    const canvasHeight = ctx.canvas.height || ctx.canvas.clientHeight || 512;
    const cubeSize = size;

    let centerX = 0, centerY = 0;
    const margin = 10;

    switch (position) {
      case 'bottom-right':
        centerX = canvasWidth / dpr - cubeSize / 2 - margin;
        centerY = canvasHeight / dpr - cubeSize / 2 - margin;
        break;
      case 'bottom-left':
        centerX = cubeSize / 2 + margin;
        centerY = canvasHeight / dpr - cubeSize / 2 - margin;
        break;
      case 'top-right':
        centerX = canvasWidth / dpr - cubeSize / 2 - margin;
        centerY = cubeSize / 2 + margin;
        break;
      case 'top-left':
        centerX = cubeSize / 2 + margin;
        centerY = cubeSize / 2 + margin;
        break;
    }

    // Transform each face center by the rotation matrix
    const labels: AxisLabel[] = ['L', 'R', 'A', 'P', 'S', 'I'];

    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const label of labels) {
      const faceCenter = FACE_CENTERS[label];
      const transformed = this.transformPoint(faceCenter, rotationMatrix);

      // Project to screen (orthographic, z=3 view plane)
      // transformed is in view space, project to screen space
      const screenX = centerX + transformed[0] * cubeSize * 0.35;
      const screenY = centerY - transformed[1] * cubeSize * 0.35; // Flip Y

      // Only draw if face is pointing somewhat towards camera (z > 0 in view space)
      // Actually for a wireframe cube, we draw all labels
      // But we can fade based on depth
      const depth = transformed[2];
      const alpha = Math.max(0.3, (depth + 1) / 2);

      ctx.fillStyle = `rgba(200, 200, 200, ${alpha})`;
      ctx.fillText(label, screenX, screenY);

      // Draw outline for visibility
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.lineWidth = 2;
      ctx.strokeText(label, screenX, screenY);
    }
  }

  /**
   * Release all WebGL resources
   */
  dispose(): void {
    const gl = this.gl;

    if (this.program) {
      gl.deleteProgram(this.program);
      this.program = null;
    }
    if (this.vao) {
      gl.deleteVertexArray(this.vao);
      this.vao = null;
    }
    if (this.positionBuffer) {
      gl.deleteBuffer(this.positionBuffer);
      this.positionBuffer = null;
    }
    if (this.indexBuffer) {
      gl.deleteBuffer(this.indexBuffer);
      this.indexBuffer = null;
    }
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  private initShaders(): void {
    const gl = this.gl;

    const vsSource = `#version 300 es
      layout(location = 0) in vec3 aPosition;
      uniform mat4 uMvpMatrix;
      void main() {
        gl_Position = uMvpMatrix * vec4(aPosition, 1.0);
      }
    `;

    const fsSource = `#version 300 es
      precision mediump float;
      uniform vec3 uColor;
      out vec4 fragColor;
      void main() {
        fragColor = vec4(uColor, 1.0);
      }
    `;

    // Compile shaders
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, vsSource);
    gl.compileShader(vs);

    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fsSource);
    gl.compileShader(fs);

    // Link program
    this.program = gl.createProgram()!;
    gl.attachShader(this.program, vs);
    gl.attachShader(this.program, fs);
    gl.linkProgram(this.program);

    // Clean up shaders
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    // Get uniform locations
    this.locMvpMatrix = gl.getUniformLocation(this.program, 'uMvpMatrix');
    this.locColor = gl.getUniformLocation(this.program, 'uColor');
  }

  private initGeometry(): void {
    const gl = this.gl;

    // Create VAO
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    // Position buffer
    this.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, CUBE_VERTICES, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    // Index buffer
    this.indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, CUBE_EDGES, gl.STATIC_DRAW);

    // Unbind
    gl.bindVertexArray(null);
  }

  private setupOrthographicProjection(): void {
    const size = 1.5;
    // Orthographic projection matrix
    // [2/(r-l), 0, 0, -(r+l)/(r-l)]
    // [0, 2/(t-b), 0, -(t+b)/(t-b)]
    // [0, 0, -2/(f-n), -(f+n)/(f-n)]
    // [0, 0, 0, 1]
    const m = this.projectionMatrix;
    m[0] = 1 / size;   m[4] = 0;         m[8] = 0;          m[12] = 0;
    m[1] = 0;          m[5] = 1 / size;  m[9] = 0;          m[13] = 0;
    m[2] = 0;          m[6] = 0;         m[10] = -1 / 10;   m[14] = 0;
    m[3] = 0;          m[7] = 0;         m[11] = 0;         m[15] = 1;
  }

  private lookAt(
    out: Float32Array,
    eye: number[],
    center: number[],
    up: number[]
  ): void {
    // Compute view matrix (eye -> center)
    let x0 = eye[0] - center[0];
    let x1 = eye[1] - center[1];
    let x2 = eye[2] - center[2];

    // Normalize forward
    let len = Math.sqrt(x0 * x0 + x1 * x1 + x2 * x2);
    if (len === 0) { x2 = 1; len = 1; }
    x0 /= len; x1 /= len; x2 /= len;

    // Cross product up x forward = right
    let y0 = up[1] * x2 - up[2] * x1;
    let y1 = up[2] * x0 - up[0] * x2;
    let y2 = up[0] * x1 - up[1] * x0;

    // Normalize right
    len = Math.sqrt(y0 * y0 + y1 * y1 + y2 * y2);
    if (len === 0) { y0 = 1; len = 1; }
    y0 /= len; y1 /= len; y2 /= len;

    // Cross product forward x right = true up
    const z0 = x1 * y2 - x2 * y1;
    const z1 = x2 * y0 - x0 * y2;
    const z2 = x0 * y1 - x1 * y0;

    // Build matrix (column-major)
    out[0] = y0;   out[4] = z0;   out[8] = x0;   out[12] = -(y0 * eye[0] + z0 * eye[1] + x0 * eye[2]);
    out[1] = y1;   out[5] = z1;   out[9] = x1;   out[13] = -(y1 * eye[0] + z1 * eye[1] + x1 * eye[2]);
    out[2] = y2;   out[6] = z2;   out[10] = x2;  out[14] = -(y2 * eye[0] + z2 * eye[1] + x2 * eye[2]);
    out[3] = 0;    out[7] = 0;    out[11] = 0;   out[15] = 1;
  }

  private multiplyMatrices(a: Float32Array | number[], b: Float32Array | number[]): Float32Array {
    const out = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          sum += a[i + k * 4] * b[k + j * 4];
        }
        out[i + j * 4] = sum;
      }
    }
    return out;
  }

  private transformPoint(
    point: [number, number, number],
    matrix: Float32Array | number[]
  ): [number, number, number] {
    const x = point[0], y = point[1], z = point[2];
    // Assume matrix is column-major 4x4, we only use rotation part
    const rx = matrix[0] * x + matrix[4] * y + matrix[8] * z;
    const ry = matrix[1] * x + matrix[5] * y + matrix[9] * z;
    const rz = matrix[2] * x + matrix[6] * y + matrix[10] * z;
    return [rx, ry, rz];
  }
}
