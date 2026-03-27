// Type definitions for oblique MPR (斜切多平面重建)

import type { SliceOrientation as SliceOrientationType, CrosshairPosition } from '../types';
import type { NiftiVolume } from '@jsmedgl/parser-nifti';

// 重新导出 SliceOrientation 以便其他模块使用
export type SliceOrientation = SliceOrientationType;

/**
 * 3D 线段（两平面交线）
 */
export interface Line3D {
  start: [number, number, number]; // RAS 坐标
  end: [number, number, number];   // RAS 坐标
}

/**
 * 平面基向量（全部归一化且正交）
 *
 * - normal: 平面法向量，指向观察者
 * - uAxis: 平面内水平轴（对应输出图像 X 方向）
 * - vAxis: 平面内垂直轴（对应输出图像 Y 方向）
 *
 * 约束：normal = cross(uAxis, vAxis)，uAxis ⊥ vAxis
 */
export interface ObliqueBasis {
  normal: [number, number, number];  // RAS 空间，归一化
  uAxis: [number, number, number];   // RAS 空间，归一化，⊥ normal
  vAxis: [number, number, number];   // RAS 空间，归一化，⊥ normal, ⊥ uAxis
}

/**
 * 计算后的斜切平面参数
 */
export interface ObliquePlaneComputed {
  /** 共享焦点（RAS 空间） */
  center: [number, number, number];
  /** 平面基向量 */
  basis: ObliqueBasis;
  /** 输出图像宽度（像素） */
  width: number;
  /** 输出图像高度（像素） */
  height: number;
  /** 基准方向 */
  baseOrientation: SliceOrientation;
}

/**
 * 斜切 MPR 状态
 */
export interface ObliqueMPRState {
  /** 共享焦点（IJK 体素坐标） */
  focalPointIjk: CrosshairPosition;
  /** 共享焦点（RAS 物理坐标） */
  focalPointRas: [number, number, number];
  /** 三个视图的平面参数 */
  planes: {
    [key in SliceOrientation]: ObliquePlaneComputed;
  };
}

/**
 * ObliquePlane 构造函数选项
 */
export interface ObliquePlaneOptions {
  /** NIfTI 体积 */
  volume: NiftiVolume;
  /** 基准方向 */
  baseOrientation: SliceOrientation;
  /** 初始旋转四元数（可选，默认为单位四元数） */
  initialRotation?: [number, number, number, number]; // [x, y, z, w]
}

/**
 * 旋转增量（用于交互）
 */
export interface RotationDelta {
  /** 绕哪个轴旋转（RAS 空间） */
  axis: [number, number, number];
  /** 旋转角度（弧度） */
  angle: number;
}
