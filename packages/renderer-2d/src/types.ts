// Type definitions for 2D slice renderer

/**
 * Slice orientation
 */
export type SliceOrientation = 'axial' | 'coronal' | 'sagittal';

/**
 * Extracted slice data
 */
export interface ExtractedSlice {
  texture: WebGLTexture;
  width: number;
  height: number;
  orientation: SliceOrientation;
  index: number;
}

/**
 * Slice view options
 */
export interface SliceViewOptions {
  container: HTMLElement;
  orientation: SliceOrientation;
  width?: number;
  height?: number;
  enableCrosshair?: boolean;
  enableOrientationLabels?: boolean;
  backgroundColor?: string;
}

/**
 * Texture manager options
 */
export interface TextureManagerOptions {
  gl: WebGL2RenderingContext;
  cacheSize?: number;
}

/**
 * Texture format
 */
export type TextureFormat = 'luminance' | 'rgb' | 'rgba';

/**
 * Window/Level settings
 */
export interface WindowLevel {
  window: number;  // Window width (display range)
  level: number;   // Window level (center value)
}

/**
 * Crosshair position in volume coordinates
 */
export interface CrosshairPosition {
  i: number;  // I index
  j: number;  // J index
  k: number;  // K index
}

/**
 * MPR view state
 */
export interface MPRViewState {
  slices: {
    axial: number;
    coronal: number;
    sagittal: number;
  };
  windowLevel: WindowLevel;
  crosshair: CrosshairPosition | null;
}

/**
 * Orientation labels for a view
 */
export interface OrientationLabels {
  top: string;
  bottom: string;
  left: string;
  right: string;
}

/**
 * Slice view interface
 */
export interface SliceView {
  render(): void;
  setSliceIndex(index: number): void;
  getSliceIndex(): number;
  setWindowLevel(window: number, level: number): void;
  updateCrosshair(position: CrosshairPosition): void;
  on(event: string, callback: (data: any) => void): void;
  off(event: string, callback: (data: any) => void): void;
  dispose(): void;
}

/**
 * Texture manager interface
 */
export interface TextureManager {
  uploadVolume(
    data: ArrayBuffer,
    dimensions: [number, number, number],
    dataType?: string
  ): WebGLTexture;
  createTexture(
    width: number,
    height: number,
    data?: ArrayBufferView | null,
    format?: TextureFormat
  ): WebGLTexture;
  deleteTexture(texture: WebGLTexture): void;
  clearCache(): void;
}

/**
 * Slice extractor interface
 */
export interface SliceExtractor {
  extractAxial(sliceIndex: number): ExtractedSlice;
  extractCoronal(sliceIndex: number): ExtractedSlice;
  extractSagittal(sliceIndex: number): ExtractedSlice;
  extractSlice(orientation: SliceOrientation, sliceIndex: number): ExtractedSlice;
  setWindowLevel(windowLevel: WindowLevel): void;
  renderToCanvas(
    canvas: HTMLCanvasElement,
    orientation: SliceOrientation,
    sliceIndex: number
  ): void;
  dispose(): void;
}
