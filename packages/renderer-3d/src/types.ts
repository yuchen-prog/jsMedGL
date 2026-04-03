// Type definitions for 3D volume renderer

import type { NiftiVolume } from '@jsmedgl/parser-nifti';

// ============================================
// Rendering Modes
// ============================================

/**
 * Volume rendering compositing mode
 */
export type CompositingMode =
  | 'standard'   // front-to-back alpha compositing (default)
  | 'mip'        // Maximum Intensity Projection
  | 'minip'      // Minimum Intensity Projection
  | 'average';   // Average Intensity Projection

// ============================================
// Transfer Function / Colormap
// ============================================

/**
 * Colormap names for volume rendering
 */
export type ColormapName =
  | 'grayscale'
  | 'hot'
  | 'bone'
  | 'iron'
  | 'viridis'
  | 'airways'
  | 'angiography'
  | 'pet'
  | 'soft_tissue'
  | 'lung';

/**
 * Transfer function configuration
 */
export interface TransferFunctionConfig {
  window: number;
  level: number;
  colormap: ColormapName;
  gradientLighting: boolean;
}

// ============================================
// Camera
// ============================================

/**
 * Volume camera state (spherical orbit model)
 */
export interface VolumeCameraState {
  /** Horizontal angle in radians */
  theta: number;
  /** Vertical angle in radians */
  phi: number;
  /** Distance from target */
  distance: number;
  /** Look-at target in texture space [0,1]³ */
  target: [number, number, number];
}

// ============================================
// Raycasting Configuration
// ============================================

/**
 * Raycasting rendering configuration
 */
export interface RaycastingConfig {
  /** Compositing mode */
  compositingMode: CompositingMode;
  /** Step size in texture space (default: 0.003) */
  stepSize: number;
  /** Maximum ray steps (default: 512) */
  maxSteps: number;
  /** Transfer function settings */
  transferFunction: TransferFunctionConfig;
  /** Light direction (normalized, default: [1, 1, 1]) */
  lightDirection: [number, number, number];
}

/**
 * Default raycasting configuration
 */
export const DEFAULT_RAYCASTING_CONFIG: RaycastingConfig = {
  compositingMode: 'standard',
  stepSize: 0.003,
  maxSteps: 512,
  transferFunction: {
    window: 1.0,
    level: 0.5,
    colormap: 'grayscale',
    gradientLighting: true,
  },
  lightDirection: [0.577, 0.577, 0.577], // normalize([1,1,1])
};

/**
 * Default camera state — 45° oblique view
 */
export const DEFAULT_CAMERA_STATE: VolumeCameraState = {
  theta: Math.PI / 4,
  phi: Math.PI / 4,
  distance: 2.5,
  target: [0.5, 0.5, 0.5],
};

// ============================================
// Renderer Interface
// ============================================

/**
 * Core volume renderer (no DOM interaction)
 */
export interface VolumeRenderer {
  /** Upload volume data as 3D texture */
  setVolume(volume: NiftiVolume): void;
  /** Update rendering config (partial) */
  setConfig(config: Partial<RaycastingConfig>): void;
  /** Update camera state (partial) */
  setCamera(state: Partial<VolumeCameraState>): void;
  /** Get current camera state */
  getCamera(): VolumeCameraState;
  /** Execute one render frame */
  render(): void;
  /** Release all WebGL resources */
  dispose(): void;
}

/**
 * Volume render view (manages canvas + interaction)
 */
export interface VolumeRenderView {
  /** Upload volume data */
  setVolume(volume: NiftiVolume): void;
  /** Set compositing mode */
  setCompositingMode(mode: CompositingMode): void;
  /** Set colormap */
  setColormap(colormap: ColormapName): void;
  /** Set window/level */
  setWindowLevel(window: number, level: number): void;
  /** Enable/disable gradient lighting */
  setGradientLighting(enabled: boolean): void;
  /** Set camera state (partial) */
  setCamera(state: Partial<VolumeCameraState>): void;
  /** Get current camera state */
  getCamera(): VolumeCameraState;
  /** Subscribe to events */
  on(event: 'render' | 'cameraChange', cb: (data: unknown) => void): void;
  /** Unsubscribe from events */
  off(event: 'render' | 'cameraChange', cb: (data: unknown) => void): void;
  /** Trigger a render frame manually */
  render(): void;
  /** Release all resources and remove canvas */
  dispose(): void;
}

// ============================================
// Orientation Cube
// ============================================

/**
 * Orientation cube axis label
 */
export type AxisLabel = 'L' | 'R' | 'A' | 'P' | 'S' | 'I';

/**
 * Orientation cube configuration
 */
export interface OrientationCubeConfig {
  /** Size in pixels (default: 100) */
  size: number;
  /** Position within viewport (default: 'bottom-right') */
  position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
}

/**
 * Default orientation cube config
 */
export const DEFAULT_ORIENTATION_CUBE_CONFIG: OrientationCubeConfig = {
  size: 100,
  position: 'bottom-right',
};

// ============================================
// Render Stats
// ============================================

/**
 * Performance statistics from the last render frame
 */
export interface VolumeRenderStats {
  /** Frame time in milliseconds */
  frameTimeMs: number;
  /** Frames per second */
  fps: number;
  /** Number of draw calls */
  drawCalls: number;
  /** Volume texture memory in bytes */
  textureMemoryBytes: number;
}
