# Oblique MPR (斜切多平面重建) 开发计划

## 1. 功能概述

### 1.1 目标

实现支持任意角度斜切的 MPR 功能：三个视图（Axial、Coronal、Sagittal）各自支持独立斜切，十字线始终正交且为三个斜切平面的物理交线。

### 1.2 核心需求

- **独立斜切**：三个视图各自独立改变切平面朝向（法向量），互不影响
- **十字线始终正交**：每个视图内的十字线水平线与垂直线始终正交
- **十字线交点 = 三平面交点**：十字线交点始终是三个斜切平面的公共交点（即共享焦点 focal point）
- **三线性插值**：斜切采样时使用三线性插值保证图像质量
- **实时交互**：拖拽过程中实时更新所有视图

### 1.3 与正交 MPR 的关系

正交 MPR 是斜切 MPR 的特例：当三个平面的法向量分别平行于 K/J/I 轴时，即退化为标准正交视图。

---

## 2. 数学基础

### 2.1 坐标系层次

斜切 MPR 涉及三个坐标空间：

| 空间 | 描述 | 用途 |
|------|------|------|
| **IJK** | 体素网格索引 `(0..dim[0]-1, 0..dim[1]-1, 0..dim[2]-1)` | 体积数据存储和采样 |
| **RAS** | NIfTI 物理空间（Right/Anterior/Superior 为正方向） | NIfTI 文件原生坐标 |
| **LPS** | DICOM 物理空间（Left/Posterior/Superior 为正方向） | 与 DICOM/医学影像工具互操作 |

关键转换：
- **IJK → RAS**：通过 NIfTI 的 sform/qform affine 矩阵（`ijkToRas()`）
- **RAS → LPS**：坐标翻转 X 和 Y 轴（`rasToLps()`）

**重要**：斜切平面的**法向量和切平面轴必须在 World 坐标（RAS/LPS）下定义**，因为它们描述的是物理空间中的方向，与体素网格无关。只有在采样时才转换到 IJK 空间进行三线性插值。

### 2.2 切平面定义

一个斜切平面由以下参数定义（均为 RAS 空间）：

- **中心点 C**：`[cx, cy, cz]` —— 平面经过的 RAS 坐标点，即三个平面的共享焦点
- **法向量 N**：`[nx, ny, nz]` —— 决定平面朝向（必须归一化）
- **切平面内轴 U（水平）** 和 **V（垂直）**：平面内的两个正交轴，U ⊥ V，且 `N = normalize(cross(U, V))`

```
平面方程：N · (P - C) = 0
其中 P 是平面上的任意 RAS 点
```

### 2.3 从基准方向推导初始平面参数

正交 MPR 的三个基准方向初始参数（RAS 空间）：

| 视图 | 法向量 N | 水平轴 U | 垂直轴 V |
|------|---------|---------|---------|
| **Axial** | `(0, 0, 1)` | `(1, 0, 0)` | `(0, -1, 0)` |
| **Coronal** | `(0, -1, 0)` | `(1, 0, 0)` | `(0, 0, 1)` |
| **Sagittal** | `(1, 0, 0)` | `(0, -1, 0)` | `(0, 0, 1)` |

> 注：L/R、A/P 方向上的负号来源于 RAS↔LPS 转换的约定，最终以渲染结果与放射学惯例一致为准。

### 2.4 斜切旋转（欧拉角）

用户交互通过旋转角度定义斜切，需要将欧拉角转换为法向量和切平面轴：

```typescript
// 斜切平面参数（UI 输入层）
export interface ObliquePlaneParams {
  center: [number, number, number];        // 共享焦点（RAS）
  rotationX: number;  // 绕 X 轴旋转（弧度）
  rotationY: number;  // 绕 Y 轴旋转（弧度）
  rotationZ: number;  // 绕 Z 轴旋转（弧度）
  baseOrientation: SliceOrientation;        // 基准方向
}
```

**⚠️ 注意**：欧拉角存在万向锁（gimbal lock）问题。不同旋转顺序（XYZ / ZYX / ...）会导致不同结果。仅用于用户输入的 UI convenience，内部表示始终为法向量 + 切平面轴三向量。

### 2.5 三线性插值

对于斜切平面上的任意采样点 `(x, y, z)`（IJK 空间，可能是非整数坐标）：

```
V(x,y,z) = (1-dx)(1-dy)(1-dz) * V(x0,y0,z0)
         +    dx (1-dy)(1-dz) * V(x1,y0,z0)
         + (1-dx)   dy (1-dz) * V(x0,y1,z0)
         +    dx    dy (1-dz) * V(x1,y1,z0)
         + (1-dx)(1-dy)   dz  * V(x0,y0,z1)
         +    dx (1-dy)   dz  * V(x1,y0,z1)
         + (1-dx)   dy    dz  * V(x0,y1,z1)
         +    dx    dy    dz  * V(x1,y1,z1)

其中:
  x0 = floor(x), x1 = x0 + 1, dx = x - x0
  y0 = floor(y), y1 = y0 + 1, dy = y - y0
  z0 = floor(z), z1 = z0 + 1, dz = z - z0
```

---

## 3. 架构设计

### 3.1 新增模块

```
packages/renderer-2d/src/
├── oblique/
│   ├── index.ts              # 模块导出
│   ├── types.ts              # 类型定义
│   ├── ObliquePlane.ts       # 斜切平面数学运算
│   ├── ObliqueExtractor.ts    # 斜切面提取（CPU）
│   └── trilinear.glsl         # 三线性插值 shader（可选，Phase 5）
```

### 3.2 类型定义

```typescript
// packages/renderer-2d/src/oblique/types.ts

/** 斜切平面参数（UI 输入层） */
export interface ObliquePlaneParams {
  center: [number, number, number];  // 共享焦点（RAS 空间）
  rotationX: number;                  // 绕 X 轴旋转（弧度）
  rotationY: number;                  // 绕 Y 轴旋转（弧度）
  rotationZ: number;                  // 绕 Z 轴旋转（弧度）
  baseOrientation: SliceOrientation;  // 基准方向（axial/coronal/sagittal）
}

/** 斜切平面（内部计算层） */
export interface ObliquePlaneComputed {
  center: [number, number, number];  // 共享焦点（RAS 空间）
  normal: [number, number, number];   // 法向量（RAS，归一化）
  uAxis: [number, number, number];   // 水平轴（RAS，归一化，⊥ normal）
  vAxis: [number, number, number];   // 垂直轴（RAS，归一化，⊥ normal, ⊥ uAxis）
  width: number;   // 输出图像宽度（像素）
  height: number;  // 输出图像高度（像素）
}

/** 斜切 MPR 状态 */
export interface ObliqueMPRState {
  focalPoint: CrosshairPosition;              // 共享焦点（IJK）
  focalPointRas: [number, number, number];   // 共享焦点（RAS）
  planes: {
    [key in SliceOrientation]: ObliquePlaneComputed;
  };
}

/** 视图斜切参数（用于 UI 控制） */
export interface ViewObliqueParams {
  orientation: SliceOrientation;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
}
```

### 3.3 核心类设计

#### 3.3.1 ObliquePlane

```typescript
// packages/renderer-2d/src/oblique/ObliquePlane.ts

// 斜切平面数学运算
export class ObliquePlane {
  private params: ObliquePlaneParams;
  private computed: ObliquePlaneComputed;
  private volumeDims: [number, number, number];
  private ijkToRas: Float64Array;  // 体积的 IJK→RAS affine 矩阵

  constructor(params: ObliquePlaneParams, volume: NiftiVolume);

  // 从欧拉角计算法向量和切平面轴
  private static computeFromEuler(
    baseOrientation: SliceOrientation,
    rx: number, ry: number, rz: number
  ): { normal: vec3, uAxis: vec3, vAxis: vec3 };

  // 更新旋转角度
  setRotation(rx: number, ry: number, rz: number): void;

  // 更新焦点（同时更新三个视图的中心点）
  setFocalPoint(ijk: CrosshairPosition): void;
  setFocalPointRas(ras: [number, number, number]): void;

  // 获取计算后的平面参数
  getComputed(): ObliquePlaneComputed;

  // 将平面内 2D 坐标 (u, v) 转换为 RAS 坐标
  planeToRas(u: number, v: number): [number, number, number];

  // 将 RAS 坐标转换为平面内 2D 坐标 (u, v)
  rasToPlane(ras: [number, number, number]): { u: number; v: number } | null;

  // 平面坐标 (u, v) → IJK（用于三线性采样）
  planeToIJK(u: number, v: number): [number, number, number];

  // IJK → 平面坐标 (u, v)
  ijkToPlane(ijk: [number, number, number]): { u: number; v: number } | null;

  // 获取当前平面与另一平面的交线（用于十字线联动）
  getIntersectionWith(other: ObliquePlaneComputed): Line3D | null;

  // RAS → IJK 转换（使用体积 affine）
  rasToIJK(ras: [number, number, number]): [number, number, number];

  // IJK → RAS 转换
  ijkToRas(ijk: [number, number, number]): [number, number, number];
}
```

#### 3.3.2 ObliqueExtractor

```typescript
// packages/renderer-2d/src/oblique/ObliqueExtractor.ts

// 斜切面提取器
export class ObliqueExtractor {
  private volume: NiftiVolume;
  private normalizedData: Float32Array;
  private windowLevel: { window: number; level: number };

  constructor(volume: NiftiVolume);

  // 提取斜切面（CPU 实现）
  extractSlice(plane: ObliquePlaneComputed): Uint8Array;

  // 设置窗口/窗位
  setWindowLevel(window: number, level: number): void;

  // 三线性插值采样（内部使用）
  private trilinearSample(ijk: [number, number, number]): number;

  // 降采样提取（用于交互过程中的快速预览）
  extractSliceDownsampled(plane: ObliquePlaneComputed, scale: number): Uint8Array;
}
```

### 3.4 数据流

```
用户拖拽（旋转斜切）
    │
    ▼
React App (App.tsx)
  - 管理 ObliqueMPRState（三个视图的 plane params）
  - 拖拽旋转时更新对应视图的 rotationX/Y/Z
  - RAF throttle 控制更新频率
    │
    ▼
ObliquePlane.computeFromEuler()
  - 将欧拉角 → 法向量 + 切平面轴（RAS 空间）
    │
    ├──────────────────────────────────────┐
    ▼                                      ▼
extractSlice() (CPU)              十字线联动计算
  - planeToIJK(u,v) → RAS          - getIntersectionWith(other)
  - rasToIJK() → IJK                - 得到交线的两个端点
  - trilinearSample() → intensity   - 投影到其他视图的 2D 坐标
  - window/level → Uint8Array
    │
    ▼
WebGLSliceView.render()
  - 上传 Uint8Array 为 R8 纹理
  - 渲染 textured quad
    │
    ▼
所有视图更新（同步）
```

---

## 4. 交互设计

### 4.1 旋转交互

每个视图的切平面通过旋转手柄进行斜切：

```
        ┌─────────────────┐
        │                 │
        │                 │
        │      ●──○──●    │  ← 旋转手柄（拖拽以旋转整个平面）
        │                 │
        │                 │
        └─────────────────┘
```

**交互模式**：

1. **拖拽十字线中心**：移动焦点位置（现有功能），三个视图同时更新
2. **拖拽旋转手柄**：改变该视图平面的法向量，其他两个视图同步更新十字线

**旋转限制**：
- 默认范围：`-60° ~ +60°`（可配置）
- 超出范围时 clamp 或显示警告

### 4.2 十字线联动

当一个视图的平面被斜切后：

1. 该视图的切平面法向量更新
2. 重新计算三个平面的公共交点（作为焦点）
3. 计算该视图与其他两个视图平面的交线
4. 在其他两个视图中绘制交线（仍为正交十字线，但位置和角度更新）

### 4.3 性能优化策略

**拖拽过程中的预览**：
- 使用 `extractSliceDownsampled(plane, scale=0.25)` 降采样纹理
- 用户停止拖拽后（mouseup / touchend）切换到全分辨率
- 使用 RAF coalescing 限制更新频率（目标 30fps+）

---

## 5. 实现路线

### Phase 1: 基础数学层

**目标**：实现斜切平面的数学运算

**任务**：
- [ ] 定义 `ObliquePlaneParams`、`ObliquePlaneComputed`、`ObliqueMPRState` 类型
- [ ] 实现 `ObliquePlane` 类
  - [ ] 基准方向 → 初始法向量/轴向量（RAS 空间）
  - [ ] 欧拉角 → 旋转矩阵
  - [ ] 旋转矩阵 → 平面法向量/轴向量
  - [ ] `planeToIJK()` 和 `ijkToPlane()` 转换
  - [ ] `getIntersectionWith()` 两平面交线计算
  - [ ] IJK ↔ RAS 转换（使用体积 affine）
- [ ] 单元测试（覆盖法向量正交性、交线计算、坐标转换）

### Phase 2: 斜切面提取

**目标**：实现三线性插值的斜切面采样

**任务**：
- [ ] 实现 `ObliqueExtractor` 类
  - [ ] `trilinearSample()` 实现
  - [ ] `extractSlice()` CPU 版本
  - [ ] `extractSliceDownsampled()` 降采样版本
  - [ ] 边界处理（越界返回 0 或 clamp）
  - [ ] window/level 应用
- [ ] 集成到 `WebGLSliceView`：新增 `setObliquePlane()` 方法接收 `ObliquePlaneComputed`
- [ ] 性能测试（不同体积大小的提取时间）

### Phase 3: 交互层

**目标**：实现平面旋转交互和视图联动

**任务**：
- [ ] 在 `App.tsx` 中引入 `ObliqueMPRState` 状态
- [ ] React 组件
  - [ ] 旋转手柄渲染
  - [ ] 拖拽旋转逻辑（更新对应视图的 rotationX/Y/Z）
  - [ ] 角度限制和视觉反馈
  - [ ] 降采样预览切换逻辑
- [ ] 状态管理
  - [ ] 三个视图各自维护独立的 `rotationX/Y/Z`
  - [ ] `ObliquePlane` 实例缓存，复用计算
  - [ ] RAF throttle（交互过程中使用降采样，停止后全分辨率）

### Phase 4: 视图联动与十字线同步

**目标**：实现三个斜切视图间的十字线联动

**任务**：
- [ ] 焦点管理：三个视图共享同一个 focal point（IJK）
- [ ] 交线计算：`getIntersectionWith()` 集成到 React 状态更新
- [ ] 十字线渲染扩展：支持在斜切视图中显示其他两视图平面的交线
- [ ] 颜色编码（保留现有颜色方案：Axial 视图水平线 = Coronal 色，垂直线 = Sagittal 色）
- [ ] 最终全分辨率渲染（mouseup 后）

### Phase 5: WebGL 优化（可选）

**目标**：GPU 加速斜切面提取

**任务**：
- [ ] 将 3D 体积上传为 WebGL 3D 纹理（`texImage3D`）
- [ ] 实现三线性插值 fragment shader
- [ ] 性能对比和优化

---

## 6. 技术难点和解决方案

### 6.1 三平面交点计算

**问题**：当三个平面各自倾斜时，它们的公共交点是否始终存在且唯一？

**分析**：三个不平行的平面在空间中必然交于唯一一点（线性代数中，三个平面方程联立有唯一解）。

**解决方案**：
- 以 focal point 为锚定：旋转平面时，平面始终经过 focal point
- Focal point 可以是用户拖拽的焦点位置，或从三个平面方程求解
- 交线方向 = `cross(n1, n2)`，确保 `|cross| > ε`（若接近零则两平面平行）

### 6.2 性能

**问题**：CPU 三线性插值对于大体积（如 512×512×256）在交互过程中可能无法达到 30fps。

**解决方案**：
1. **短期**：拖拽过程中降采样（scale=0.25），停止后全分辨率（已在 Phase 3 设计）
2. **中期**：Web Worker 并行计算（每个 Worker 处理 1/N 像素行）
3. **长期**：Phase 5 WebGL 3D 纹理 + shader 采样（GPU 硬件三线性过滤）

### 6.3 坐标系一致性

**问题**：斜切平面的法向量和切平面轴在 RAS 空间，但体积采样在 IJK 空间。

**解决方案**：
- 所有平面参数存储为 RAS 空间
- 采样时通过 `rasToIJK()` 转换：`ijk = affine_inverse * ras`
- 使用 NIfTI 头部的 sform（优先）/ qform affine 矩阵
- 现有的 `ijkToRas()` 和 `rasToIjk()` 来自 `parser-nifti` 包可直接复用

### 6.4 欧拉角万向锁

**问题**：使用欧拉角可能导致 gimbal lock，使得某些旋转方向无法独立表达。

**解决方案**：
- UI 层保留 Euler 角输入（用户友好）
- 内部始终使用法向量 + 切平面轴三向量存储
- 避免暴露欧拉角的中间状态给其他模块

---

## 7. 测试计划

### 7.1 单元测试

- [ ] 基准方向 → 初始法向量/轴向量正确
- [ ] 欧拉角 → 法向量转换（含 gimbal lock 边界）
- [ ] 法向量/轴向量正交性验证（`dot(n,u)=0`, `dot(n,v)=0`, `dot(u,v)=0`）
- [ ] `planeToIJK()` 和 `ijkToPlane()` 往返一致性
- [ ] `rasToIJK()` 和 `ijkToRas()` 往返一致性
- [ ] 两平面交线计算正确性
- [ ] 三平面交点存在且唯一
- [ ] 三线性插值正确性（与已知采样点对比）
- [ ] 边界条件处理（采样点越界）

### 7.2 集成测试

- [ ] 斜切视图渲染正确性（视觉验证）
- [ ] 视图间十字线同步（焦点移动时三个视图同步）
- [ ] 旋转交互响应（拖拽后平面朝向正确变化）
- [ ] 降采样 → 全分辨率切换流程

### 7.3 性能测试

- [ ] 不同体积大小的提取时间（256³, 512×512×256, 512³）
- [ ] 交互帧率测试（降采样模式目标 ≥ 30fps）
- [ ] Web Worker 并行化效果（Phase 5 前）

---

## 8. 文件清单

### 新增文件

| 文件路径 | 描述 |
|---------|------|
| `packages/renderer-2d/src/oblique/index.ts` | 模块导出 |
| `packages/renderer-2d/src/oblique/types.ts` | 类型定义 |
| `packages/renderer-2d/src/oblique/ObliquePlane.ts` | 斜切平面数学运算 |
| `packages/renderer-2d/src/oblique/ObliqueExtractor.ts` | 斜切面提取（CPU） |
| `packages/renderer-2d/src/oblique/trilinear.glsl` | 插值 shader（Phase 5，可选） |

### 修改文件

| 文件路径 | 修改内容 |
|---------|---------|
| `packages/renderer-2d/src/types.ts` | 新增斜切相关类型 |
| `packages/renderer-2d/src/index.ts` | 导出 `oblique` 模块 |
| `packages/renderer-2d/src/webgl-slice-view.ts` | 新增 `setObliquePlane()` 方法 |
| `apps/demo/src/App.tsx` | 斜切交互 UI、状态管理 |
| `apps/demo/src/styles.css` | 旋转手柄样式 |

---

## 9. 参考资源

- [NIfTI Coordinate Systems](https://nifti.nimh.nih.gov/nifti-1/documentation/nifti1fields/nifti1fields_pages/coord)
- [3D Slicer MPR Implementation](https://www.slicer.org/)
- [ITK Resample Image Filter](https://itk.org/Doxygen/html/classitk_1_1ResampleImageFilter.html)
- [vtkImageReslice](https://vtk.org/doc/nightly/html/classvtkImageReslice.html) — vtk.js 斜切重采样的底层算法参考
- [cornerstone3D Volume Viewport](https://docs.cornerstonejs.org/) — 浏览器端医学影像渲染的架构参考
