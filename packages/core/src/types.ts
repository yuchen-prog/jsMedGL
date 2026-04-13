// Core Types for jsMedgl
// Re-exports types from all sub-modules as a unified surface.

// Parser types (re-export for convenience)
export { NiftiDataType, NiftiXform } from '@jsmedgl/parser-nifti';
export type { NiftiHeader, NiftiVolume } from '@jsmedgl/parser-nifti';

// Coordinate types
export type { AxisCode, OrientationReport } from './coordinate';

// Window/Level types
export type { WindowLevel, WindowPreset } from './window-level';
export { DEFAULT_WINDOW_PRESETS } from './window-level';

// Colormap types
export type { ColormapName } from './colormaps';

// Store types
export type {
  ViewerState,
  ViewerActions,
  Axis,
  LayoutType,
  SlicePosition,
  CameraState,
} from './store/viewerStore';

// Event types
export type { EventEmitter, EventCallback } from './events';
