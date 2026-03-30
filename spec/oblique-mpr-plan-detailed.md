# Oblique MPR 详细开发计划

## 开发原则

1. **全程使用四元数**：避免欧拉角万向锁问题，所有旋转变换用 的 quat/quat2
2. **阶段性测试**：每个阶段完成后必须通过单元测试
3. **渐进式开发**：先 CPU 实现，后续可选 WebGL 优化
4. **动态输出尺寸**：斜切面尺寸基于体积边界框在切平面上的投影计算

---

## Phase 1: 基础数学层

### 目标
实现斜切平面的数学运算，包括四元数旋转、坐标转换、平面交线计算。

### 任务清单

#### 1.1 类型定义 (`packages/renderer-2d/src/oblique/types.ts`)
- [x] `ObliqueBasis`: 平面基向量 (normal, uAxis, vAxis)，全部归一化且正交
- [x] `ObliquePlaneComputed`: 计算后的平面参数（含 center, basis, width, height）
- [x] `ObliqueMPRState`: 三个视图的平面状态 + 共享焦点

#### 1.2 ObliquePlane 类 (`packages/renderer-2d/src/oblique/ObliquePlane.ts`)
- [x] 构造函数：接收 volume 和 baseOrientation
- [x] `getBasisForOrientation()`: 返回基准方向的初始基向量（需与现有正交 MPR 一致）
- [x] `setRotationQuaternion(q: quat)`: 通过四元数设置旋转
- [x] `setFocalPointRas(ras: vec3)`: 设置共享焦点（RAS 空间）
- [x] `computeOutputSize()`: 动态计算输出图像尺寸
- [x] `planeToRas(u, v): vec3`: 平面坐标 → RAS
- [x] `rasToPlane(ras): {u, v}`: RAS → 平面坐标
- [x] `planeToIjk(u, v): vec3`: 平面坐标 → IJK（用于采样）
- [x] `getIntersectionWith(other: ObliquePlaneComputed): Line3D | null`: 两平面交线

#### 1.3 工具函数 (`packages/renderer-2d/src/oblique/math.ts`)
- [x] `normalizeBasis(basis)`: 确保基向量正交归一化（Gram-Schmidt）
- [x] `planeIntersection(p1, p2)`: 计算两平面交线
- [x] `projectBoundingBox(dims, basis)`: 计算体积边界框在平面上的投影尺寸

#### 1.4 单元测试 (`tests/unit/oblique-plane.test.ts`)
- [x] 基准方向基向量与正交 MPR 一致性
- [x] 四元数旋转后基向量仍正交归一化
- [x] planeToRas / rasToPlane 往返一致性
- [x] planeToIjk 坐标转换正确性
- [x] 两平面交线计算正确性
- [x] 输出尺寸计算合理性

### 验收标准
- [x] 所有单元测试通过
- [x] 基准方向（无旋转）的斜切平面与正交 MPR 渲染结果视觉一致

---

## Phase 2: 斜切面提取

### 目标
实现三线性插值的斜切面采样，CPU 版本。

### 任务清单

#### 2.1 ObliqueExtractor 类 (`packages/renderer-2d/src/oblique/ObliqueExtractor.ts`)
- [x] 构造函数：接收 NiftiVolume，预处理归一化数据
- [x] `trilinearSample(ijk: vec3): number`: 三线性插值采样
- [x] `extractSlice(plane: ObliquePlaneComputed): Uint8Array`: 完整斜切面提取
- [x] `extractSliceDownsampled(plane, scale): Uint8Array`: 降采样版本（交互预览用）
- [x] 边界处理：越界采样返回 0
- [x] window/level 应用

#### 2.2 集成到 WebGLSliceView
- [x] 新增 `setObliquePlane(plane: ObliquePlaneComputed, extractor: ObliqueExtractor)` 方法
- [x] 渲染时检测是否有斜切平面，有则用 extractor 提取数据

#### 2.3 单元测试 (`tests/unit/oblique-extractor.test.ts`)
- [x] 三线性插值正确性（已知采样点对比）
- [x] 边界条件处理（越界返回 0）
- [x] 降采样输出尺寸正确
- [x] window/level 应用正确

### 验收标准
- [x] 所有单元测试通过
- [x] 基准方向斜切面渲染与正交 MPR 视觉一致
- [x] 旋转后的斜切面渲染正确（可视觉验证）

---

## Phase 3: 交互层

### 目标
实现平面旋转交互 UI。

### 任务清单

#### 3.1 React 状态管理 (`apps/demo/src/App.tsx`)
- [x] 新增 `obliqueState: ObliqueMPRState | null`
- [x] 新增 `isObliqueMode: boolean` 切换斜切/正交模式
- [x] 斜切模式下使用 ObliquePlane + ObliqueExtractor

#### 3.2 旋转交互组件
- [x] 旋转手柄渲染（覆盖在切片视图上）
- [x] 拖拽旋转逻辑：
  - [x] mousedown 记录起始位置
  - [x] mousemove 计算旋转四元数（基于拖拽方向和距离）
  - [x] mouseup 结束旋转，触发全分辨率渲染
- [x] 旋转限制（默认 ±60°，可配置）

#### 3.3 性能优化
- [x] 拖拽过程中使用降采样 (scale=0.25)
- [x] RAF throttle 限制更新频率
- [x] mouseup 后切换全分辨率

#### 3.4 单元测试 (`tests/unit/oblique-interaction.test.ts`)
- [x] 旋转四元数计算正确性
- [x] 旋转限制（角度 clamp）
- [x] 状态更新流程

### 验收标准
- [x] 拖拽旋转手柄可改变平面朝向
- [x] 拖拽过程流畅（目标 ≥30fps）
- [x] 释放后切换全分辨率

---

## Phase 4: 视图联动与十字线同步

### 目标
实现三个斜切视图间的十字线联动。

### 任务清单

#### 4.1 焦点管理
- [x] 三个视图共享同一个 focalPoint（IJK/RAS）
- [x] 拖拽十字线交点更新 focalPoint
- [x] focalPoint 更新触发三个视图重渲染

#### 4.2 交线计算与渲染
- [x] 计算当前视图平面与其他两视图平面的交线
- [x] 将交线投影到当前视图的 2D 平面坐标
- [x] 渲染交线作为十字线（可能不再水平/垂直）

#### 4.3 颜色编码
- [x] 保留现有颜色方案
- [x] 斜切模式下十字线颜色与平面朝向对应

#### 4.4 单元测试 (`tests/unit/oblique-crosshair.test.ts`)
- [x] 三平面交点存在且唯一
- [x] 交线计算正确性
- [x] 交线投影到 2D 坐标正确

### 验收标准
- [x] 拖动一个视图的焦点，其他两视图同步更新
- [x] 旋转一个视图的平面，其他两视图的十字线更新
- [x] 十字线始终是三平面的交线

---

## Phase 5: WebGL 优化（可选）

### 目标
GPU 加速斜切面提取。

### 任务清单
- [x] 将 3D 体积上传为 WebGL 3D 纹理
- [x] 实现三线性插值 fragment shader
- [x] 性能对比和优化

### 验收标准
- [x] 渲染结果与 CPU 版本一致
- [x] 性能显著提升（目标 ≥60fps）

---

## 文件清单

### 新增文件
| 文件路径 | 描述 | 阶段 |
|---------|------|-----|
| `packages/renderer-2d/src/oblique/index.ts` | 模块导出 | 1 |
| `packages/renderer-2d/src/oblique/types.ts` | 类型定义 | 1 |
| `packages/renderer-2d/src/oblique/math.ts` | 数学工具函数 | 1 |
| `packages/renderer-2d/src/oblique/ObliquePlane.ts` | 斜切平面类 | 1 |
| `packages/renderer-2d/src/oblique/ObliqueExtractor.ts` | 斜切面提取器 | 2 |
| `tests/unit/oblique-plane.test.ts` | Phase 1 测试 | 1 |
| `tests/unit/oblique-extractor.test.ts` | Phase 2 测试 | 2 |
| `tests/unit/oblique-interaction.test.ts` | Phase 3 测试 | 3 |
| `tests/unit/oblique-crosshair.test.ts` | Phase 4 测试 | 4 |

### 修改文件
| 文件路径 | 修改内容 | 阶段 |
|---------|---------|-----|
| `packages/renderer-2d/src/types.ts` | 新增斜切相关类型 | 1 |
| `packages/renderer-2d/src/index.ts` | 导出 oblique 模块 | 1 |
| `packages/renderer-2d/src/webgl-slice-view.ts` | 新增 setObliquePlane | 2 |
| `apps/demo/src/App.tsx` | 斜切交互 UI | 3, 4 |
| `apps/demo/src/styles.css` | 旋转手柄样式 | 3 |

---

## 当前进度

- [x] Phase 1: 基础数学层
- [x] Phase 2: 斜切面提取
- [x] Phase 3: 交互层
- [x] Phase 4: 视图联动与十字线同步
- [x] Phase 5: WebGL 优化（可选）
