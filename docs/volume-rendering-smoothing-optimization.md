# 3D 体绘制表面噪点优化调研报告

> 调研对象：VTK 平滑与去噪算法
> 目标：系统性消除 jsMedgl 3D 体绘制中的表面噪点问题
> 日期：2026-04-09

---

## 1. 问题分析

### 1.1 当前现象

3D 体绘制表面出现可见噪点，影响渲染质量。

### 1.2 问题根源分类

| 伪影类型 | 视觉现象 | 根因分析 |
|---------|---------|---------|
| **Wood-grain / Striping** | 沿射线方向的规则条纹状噪点 | 采样点对齐到规则网格，采样间距与体素间距共振 |
| **Gradient noise** | 表面明暗闪烁、不均匀 | 中心差分计算的梯度噪声被 Phong 光照放大 |
| **Undersampling** | 块状/锯齿状表面 | step size 过大，采样不足 |

### 1.3 当前实现的关键缺失

分析 `packages/renderer-3d/src/shaders/raycasting.frag.glsl`：

1. **缺少 Jittered Sampling** — 每条射线从 entryPoint 开始，采样点落在规则网格上，导致 aliasing
2. **梯度计算噪声敏感** — `step=0.002` 的中心差分对 8-bit 归一化数据非常敏感
3. **单样本梯度估计** — 每次光照需要 6 次额外纹理采样，无平滑处理

---

## 2. VTK 算法调研

### 2.1 体数据预处理过滤器（作用于体素数据）

#### 2.1.1 `vtkImageGaussianSmooth` — 高斯平滑

- **VTK 路径**: `Imaging/General/vtkImageGaussianSmooth.{h,cxx}`
- **算法**: 可分离 1D/2D/3D 高斯卷积（separable Gaussian convolution）
- **核心参数**:

| 参数 | 类型 | 默认值 | 说明 |
|-----|------|-------|------|
| `StandardDeviations[3]` | double[3] | (2.0, 2.0, 2.0) | 各轴标准差（像素单位） |
| `RadiusFactors[3]` | double[3] | (1.5, 1.5, 1.5) | 核半径系数：radius = sigma * factor |
| `Dimensionality` | int | 3 | 1=X轴, 2=XY, 3=XYZ |

- **核半径计算**: `radius = int(sigma * radiusFactor)`，默认 sigma=2, factor=1.5 → radius=3 → 7 个采样点

- **医学成像典型值**:
  - 低噪声 CT: `sigma = 1.0`
  - 标准 CT: `sigma = (1.5, 1.5, 1.5)`
  - MRI（高噪声）: `sigma = (2.0, 2.0, 1.0)`

- **WebGL 实现**: 可用 3 个 1D pass 实现（X, Y, Z），核预计算为 `Float32Array`

#### 2.1.2 `vtkImageMedian3D` — 中值滤波

- **VTK 路径**: `Imaging/General/vtkImageMedian3D.{h,cxx}`
- **算法**: 矩形邻域中值替换，使用 `std::nth_element` 高效计算
- **核心参数**:

| 参数 | 类型 | 默认值 | 说明 |
|-----|------|-------|------|
| `KernelSize[3]` | int[3] | (1, 1, 1) | 邻域核大小（宽 x 高 x 深） |

- **医学成像典型值**:
  - 轻微噪声: `KernelSize(3, 3, 3)` — 27 个元素
  - 中等噪声: `KernelSize(5, 5, 5)` — 125 个元素
  - 精细保留: `KernelSize(3, 3, 1)` — 保留 Z 轴分辨率

- **特点**: 边缘保护优于高斯，适合去除椒盐噪声

#### 2.1.3 `vtkImageAnisotropicDiffusion3D` — 各向异性扩散

- **VTK 路径**: `Imaging/General/vtkImageAnisotropicDiffusion3D.{h,cxx}`
- **算法**: Perona-Malik 类型边缘保留扩散
- **核心参数**:

| 参数 | 类型 | 默认值 | 说明 |
|-----|------|-------|------|
| `NumberOfIterations` | int | 4 | 扩散迭代次数 |
| `DiffusionThreshold` | double | 5.0 | 差异阈值（HU 单位） |
| `DiffusionFactor` | double | 1.0 | 扩散强度因子 |
| `Faces/Edges/Corners` | bool | On | 邻域包含面/边/角 |

- **医学成像典型值**:
  - 软组织 CT: `Iterations=2-4`, `Threshold=5-10`
  - 骨组织: `Iterations=1-2`, `Threshold=15-20`
  - MRI T2: `Iterations=5-8`, `Threshold=3-5`

- **WebGL 适用性**: 多轮迭代开销大，建议预计算或避免实时使用

### 2.2 表面网格平滑过滤器（作用于 mesh 数据）

> 注：仅适用于 marching cubes / isosurface 表面重建管线

#### 2.2.1 `vtkSmoothPolyDataFilter` — Laplacian 平滑

- **VTK 路径**: `Filters/Core/vtkSmoothPolyDataFilter.{h,cxx}`
- **算法**: Laplacian/umbrella operator，顶点移向邻接顶点平均位置
- **核心参数**:

| 参数 | 类型 | 默认值 | 说明 |
|-----|------|-------|------|
| `NumberOfIterations` | int | 20 | 最大迭代次数 |
| `RelaxationFactor` | double | 0.01 | 松弛因子（位移比例） |
| `FeatureEdgeSmoothing` | bool | Off | 是否在锐利边缘保持不动 |
| `FeatureAngle` | double | 45.0° | 特征边缘角度阈值 |
| `BoundarySmoothing` | bool | On | 是否平滑边界顶点 |

- **公式**: `newPos = oldPos + RelaxationFactor * (meanNeighborPos - oldPos)`
- **缺点**: 过度平滑导致网格收缩（shrinkage）

#### 2.2.2 `vtkWindowedSincPolyDataFilter` — Taubin 平滑

- **VTK 路径**: `Filters/Core/vtkWindowedSincPolyDataFilter.{h,cxx}`
- **算法**: Taubin 窗口化 sinc 函数低通滤波，基于 Chebyshev 多项式
- **核心参数**:

| 参数 | 类型 | 默认值 | 说明 |
|-----|------|-------|------|
| `NumberOfIterations` | int | 20 | Chebyshev 多项式阶数 |
| `PassBand` | double | 0.1 | 通带边缘（0-2），越小越平滑 |
| `WindowFunction` | enum | NUTTALL | NUTTALL(推荐)/BLACKMAN/HANNING/HAMMING |
| `NormalizeCoordinates` | bool | false | 是否归一化到 [-1,1] |

- **优点**:
  - 最小化网格收缩（与 Laplacian 相比）
  - 理论基础扎实（理想低通滤波近似）
  - VTK 默认推荐（2020+）

- **医学成像典型值**:
  - 保留解剖细节: `Iterations=15-20`, `PassBand=0.1`
  - 强平滑: `Iterations=25-30`, `PassBand=0.05`

### 2.3 体绘制专用抗锯齿技术

#### 2.3.1 Jittered Sampling（抖动采样）

- **来源**: `Rendering/Volume/vtkGPUVolumeRayCastMapper`
- **作用**: 消除木纹/波纹效应（wood-grain aliasing）
- **实现**: 用噪声纹理微扰每条射线的遍历起始位置
- **VTK GLSL 细节**:

```glsl
float g_jitterValue = 0.0; // 由 mapper 设置
// 用于扰动 ray 的起始位置，将采样点从规则网格偏移
```

- **效果**: 将条纹伪影打散为均匀高频噪声，人眼几乎不可见

#### 2.3.2 采样距离控制

| 参数 | 默认值 | 说明 |
|-----|-------|------|
| `SampleDistance` | 1.0 | 相邻采样点间距（体素单位） |
| `ImageSampleDistance` | 1.0 | 光线间隔（1=每像素1条, 0.5=每像素4条） |
| `AutoAdjustSampleDistances` | On | 自动调整以满足帧率 |

- **自动计算规则**: 与 `numVoxels^(1/3)` 成正比
  - 8 个体素: `SampleDistance ≈ avgSpacing / 200`
  - 1M 个体素: `SampleDistance ≈ avgSpacing / 2`

#### 2.3.3 空间跳跃（Space Leaping）

- **来源**: `vtkFixedPointVolumeRayCastMapper`
- **实现**: 4x4x4 下采样 min-max volume，跳过透明区域
- **存储**: 每个单元存储 min/max 标量值 + 最大梯度不透明度

#### 2.3.4 Pre-integrated Volume Rendering

- **来源**: Engel et al. 2001（VTK 已实现）
- **原理**: 预计算相邻采样点之间的积分，用 2D LUT 查表
- **优势**:
  - 消除木纹效应
  - 允许更少的采样次数
  - 图像质量媲美 best post-shading
- **复杂度**: 需要重构 transfer function 逻辑，支持 2D transfer function

---

## 3. 优化路线图

### 优先级矩阵

| 优化项 | 实施难度 | 效果提升 | 推荐优先级 |
|-------|---------|---------|-----------|
| Jittered Sampling | 低（3 行代码） | 高 | **P0 - 立即实施** |
| 梯度平滑（3x3 平均） | 低（改 shader） | 中高 | **P1 - 短期** |
| 预计算梯度纹理 | 中（改管线） | 高 | **P1 - 短期** |
| 高斯预处理（离线） | 中（改 loader） | 中 | **P2 - 中期** |
| Pre-integrated Rendering | 高（重构 TF） | 很高 | **P3 - 长期** |
| 各向异性扩散预处理 | 高（离线计算） | 高 | **P3 - 长期** |

### 3.1 P0: Jittered Sampling（立即实施）

**目标**: 消除 wood-grain 条纹伪影

**实现方案**:

```glsl
// 在 raycasting.frag.glsl 的 main() 中，tNear 计算后添加：

// Pseudo-random hash based on fragment coordinates
float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);

// Offset entry point by jitter * stepSize along ray direction
vec3 entryPoint = rayOrigin + rayDir * (tNear + jitter * u_stepSize);
```

**预期效果**: 条纹伪影变为均匀噪声，表面平滑度显著提升

---

### 3.2 P1: 梯度估计优化

#### 方案 A: 梯度平滑（3x3 平均）

**目标**: 减少实时梯度计算的噪声

**实现方案**:

```glsl
// 修改 computeGradient，在中心差分后加 3x3 平滑
vec3 computeGradientSmoothed(vec3 pos) {
  float step = 0.002;
  vec3 grad = vec3(0.0);
  
  // 3x3 邻域平均（9 个位置的梯度平均）
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      vec3 offset = vec3(float(x) * step * 0.5, float(y) * step * 0.5, 0.0);
      grad += computeGradient(pos + offset);
    }
  }
  return grad / 9.0;
}
```

**权衡**: 额外 9x6=54 次采样 vs 仅对 lighting 启用时的表面采样点

#### 方案 B: 预计算梯度纹理（推荐）

**目标**: 彻底消除梯度计算噪声，提升性能

**实现步骤**:

1. **CPU 预计算阶段**（数据加载时）：
   - 对原始 volume 计算梯度场（central difference）
   - 可选：应用 3x3x3 高斯平滑到梯度场
   - 编码为 RGBA8 纹理：RG=法线方向(encoded), BA=梯度幅度

2. **Shader 修改**:
   - 添加 `uniform sampler3D u_gradientTexture`
   - `computeGradient` 改为 texture lookup + decode
   - 使用硬件 trilinear 插值自动平滑

**预期效果**: 最平滑的表面着色，同时减少 ray marching 内的纹理采样次数

---

### 3.3 P2: 体数据预处理（离线）

#### 方案: 加载时 Gaussian Smooth

**目标**: 降低原始数据的噪声水平

**实现方案**:

```typescript
// VolumeTextureManager 或独立 preprocessor
class VolumePreprocessor {
  // Separable 3D Gaussian convolution
  static gaussianSmooth3D(
    data: Uint8Array,
    dims: [number, number, number],
    sigma: [number, number, number]
  ): Uint8Array {
    // 3 passes: X, Y, Z
    // Kernel precompute: exp(-(x^2) / (2*sigma^2))
    // Normalize kernel
    // Convolve with appropriate padding
  }
}
```

**默认参数**: `sigma = [1.0, 1.0, 1.0]`（轻度平滑，保留细节）

**可选**: 暴露用户参数 `smoothingSigma: number`，范围 0-3

---

### 3.4 P3: 高级优化（长期）

#### Pre-integrated Volume Rendering

**目标**: 达到 VTK/3D Slicer 级别的渲染质量

**技术要点**:

1. **2D Transfer Function**: 颜色和不透明度同时依赖于标量值和梯度幅度
2. **Pre-integration Table**: 预计算 `[f_front, f_back]` 区间积分
3. **Shader 修改**: ray marching 内改为查表而非逐点 TF 计算

**参考实现**: Engel et al. 2001, VTK `vtkPreIntegrationTable`

#### 各向异性扩散预处理

**目标**: 边缘保留的强力降噪

**适用场景**: MRI 等噪声较高的 modality

**实现**: 离线计算，WebGL 端无改动

---

## 4. 算法选择指南

### 4.1 按数据类型选择

| 数据类型 | 主要噪点来源 | 推荐方案 |
|---------|-------------|---------|
| CT（低噪声） | Gradient aliasing | Jittered Sampling + 轻微高斯预处理 |
| CT（软组织） | 低密度区域噪声 | Jittered Sampling + 各向异性扩散预处理 |
| MRI | 采集噪声 | 中值滤波预处理 + Jittered Sampling |
| PET/SPECT | 统计噪声 | 高斯平滑预处理（sigma=2） |

### 4.2 按性能要求选择

| 性能预算 | 推荐方案 |
|---------|---------|
| 实时交互（60fps） | Jittered Sampling only |
| 平衡质量/性能 | Jittered + 预计算梯度纹理 |
| 最高质量（<30fps 可接受） | Pre-integrated + Anisotropic Diffusion |

---

## 5. 参考资源

### VTK 官方资源

- [VTK Book: Chapter 9 - Advanced Algorithms](https://book.vtk.org/en/latest/VTKBook/09Chapter9.html)
- [VTK Discourse: Eliminating Ripples in Volume Rendering](https://discourse.vtk.org/t/how-do-i-eliminate-the-ripples-of-volume-rendering/4109)
- [VTK GitHub - Surface Nets 3D](https://gist.github.com/mhalle/9e0d85198f274b21e39197992fd7d669)
- [VTK Bilateral Mesh Denoising](https://sadeghi.com/Bilateral-Mesh-Denoising/)

### 学术文献

- **Engel et al. 2001**: [High-Quality Pre-Integrated Volume Rendering](https://www3.cs.stonybrook.edu/~mueller/teaching/cse616/engel.pdf)
- **Pre-integrated Rendering Extensions**: [TU Munich Technical Report](https://www.cs.cit.tum.de/fileadmin/w00cfj/cg/Research/Publications/2008/Pre-Integrated_Volume_Rendering/vg08-kraus.pdf)

### WebGL 体绘制实现

- [Interactive Volume Visualization with WebGL - University of Stuttgart](https://www2.informatik.uni-stuttgart.de/bibliothek/ftp/meddoc.ustuttgart_fi/BCLR-0006/BCLR-0006.pdf)
- [High-Performance Volume Rendering on WebGL](https://www.researchgate.net/publication/224807348_High_Performance_Volume_Rendering_on_the_Ubiquitous_WebGL_Platform)
- [Volumetric Surfaces: Layered Meshes for WebGL - CVPR 2025](https://arxiv.org/html/2409.02482v2)

---

## 6. 交互式自适应采样（Adaptive LOD）

> 目标：旋转/拖拽时保持 60fps 流畅交互，静止时恢复最高渲染质量
> 参考：VTK `AutoAdjustSampleDistances`、3D Slicer 交互降级策略

### 6.1 问题分析

体绘制 ray marching 的性能瓶颈在于**每帧每像素的 ray 采样次数**：

```
每帧工作量 ≈ 屏幕像素数 × (rayLength / stepSize)
```

当前配置 `stepSize = 0.003`，典型 ray 长度 `≈ 1.0`，约 **333 次采样/像素**。
对于 800×600 视口，一帧需要约 1.6 亿次纹理采样。旋转时需要持��� 60fps，
每帧预算仅 16.7ms，压力很大。

### 6.2 优化手段对比

| 手段 | 实现复杂度 | 性能提升 | 视觉影响 | 适用场景 |
|------|-----------|---------|---------|---------|
| **增大 stepSize** | 低（1 个 uniform） | ~3-5× | 细节模糊，木纹伪影加重 | 旋转时快速降级 |
| **降低渲染分辨率** | 低（改 viewport） | ~4×（半分辨率） | 整体模糊，但结构清晰 | 高 DPI 设备首选 |
| **关闭光照** | 低（1 个 bool） | ~30%（省掉梯度采样） | 失去立体感 | 不推荐单独使用 |
| **减少 maxSteps** | 低（1 个 uniform） | 低（远距离处） | 远处半透明物体消失 | 远景多时有效 |
| **Early ray termination 阈值** | 已实现 | ~20% | 无 | 始终开启 |

### 6.3 推荐方案：双参数自适应降级

采用 **stepSize + 渲染分辨率** 联合降级，分三档：

| 状态 | stepSize | 渲染分辨率 | 预期 FPS |
|------|----------|-----------|---------|
| **静止 (Still)** | 0.003 | 100% | 视硬件而定 |
| **交互 (Interacting)** | 0.008 | 50% | ≥ 30fps |
| **快速交互 (Fast)** | 0.015 | 25% | ≥ 60fps |

> 注：交互时不关闭光照。预计算梯度纹理已将梯度计算从 6 次采样降至 1 次，光照开销已很低。关闭光照仅节省约 5-10%，但会突然失去立体感，视觉代价大于收益。

#### 状态切换逻辑

```
鼠标按下 → Interacting 状态
  ├── 静止超过 200ms → Still（渐进恢复）
  └── 连续 FPS < 25 → Fast 状态
鼠标释放 → 延迟 100ms 后 → Still 状态（渐进恢复）
```

#### 渐进恢复（Progressive Refinement）

交互结束后分阶段恢复，避免闪烁：

```
Step 1: 恢复分辨率到 100%（立即，几乎无开销）
Step 2: stepSize 从 0.008 → 0.003（延迟 50ms）
```

### 6.4 实现路径

#### 6.4.1 stepSize 动态调整

已有 `u_stepSize` uniform，只需在 `VolumeRenderView` 中根据交互状态动态设置：

```typescript
// VolumeRenderView.ts
private interactionState: 'still' | 'interacting' | 'fast' = 'still';

private handleMouseDown = (e: MouseEvent): void => {
  // ...
  this.setInteractionState('interacting');
};

private handleMouseUp = (): void => {
  this.drag.active = false;
  this.scheduleProgressiveRefinement();
};

private setInteractionState(state: 'still' | 'interacting' | 'fast'): void {
  this.interactionState = state;
  const presets = {
    still:        { stepSize: 0.003, resolution: 1.0 },
    interacting:  { stepSize: 0.008, resolution: 0.5 },
    fast:         { stepSize: 0.015, resolution: 0.25 },
  };
  const p = presets[state];
  this.renderer.setConfig({ stepSize: p.stepSize });
  this.renderScale = p.resolution;
  // lighting 控制...
}
```

#### 6.4.2 渲染分辨率缩放

通过 `gl.viewport()` + canvas 尺寸控制，不需要改 shader：

```typescript
// resize() 中根据 renderScale 缩放
private renderScale = 1.0;

private resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = this.container.clientWidth;
  const h = this.container.clientHeight;

  // canvas CSS 尺寸保持不变
  this.canvas.style.width = w + 'px';
  this.canvas.style.height = h + 'px';

  // 实际像素数按 renderScale 缩放
  this.canvas.width = Math.round(w * dpr * this.renderScale);
  this.canvas.height = Math.round(h * dpr * this.renderScale);

  // GPU 会自动双线性放大到 CSS 尺寸，交互时模糊但不卡顿
}
```

#### 6.4.3 自动 FPS 驱动降级

利用已有的 FPS 计数器，当连续 N 帧 FPS 过低时自动降级：

```typescript
private doRender(): void {
  // ... existing render logic ...

  // Auto-degrade if FPS is too low during interaction
  if (this.interactionState === 'interacting' && this.statsFps > 0 && this.statsFps < 25) {
    this.setInteractionState('fast');
  }
}
```

### 6.5 VTK 参考实现

VTK 的 `vtkGPUVolumeRayCastMapper` 使用 `AutoAdjustSampleDistances` 策略：

1. 每帧测量渲染时间
2. 如果超过目标帧时间（默认 1/30s），增大 `ImageSampleDistance`（相当于降低分辨率）
3. 同时增大 `SampleDistance`（增大步长）
4. 交互结束后逐步恢复原始参数

VTK 源码参考：
- `Rendering/Volume/vtkGPUVolumeRayCastMapper.cxx` — `ComputeRayCastSize()`
- 核心逻辑：`newSampleDistance = oldSampleDistance * (renderTime / targetTime) ^ 0.5`

### 6.6 性能预期

以 256³ 体积 + 800×600 视口为例：

| 状态 | stepSize | 分辨率 | 每像素采样数 | 总采样/帧 | 预期帧时间 |
|------|----------|-------|-------------|----------|-----------|
| Still | 0.003 | 800×600 | ~333 | 1.6 亿 | ~30-50ms |
| Interacting | 0.008 | 400×300 | ~125 | 1500 万 | ~5-8ms |
| Fast | 0.015 | 200×150 | ~67 | 200 万 | ~1-2ms |

交互档位下预计可达 **100+ fps**，Fast 档位下 **200+ fps**。

---

## 7. 下一步行动

1. [x] **P0**: 在 `raycasting.frag.glsl` 中添加 Jittered Sampling — ✅ 已实现
2. [x] **P1**: 实现预计算梯度纹理管线 — ✅ 已实现
3. [x] **P1**: 交互式自适应采样 — ✅ 已实现（stepSize + renderScale 三档降级，FPS 驱动自动切换）
5. [ ] **P2**: 设计 VolumePreprocessor API（可选离线高斯平滑）
6. [ ] **P2**: 实现离线高斯平滑（用户可选开关）
7. [ ] **P3**: 调研 Pre-integrated Rendering 的完整实现

### 7.1 已实现功能（v0.2）

| 功能 | 文件 | 说明 |
|------|------|------|
| FPS 计数器 | `VolumeRenderView.ts` | 左上角实时显示，500ms 采样间隔，颜色编码（绿/黄/红） |
| Jittered Sampling | `WebGLVolumeRenderer.ts` | `u_jitterEnabled` 控制，`computeJitter()` 基于片段坐标的稳定伪随机偏移 |
| 预计算梯度纹理 | `VolumeTextureManager.ts` | CPU 端 central difference，RGBA8 编码（法线方向 + 幅度），上传为 3D 纹理 |
| Shader 梯度查找 | `WebGLVolumeRenderer.ts` | `sampleGradient()` 解码 + trilinear 插值，EMA 平滑 (blendFactor=0.3) |
| FPS 公共 API | `VolumeRenderView.ts` | `getStats(): { fps: number }` 供外部轮询 |
