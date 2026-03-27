// Core Types for jsMedgl

// ============================================
// Import NIfTI types from parser-nifti (single source of truth)
// ============================================
import { NiftiDataType, NiftiXform } from '@jsmedgl/parser-nifti';
export { NiftiDataType, NiftiXform };

// ============================================
// Volume Types
// ============================================

// Using plain arrays instead of
export type Mat4 = number[];
export type Vec3 = number[];

export interface NiftiHeader {
  sizeof_hdr: number;
  dim: [number, number, number, number, number, number, number, number];
  datatype: NiftiDataType;
  pixdim: [number, number, number, number, number, number, number, number];
  qform_code: NiftiXform;
  sform_code: NiftiXform;
  quatern_b: number;
  quatern_c: number;
  quatern_d: number;
  qoffset_x: number;
  qoffset_y: number;
  qoffset_z: number;
  sform: Mat4;
}

export interface NiftiVolume {
  header: NiftiHeader;
  data: ArrayBuffer;
  dimensions: [number, number, number];
  spacing: [number, number, number];
  affine: Mat4;
  inverseAffine: Mat4;
  // Optional warnings (e.g., 4D data detected)
  warnings?: string[];
}

// ============================================
// Viewer Types
// ============================================

export type Axis = 'axial' | 'coronal' | 'sagittal';

export type LayoutType = 'single' | 'mpr' | '3x2';

export interface WindowLevel {
  window: number;
  level: number;
}

export interface SlicePosition {
  axial: number;
  coronal: number;
  sagittal: number;
}

export interface CameraState {
  position: Vec3;
  target: Vec3;
  zoom: number;
}

export interface ViewerState {
  slices: SlicePosition;
  windowLevel: WindowLevel;
  layout: LayoutType;
  camera: CameraState;
  isLoaded: boolean;
}

// ============================================
// Coordinate System Types
// ============================================

export type AxisCode = 'R' | 'L' | 'A' | 'P' | 'S' | 'I';

export interface OrientationReport {
  axcodes: [AxisCode, AxisCode, AxisCode];
  isOblique: boolean;
  spacing: [number, number, number];
  affine: Mat4;
}

// ============================================
// Event Types
// ============================================

export interface SliceChangeEvent {
  axis: Axis;
  index: number;
}

export interface WindowLevelChangeEvent {
  window: number;
  level: number;
}

export interface VolumeLoadEvent {
  volume: NiftiVolume;
  filename: string;
}

// ============================================
// Window/Level Presets
// ============================================

export interface WindowPreset {
  name: string;
  window: number;
  level: number;
}

export const DEFAULT_WINDOW_PRESETS: WindowPreset[] = [
  { name: 'Brain', window: 80, level: 40 },
  { name: 'Bone', window: 2000, level: 500 },
  { name: 'Lung', window: 1500, level: -600 },
  { name: 'Soft Tissue', window: 400, level: 40 },
  { name: 'Liver', window: 150, level: 30 },
];

// ============================================
// Color Map Types
// ============================================

export type ColormapName =
  | 'grayscale'
  | 'hot'
  | 'cool'
  | 'spring'
  | 'summer'
  | 'autumn'
  | 'winter'
  | 'jet'
  | 'viridis'
  | 'inferno'
  | 'plasma';

export interface Colormap {
  name: ColormapName;
  colors: [number, number, number][];
}

// ============================================
// Render Types
// ============================================

export interface RenderStats {
  fps: number;
  drawCalls: number;
  triangles: number;
  textureMemory: number;
}

export interface PerformanceConfig {
  targetFps: number;
  maxTextureSize: number;
  enableEarlyRayTermination: boolean;
  enableEmptySpaceSkipping: boolean;
}
