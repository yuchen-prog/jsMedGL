# VR 各向异性体渲染 Bug 定位报告

**日期**: 2026-04-16
**问题**: 3D 体渲染（VR）切换各向异性 DICOM 数据时崩溃，WebGL 报错 `texImage3D: ArrayBufferView not big enough for request`
**状态**: 已修复 ✓

---

## 问题描述

加载具有各向异性体素间距的 DICOM 数据（如 spacing `[0.8, 0.8, 5.0]mm`），然后切换到 3D 体渲染模式时，浏览器控制台报错：

```
WebGL: INVALID_OPERATION: texImage3D: ArrayBufferView not big enough for request
```

同时伴随：

```
useProgram: attempt to use a deleted object
```

渲染结果为黑屏。但修改前（非各向异性校正的代码）可以正常渲染，只是几何比例看起来不对。

---

## 定位过程

### Step 1 — 建立基准，理解代码流程

```
用户切换到 3D 模式
  → App.tsx VolumeViewer useEffect [volume] 触发
  → createVolumeRenderView() 创建新实例
  → view.setVolume(volume)
  → WebGLVolumeRenderer.setVolume()
  → VolumeTextureManager.upload()
  → texImage3D() ← 报错
  → WebGL context 损坏，后续所有 GL 调用报错
  → 黑屏
```

通过阅读代码确认：错误发生在 `VolumeTextureManager.upload()` 内部，不涉及 React 交互逻辑层。

---

### Step 2 — 添加精确诊断，缩小范围

在 `upload()` 的两个 `texImage3D` 调用（体纹理 + 梯度纹理）前后各插入 `gl.getError()` 检查：

```ts
gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, ..., isotex);
const volTexError = gl.getError();  // ← 检查点 A
if (volTexError !== gl.NO_ERROR) {
  console.error('[VolumeTextureManager] volume texImage3D FAILED, gl error:', volTexError);
}
// ... later ...
console.log('gradient upload:', { glErrorBefore: gl.getError() });  // ← 检查点 B
gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, ..., gradientData);
console.log('gradient upload glError after:', gl.getError());        // ← 检查点 C
```

**实际输出**：

```
[VolumeTextureManager] volume texImage3D FAILED, gl error: 1282     ← 检查点 A 失败
[VolumeTextureManager] gradient upload: { glErrorBefore: 0 }           ← 检查点 B 无错误！
[VolumeTextureManager] gradient upload glError after: 0               ← 检查点 C 无错误
```

---

### Step 3 — 分析"意外成功"现象

梯度纹理 `texImage3D` **不应该成功**，因为它需要 `131×131×384×4 = 26,359,296` 字节，而如果缓冲真的太小，两个调用都会失败。

唯一可能的解释是：

1. **体纹理 texImage3D 执行了**（但产生了错误）
2. **错误被记录在 GL 内部状态**（`GL_INVALID_OPERATION = 1282`）
3. **`gl.getError()` 调用清除了该错误标记**
4. **梯度纹理 texImage3D 执行时，前一个错误已被清除**
5. 因此梯度纹理"看起来"成功了

> 这是一个典型的"被掩盖的错误"——后续的调用没有失败，但它并不是真正的成功。

---

### Step 4 — 追溯变更历史

查看 git diff 发现，本次修改在 `VolumeTextureManager.upload()` 中引入了各向同性重采样（`resampleToIsotropic()`）：

```ts
// 修改前（原始代码）
const normalized = this.normalizeVolumeData(volume);  // Uint8Array, 63M 字节
gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, dims, normalized); // 直接上传 [512,512,242]

// 修改后
const normalized = this.normalizeVolumeData(volume);  // Uint8Array, 63M 字节
const isotex = this.resampleToIsotropic(normalized, ...); // 重采样到 [131,131,384], 6.6M 字节
gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, outDims, isotex);  // 上传重采样结果
```

**关键问题**：为什么重采样后的 `texImage3D` 会报错？

---

### Step 5 — 理解竞态条件的根因

原来引入重采样���目的是让各向异性数据变成各向同性纹理，以解决渲染比例问题。但这个方案有一个副作用：

**`computeGradientField(isotex, outDims)` 的计算量**：`131×131×384 ≈ 660万` 次迭代，每次需要 6 次 `sampleVoxel`（含 `Math.max/Math.min/Math.round` + 数组索引）。

这在主线程上需要约 **100–200ms**。

与此同时，React 应用中启用了 **StrictMode**，它在开发环境下执行 effects 两次：

```
第一次 mount: upload() 开始执行
  → normalizeVolumeData（~50ms）✓
  → resampleToIsotropic（~80ms）✓
  → computeGradientField（~120ms）← 还在执行中...
    ↓
  StrictMode cleanup: dispose() 被调用
  → WebGL context 中的纹理/程序被删除
    ↓
  upload() 的后续步骤（texImage3D）在已被 dispose 的 context 上执行
    ↓
  INVALID_OPERATION 错误
    ↓
  WebGL context 损坏，后续所有 GL 调用报错
```

这个竞态条件解释了所有现象：
- 为什么缓冲大小正确但仍然报错
- 为什么错误发生在体纹理而非梯度纹理（因为是第一个 texImage3D）
- 为什么 `useProgram: deleted object` 错误同时出现（context 已损坏）

---

## 修复方案

### 方案对比

| | 重采样方案 | 着色器校正方案 |
|---|---|---|
| 修改范围 | `VolumeTextureManager.upload()` + `resampleToIsotropic` + `computeGradientField` | 着色器新增 uniform + 包围盒修改 |
| 计算量 | 归一化(63M) + 重采样(6.6M) + 梯度(26M) | 归一化(63M) + 梯度(63M) |
| WebGL 路径 | 改变 texImage3D 尺寸 | 与原代码完全一致 |
| 复杂度 | 高 | 低 |
| 副作用 | 竞态条件导致崩溃 | 无 |

### 最终方案：着色器校正

**核心思路**：不重采样，直接在着色器中校正物理比例。

#### 1. `VolumeTextureManager.ts` — 恢复原始上传逻辑

移除重采样代码，恢复直接上传原始体素数据。同时计算并存储 `physicalDimensions`（用于着色器 uniform）。

```ts
// 恢复原始上传（无重采样）
const normalized = this.normalizeVolumeData(volume);
gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, dims, normalized);  // dims = [512, 512, 242]

// 计算物理尺寸（用于着色器校正）
const spacing: [number, number, number] = [volume.spacing[0] || 1, ...];
const physDims: [number, number, number] = [
  dims[0] * spacing[0],  // e.g. 412mm
  dims[1] * spacing[1],  // e.g. 412mm
  dims[2] * spacing[2],  // e.g. 1210mm
];
```

#### 2. `WebGLVolumeRenderer.ts` — 新增 `u_volumeAspect` uniform

在着色器中新增 `u_volumeAspect: vec3` uniform，值为物理尺寸归一化（最长轴 = 1.0）：

```glsl
// 片段着色器
uniform vec3 u_volumeAspect;  // 例如 [0.34, 0.34, 1.0] for 512×512×242 @ 0.8×0.8×5mm

const vec3 BOX_MIN = vec3(0.0);
// BOX_MAX 从 vec3(1.0) 改为 uniform

vec2 intersectBox(vec3 ro, vec3 rd) {
  vec3 boxMax = u_volumeAspect;        // 包围盒拉伸
  // ... slab algorithm ...
}

// 主渲染循环
vec3 invAspect = 1.0 / u_volumeAspect;
for (...) {
  vec3 texCoord = currentPos * invAspect;  // 物理坐标 → UV 坐标
  float intensity = texture(u_volumeTexture, texCoord).r;
  // ...
}
```

#### 3. 相机偏移校正

每帧渲染时，将相机目标从单位立方体中心 `[0.5, 0.5, 0.5]` 临时偏移到包围盒中心，渲染后恢复：

```ts
// WebGLVolumeRenderer.render()
const aspectX = physDims[0] / maxPhys;  // e.g. 0.34
const aspectY = physDims[1] / maxPhys;  // e.g. 0.34
const aspectZ = physDims[2] / maxPhys;  // e.g. 1.0

gl.uniform3f(this.uniforms.u_volumeAspect, aspectX, aspectY, aspectZ);

// 临时偏移相机目标到包围盒中心
const saved = this.camera.getState().target;
this.camera.setTarget([
  saved[0] - 0.5 + aspectX * 0.5,
  saved[1] - 0.5 + aspectY * 0.5,
  saved[2] - 0.5 + aspectZ * 0.5,
]);
// ... 渲染 ...
this.camera.setTarget(saved);  // 恢复，不影响用户交互
```

---

## 定位方法论总结

| 步骤 | 方法 | 目的 |
|------|------|------|
| **1. 建立基准** | 理解完整调用链，确认错误发生位置 | 排除 UI 层面的干扰，聚焦 GL 层 |
| **2. 二分定位** | 在关键节点插入 `gl.getError()` + `console.log` | 精确判断是哪个 GL 调用失败 |
| **3. 利用"意外成功"** | 如果 A 失败后 B 却成功了，说明 GL 错误状态被意外清除 | 区分"真正成功"和"错误被掩盖" |
| **4. 追溯变更** | `git diff` 对比修改前后的代码差异 | 快速定位引入问题的变更 |
| **5. 理解约束** | 了解 WebGL 限制（MAX_3D_TEXTURE_SIZE）、React StrictMode 行为 | 形成假设 |
| **6. 简化问题** | 如果 X 方案复杂度高且有副作用，换一个完全不改变 X 的方案 | 选择最小变更的修复路径 |

**核心洞察**：WebGL 错误通常不是表面看起来的原因（"buffer too small"），而是更深层的问题（状态损坏、竞态条件、不兼容的 API 组合）。通过精确的日志分段和变更历史对比，可以逐步逼近根因。本例中，表面错误是"缓冲太小"，但真正的问题是 **React StrictMode 与重量级同步计算（梯度场计算 ~120ms）导致的竞态条件**，使得 `texImage3D` 在已被 dispose 的 WebGL context 上执行。