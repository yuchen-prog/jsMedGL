// Core Types for jsMedgl
// Re-exports types from all sub-modules as a unified surface.

// Parser types (re-export for convenience)
export { NiftiDataType, NiftiXform } from '@jsmedgl/parser-nifti';
export type { NiftiHeader, NiftiVolume } from '@jsmedgl/parser-nifti';

/**
 * 统一体数据接口 — 所有 parser 的输出都实现此接口，renderer 依赖此接口
 * 而非具体 NiftiVolume 或 DicomVolume 类型。
 */
export interface Volume {
  /** 原始体素字节数据 */
  data: ArrayBuffer;
  /** 体素维度 [columns, rows, slices] */
  dimensions: [number, number, number];
  /** 体素间距 [x_spacing, y_spacing, z_spacing] (mm) */
  spacing: [number, number, number];
  /** 4x4 仿射变换矩阵 IJK → RAS */
  affine: number[];
  /** 4x4 仿射变换矩阵的逆矩阵 RAS → IJK */
  inverseAffine: number[];
  /**
   * 数据类型码，映射到 NIfTI NiftiDataType 枚举值。
   * NIfTI parser: 使用 header.datatype 的原始值
   * DICOM parser: 将 bitsAllocated + pixelRepresentation 映射到等价 NIfTI code
   * 用途: getDataTypeSize(), readVoxel() 等体素读写函数
   */
  datatype: number;
}

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
