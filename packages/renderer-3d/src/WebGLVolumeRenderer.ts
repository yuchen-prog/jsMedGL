// WebGLVolumeRenderer - Main rendering class integrating all components

import type { NiftiVolume } from '@jsmedgl/parser-nifti';
import type { CompositingMode, RaycastingConfig, VolumeCameraState } from './types';
import { DEFAULT_RAYCASTING_CONFIG, DEFAULT_CAMERA_STATE } from './types';
import { VolumeTextureManager } from './VolumeTextureManager';
import { VolumeCamera } from './VolumeCamera';
import { TransferFunction } from './TransferFunction';

/** Compositing mode enum for shader uniform */
const COMPOSITING_MODE_MAP: Record<CompositingMode, number> = {
  standard: 0,
  mip: 1,
  minip: 2,
  average: 3,
};

// Shader sources (inline to avoid import complexity)
const VERT_SRC = `
attribute vec2 a_position;
uniform mat4 u_inverseViewMatrix;
uniform vec3 u_cameraPosition;
uniform float u_aspect;
varying vec3 v_rayOrigin;
varying vec3 v_rayDir;

void main() {
  vec2 ndc = a_position;
  float fovScale = 1.0;
  vec3 right = vec3(u_inverseViewMatrix[0][0], u_inverseViewMatrix[1][0], u_inverseViewMatrix[2][0]);
  vec3 up = vec3(u_inverseViewMatrix[0][1], u_inverseViewMatrix[1][1], u_inverseViewMatrix[2][1]);
  vec3 forward = vec3(-u_inverseViewMatrix[0][2], -u_inverseViewMatrix[1][2], -u_inverseViewMatrix[2][2]);
  vec3 dir = normalize(forward + right * ndc.x * u_aspect * fovScale + up * ndc.y * fovScale);
  v_rayOrigin = u_cameraPosition;
  v_rayDir = dir;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAG_SRC = `
precision highp float;

uniform sampler3D u_volumeTexture;
uniform sampler2D u_colorLUT;
uniform sampler2D u_opacityLUT;
varying vec3 v_rayOrigin;
varying vec3 v_rayDir;
uniform float u_window;
uniform float u_level;
uniform int u_compositingMode;
uniform float u_stepSize;
uniform bool u_gradientLighting;
uniform vec3 u_lightDir;

const vec3 BOX_MIN = vec3(0.0);
const vec3 BOX_MAX = vec3(1.0);

vec2 intersectBox(vec3 ro, vec3 rd) {
  vec3 invDir = 1.0 / rd;
  vec3 t0 = (BOX_MIN - ro) * invDir;
  vec3 t1 = (BOX_MAX - ro) * invDir;
  vec3 tNear = min(t0, t1);
  vec3 tFar = max(t0, t1);
  float tN = max(max(tNear.x, tNear.y), tNear.z);
  float tF = min(min(tFar.x, tFar.y), tFar.z);
  return vec2(tN, tF);
}

vec3 computeGradient(vec3 pos) {
  float s = 0.002;
  float l = texture(u_volumeTexture, pos - vec3(s, 0.0, 0.0)).r;
  float r = texture(u_volumeTexture, pos + vec3(s, 0.0, 0.0)).r;
  float d = texture(u_volumeTexture, pos - vec3(0.0, s, 0.0)).r;
  float u = texture(u_volumeTexture, pos + vec3(0.0, s, 0.0)).r;
  float b = texture(u_volumeTexture, pos - vec3(0.0, 0.0, s)).r;
  float f = texture(u_volumeTexture, pos + vec3(0.0, 0.0, s)).r;
  return vec3(r - l, u - d, f - b);
}

vec3 applyLighting(vec3 color, vec3 gradient) {
  vec3 normal = -normalize(gradient);
  float diff = max(dot(normal, normalize(u_lightDir)), 0.0);
  return color * (0.3 + 0.7 * diff);
}

void main() {
  vec3 rayDir = normalize(v_rayDir);
  vec3 rayOrigin = v_rayOrigin;

  vec2 hit = intersectBox(rayOrigin, rayDir);
  float tNear = hit.x;
  float tFar = hit.y;

  if (tNear > tFar || tFar < 0.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }

  tNear = max(tNear, 0.0);

  vec3 entryPoint = rayOrigin + rayDir * tNear;
  vec3 exitPoint = rayOrigin + rayDir * tFar;
  float rayLength = distance(entryPoint, exitPoint);

  float numSteps = min(rayLength / u_stepSize, 512.0);
  if (numSteps < 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }

  vec3 step = rayDir * u_stepSize;
  vec3 currentPos = entryPoint;

  vec4 accumulated = vec4(0.0);
  float maxIntensity = 0.0;
  float minIntensity = 1.0;
  float sumIntensity = 0.0;
  int actualSteps = 0;
  bool enableLighting = u_gradientLighting && u_compositingMode == 0;

  for (int i = 0; i < 512; i++) {
    if (float(i) >= numSteps) break;

    float intensity = texture(u_volumeTexture, currentPos).r;
    float windowed = (intensity - u_level) / u_window + 0.5;
    windowed = clamp(windowed, 0.0, 1.0);

    if (intensity > maxIntensity) maxIntensity = intensity;
    if (intensity < minIntensity) minIntensity = intensity;
    sumIntensity += intensity;
    actualSteps++;

    if (u_compositingMode == 0) {
      vec3 color = texture(u_colorLUT, vec2(windowed, 0.5)).rgb;
      float opacity = texture(u_opacityLUT, vec2(windowed, 0.5)).r;

      if (enableLighting && opacity > 0.01) {
        vec3 gradient = computeGradient(currentPos);
        if (length(gradient) > 0.001) {
          color = applyLighting(color, gradient);
        }
      }

      accumulated.rgb += color * opacity * (1.0 - accumulated.a);
      accumulated.a += opacity * (1.0 - accumulated.a);

      if (accumulated.a > 0.99) break;
    }

    currentPos += step;
  }

  if (u_compositingMode == 1) {
    float w = clamp((maxIntensity - u_level) / u_window + 0.5, 0.0, 1.0);
    gl_FragColor = vec4(texture(u_colorLUT, vec2(w, 0.5)).rgb, 1.0);
  } else if (u_compositingMode == 2) {
    float w = clamp((minIntensity - u_level) / u_window + 0.5, 0.0, 1.0);
    gl_FragColor = vec4(texture(u_colorLUT, vec2(w, 0.5)).rgb, 1.0);
  } else if (u_compositingMode == 3) {
    float avg = sumIntensity / max(float(actualSteps), 1.0);
    float w = clamp((avg - u_level) / u_window + 0.5, 0.0, 1.0);
    gl_FragColor = vec4(texture(u_colorLUT, vec2(w, 0.5)).rgb, 1.0);
  } else {
    gl_FragColor = accumulated;
  }
}
`;

/**
 * Core volume renderer. Manages WebGL state, shaders, and coordinates
 * all rendering sub-components.
 */
export class WebGLVolumeRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private quadBuffer: WebGLBuffer | null = null;
  private textureManager: VolumeTextureManager;
  private camera: VolumeCamera;
  private transferFunction: TransferFunction;

  private config: RaycastingConfig;
  private hasVolume = false;

  // Uniform locations
  private uniforms: Record<string, WebGLUniformLocation | null> = {};

  constructor(gl: WebGL2RenderingContext, config?: Partial<RaycastingConfig>) {
    this.gl = gl;
    this.config = { ...DEFAULT_RAYCASTING_CONFIG, ...config };

    this.textureManager = new VolumeTextureManager(gl);
    this.camera = new VolumeCamera();
    this.transferFunction = new TransferFunction(gl);

    this.initShader();
    this.initQuad();
  }

  setVolume(volume: NiftiVolume): void {
    this.textureManager.upload(volume);
    this.hasVolume = true;
  }

  setConfig(config: Partial<RaycastingConfig>): void {
    if (config.compositingMode !== undefined) {
      this.config.compositingMode = config.compositingMode;
    }
    if (config.stepSize !== undefined) {
      this.config.stepSize = config.stepSize;
    }
    if (config.transferFunction) {
      const tf = config.transferFunction;
      if (tf.colormap !== undefined) {
        this.transferFunction.setColormap(tf.colormap);
        this.config.transferFunction.colormap = tf.colormap;
      }
      if (tf.window !== undefined || tf.level !== undefined) {
        const w = tf.window ?? this.config.transferFunction.window;
        const l = tf.level ?? this.config.transferFunction.level;
        this.transferFunction.setWindowLevel(w, l);
        this.config.transferFunction.window = w;
        this.config.transferFunction.level = l;
      }
      if (tf.gradientLighting !== undefined) {
        this.config.transferFunction.gradientLighting = tf.gradientLighting;
      }
    }
    if (config.lightDirection !== undefined) {
      this.config.lightDirection = config.lightDirection;
    }
  }

  setCamera(state: Partial<VolumeCameraState>): void {
    this.camera.orbit(0, 0); // Force dirty flag — actual values set below
    if (state.theta !== undefined || state.phi !== undefined) {
      // Reset then set
      const current = this.camera.getState();
      this.camera.reset();
      this.camera.orbit(
        state.theta ?? current.theta - DEFAULT_CAMERA_STATE.theta,
        state.phi ?? current.phi - DEFAULT_CAMERA_STATE.phi
      );
    }
    if (state.distance !== undefined) {
      this.camera.zoom(state.distance - this.camera.getState().distance);
    }
    if (state.target !== undefined) {
      // Pan to new target (simplified)
      const cam = this.camera as unknown as { target: [number, number, number] };
      cam.target = [...state.target] as [number, number, number];
    }
  }

  getCamera(): VolumeCameraState {
    return this.camera.getState();
  }

  getCameraObject(): VolumeCamera {
    return this.camera;
  }

  getTransferFunction(): TransferFunction {
    return this.transferFunction;
  }

  render(): void {
    if (!this.hasVolume || !this.program) return;

    const gl = this.gl;

    gl.useProgram(this.program);

    // Bind volume texture (unit 0)
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, this.textureManager.getTexture());
    gl.uniform1i(this.uniforms.u_volumeTexture, 0);

    // Bind color LUT (unit 1)
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.transferFunction.getColorTexture());
    gl.uniform1i(this.uniforms.u_colorLUT, 1);

    // Bind opacity LUT (unit 2)
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.transferFunction.getOpacityTexture());
    gl.uniform1i(this.uniforms.u_opacityLUT, 2);

    // Camera uniforms
    const invView = this.camera.getInverseViewMatrix();
    gl.uniformMatrix4fv(this.uniforms.u_inverseViewMatrix, false, invView);

    const camPos = this.camera.getPosition();
    gl.uniform3f(this.uniforms.u_cameraPosition, camPos[0], camPos[1], camPos[2]);

    // Aspect ratio from viewport (0x0BA2 = VIEWPORT)
    const viewport = gl.getParameter(0x0BA2) as Int32Array;
    const aspect = viewport[2] / viewport[3];
    gl.uniform1f(this.uniforms.u_aspect, aspect);

    // Rendering config uniforms
    gl.uniform1f(this.uniforms.u_window, this.config.transferFunction.window);
    gl.uniform1f(this.uniforms.u_level, this.config.transferFunction.level);
    gl.uniform1i(this.uniforms.u_compositingMode, COMPOSITING_MODE_MAP[this.config.compositingMode]);
    gl.uniform1f(this.uniforms.u_stepSize, this.config.stepSize);
    gl.uniform1i(this.uniforms.u_gradientLighting, this.config.transferFunction.gradientLighting ? 1 : 0);
    gl.uniform3f(
      this.uniforms.u_lightDir,
      this.config.lightDirection[0],
      this.config.lightDirection[1],
      this.config.lightDirection[2]
    );

    // Draw full-screen quad
    const posLoc = gl.getAttribLocation(this.program, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose(): void {
    const gl = this.gl;

    this.textureManager.dispose();
    this.transferFunction.dispose();

    if (this.program) {
      gl.deleteProgram(this.program);
      this.program = null;
    }
    if (this.quadBuffer) {
      gl.deleteBuffer(this.quadBuffer);
      this.quadBuffer = null;
    }
  }

  private initShader(): void {
    const gl = this.gl;

    const vert = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vert, VERT_SRC);
    gl.compileShader(vert);
    if (!gl.getShaderParameter(vert, gl.COMPILE_STATUS)) {
      const err = gl.getShaderInfoLog(vert);
      gl.deleteShader(vert);
      throw new Error(`Vertex shader error: ${err}`);
    }

    const frag = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(frag, FRAG_SRC);
    gl.compileShader(frag);
    if (!gl.getShaderParameter(frag, gl.COMPILE_STATUS)) {
      const err = gl.getShaderInfoLog(frag);
      gl.deleteShader(vert);
      gl.deleteShader(frag);
      throw new Error(`Fragment shader error: ${err}`);
    }

    this.program = gl.createProgram()!;
    gl.attachShader(this.program, vert);
    gl.attachShader(this.program, frag);
    gl.linkProgram(this.program);

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      const err = gl.getProgramInfoLog(this.program);
      gl.deleteShader(vert);
      gl.deleteShader(frag);
      gl.deleteProgram(this.program);
      this.program = null;
      throw new Error(`Shader link error: ${err}`);
    }

    gl.deleteShader(vert);
    gl.deleteShader(frag);

    // Cache uniform locations
    const names = [
      'u_volumeTexture', 'u_colorLUT', 'u_opacityLUT',
      'u_inverseViewMatrix', 'u_cameraPosition', 'u_aspect',
      'u_window', 'u_level', 'u_compositingMode', 'u_stepSize',
      'u_gradientLighting', 'u_lightDir',
    ];
    for (const name of names) {
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
    }
  }

  private initQuad(): void {
    const gl = this.gl;
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1,  -1, 1,  1, 1
    ]), gl.STATIC_DRAW);
  }
}
