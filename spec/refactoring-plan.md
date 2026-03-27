# 代码重构计划

基于全面代码 review 的优先级重构计划。

---

## 概述

当前代码库存在以下主要问题域：

1. **Critical Bug** — WebGL 资源泄漏、shader 除零、数据截断静默通过
2. **代码重复** — datatype 工具函数在 3 处重复实现
3. **渲染系统混乱** — Canvas 2D 和 WebGL2 两套并行实现
4. **NIfTI 解析不完整** — magic 验证、端序、NIfTI-2 偏移量缺失
5. **类型安全不足** — 枚举类型不一致、边界条件未处理
6. **UX 缺陷** — 加载失败静默、无 loading 状态
7. **测试空白** — renderer-2d 完全无测试覆盖

---

## Phase 0: Critical Bug 修复（不依赖其他阶段）✅ 已完成

### 0.1 WebGL Canvas 元素泄漏 ✅
`webgl-slice-view.ts:354` — `dispose()` 中增加 `this.canvas.remove()`。

### 0.2 Shader 除零崩溃 ✅
`webgl-slice-view.ts:317` — 上传 uniform 前加守卫 `Math.max(1, window)`。

### 0.3 数据截断静默通过 ✅
`parser.ts:165` — `extractImageData` 中先检查 `dataSize <= 0` 并抛出明确错误。

### 0.4 零尺寸容器无限 RAF 循环 ✅
`webgl-slice-view.ts:258-261` — 容器宽高为 0 时直接 return，不调度 RAF。

### 0.5 NIfTI-2 版本检测 bug（附带发现并修复）✅
`parser.ts:116-132` — NIfTI-2 sizeof_hdr 在 offset 4，需先读 offset 0 再读 offset 4。移除了 `buffer.byteLength >= 540` 错误回退逻辑。

**修改文件**:
- `packages/parser-nifti/src/parser.ts`
- `packages/renderer-2d/src/webgl-slice-view.ts`
- `tests/unit/error-handling.test.ts`（修复测试 helper 未初始化字段问题）

---

## Phase 1: 消除重复代码 + 统一渲染路径 ✅ 已完成

### 1.1 提取共享 Datatype 工具函数 ✅

在 `parser-nifti/src/utils.ts` 新增 `readVoxel()` 函数（参数顺序：`buffer, byteOffset, datatype`），并从 `parser-nifti` 的 `index.ts` 导出。`slice-extractor.ts` 移除本地重复实现，改为从 `@jsmedgl/parser-nifti` 导入 `getDataTypeSize` 和 `readVoxel`。`readVoxel` 覆盖所有 NIfTI datatype，含 `UNKNOWN`(0)、`BINARY`(1)、`RGB24`(128)、`RGBA32`(2304)、`INT64`/`UINT64` 等，缺失类型返回 `Uint8`。

### 1.2 废弃 Canvas 2D 渲染路径 ✅

由于 Demo app 不依赖 Canvas 2D 路径，直接删除以下未使用文件：
- `slice-view.ts`（完整 Canvas 2D 实现）
- `mpr-layout.ts`（API 名不副实的布局管理器）
- `texture-manager.ts`（不完整的 TextureManager API，无 dispose）

`renderer-2d/src/index.ts` 中对应的导出已全部移除。`index.ts` 精简为仅导出 `WebGLSliceView` + `SliceExtractor`（WebGL2 渲染路径）。

### 1.3 清理死代码 ✅

- `multiplyMatrix` 和 `transposeMatrix` 已删除，对应测试移为本地辅助函数（保留测试覆盖）
- `identityMatrix` 保留（`coordinate.ts` fallback 路径依赖）
- `texture-manager.ts` 整体删除（未使用）
- `mpr-layout.ts` 整体删除（未使用）
- `slice-view.ts` 整体删除（Canvas 2D 路径废弃）

**修改文件**:
- `packages/parser-nifti/src/utils.ts`（新增 `readVoxel`、删除 `multiplyMatrix`/`transposeMatrix`）
- `packages/parser-nifti/src/index.ts`（导出 `readVoxel`）
- `packages/renderer-2d/src/slice-extractor.ts`（移除本地 `getDataTypeSize`/`readVoxel`）
- `packages/renderer-2d/src/index.ts`（移除 Canvas 2D 导出，精简公共 API）
- `packages/renderer-2d/src/types.ts`（移除 `SliceView`/`TextureManager`/`MPRLayout`/`SliceViewOptions` 类型）
- `tests/unit/utils.test.ts`（删除对应测试，改为本地辅助函数）
- **删除**: `slice-view.ts`、`mpr-layout.ts`、`texture-manager.ts`

---

## Phase 2: NIfTI Parser 校验加固 ✅ 已完成

### 2.1 添加 Magic 字段验证 ✅

**问题**: `parseNiftiHeader` 不验证 magic 字段，任意 540 字节文件都能被当作 NIfTI 解析。

**修复**: 在 `parseNiftiHeaderFromBuffer` 中添加 `validateNifti1Magic` 和 `validateNifti2Magic` 函数：
- NIfTI-1: 验证 offsets 344-347 为 `"ni1\0"` 或 `"n+1\0"`
- NIfTI-2: 验证 offsets 4-11 为 `"ni2\0"` 或 `"n+2\0"`

无效时抛出 `Error('Invalid NIfTI-X magic field')`。

**修改文件**: `packages/parser-nifti/src/parser.ts`

### 2.2 修复 NIfTI-2 字段偏移量 ✅

**问题**: NIfTI-2 所有字段偏移量基于错误假设（误以为 sizeof_hdr 在 offset 4），`slice_start`/`slice_end` 读到了 `dim[1]`/`dim[2]`。

**修复**: 根据 [NIfTI-2 规范](https://brainder.org/2015/04/03/the-nifti-2-file-format/)重写 `parseNifti2Header`：
- `sizeof_hdr` at offset 0（值为 540）
- `datatype` at offset 12
- `dim[8]` at offset 16-79（int64）
- `pixdim[8]` at offset 104-167（float64）
- `slice_start` at offset 224（int64）
- `slice_end` at offset 232（int64）
- `qform_code` at offset 344（int32）
- `quatern_*` at offset 352-392（float64）
- `sform` matrix at offset 400-495（float64）

新增 `parseSformMatrix64` 函数用于解析 float64 格式的 sform 矩阵。

**修改文件**: `packages/parser-nifti/src/header-parser.ts`

### 2.3 添加端序（Endianness）处理 ⏭️ 跳过

**问题**: 大端 NIfTI 文件的所有字段和图像数据都需要字节交换。

**状态**: 跳过。大端格式在实践中罕见（绝大多数 NIfTI 文件为小端），如后续需要可复用已有的 `swapEndianness` 工具函数。

### 2.4 修复 `pixdim[2]` 和 `pixdim[3]` 未取绝对值 ✅

**问题**: 某些 NIfTI 文件的 pixdim[2] 或 pixdim[3] 为负值（镜像轴），导致 spacing 计算错误。

**修复**: 在以下位置统一对 pixdim[1-3] 取绝对值：
- `parser.ts`: `spacing` 提取
- `coordinate.ts`: `createFallbackMatrix` 和 `extractSpacing`

**修改文件**: `packages/parser-nifti/src/parser.ts`, `packages/parser-nifti/src/coordinate.ts`

### 2.5 Quaternion 归一化校验 ✅

**问题**: 如果 `quatern_b^2 + quatern_c^2 + quatern_d^2 > 1`（浮点精度误差），则 `a = sqrt(1 - ...)` 结果为 NaN。

**修复**: 在 `extractQform` 中检测 quaternion 模长平方 > 1 时进行归一化：
```typescript
const quatMagSq = qb * qb + qc * qc + qd * qd;
if (quatMagSq > 1) {
  const scale = 1 / Math.sqrt(quatMagSq);
  qb *= scale; qc *= scale; qd *= scale;
}
```

同时修复 `extractQform` 中 `sy`/`sz` 未取绝对值的问题。

**修改文件**: `packages/parser-nifti/src/coordinate.ts`

### 2.6 清理类型命名 ✅

**问题**: `NiftiHeader.sform_inv` 字段存储的是 forward transform（IJK → RAS），命名误导。

**修复**:
1. 将 `NiftiHeader.sform_inv` 重命名为 `NiftiHeader.sform`
2. 更新 `header-parser.ts` 中所有赋值
3. 更新 `coordinate.ts` 中注释和引用
4. 更新 `core/src/types.ts` 中的类型定义
5. 更新所有测试文件中的引用

**修改文件**: `packages/parser-nifti/src/types.ts`, `packages/parser-nifti/src/header-parser.ts`, `packages/parser-nifti/src/coordinate.ts`, `packages/core/src/types.ts`, `tests/unit/nifti2.test.ts`, `tests/unit/parser.test.ts`

---

## Phase 3: 类型安全与边界处理 ✅ 全部完成

### 3.1 修复零尺寸除零 ✅

**问题**: `byteSize === 0`（如 `BINARY`/`UNKNOWN` datatype）导致 `numVoxels = Infinity`，normalization 循环永不执行，结果全 NaN。

**修复**: 在 `normalizeVolumeData` 入口加守卫：
```typescript
if (byteSize === 0) {
  throw new Error(`Unsupported datatype for rendering: ${datatype} (byteSize=0)`);
}
```

**修改文件**: `packages/renderer-2d/src/slice-extractor.ts`

### 3.2 修复零尺寸容器无限 RAF ✅

**问题**: 容器宽高为 0 时每帧调度 render，永不停止。

**状态**: Phase 0 已修复。`webgl-slice-view.ts:258` 已有检查。

### 3.3 统一 `datatype` 类型使用 ✅

**问题**: `core` 和 `parser-nifti` 各自维护 `NiftiDataType` 枚举，内容不一致。

**修复**:
1. `core/src/types.ts` 从 `@jsmedgl/parser-nifti` 导入 `NiftiDataType` 和 `NiftiXform`
2. 移除 `core/tsconfig.json` 中的 `rootDir` 限制，允许跨包 import
3. 消除重复定义，统一为 parser-nifti 的完整 16 种 datatype

**修改文件**: `packages/core/src/types.ts`, `packages/core/tsconfig.json`

### 3.4 4D 数据检测与提示 ✅

**问题**: `dimensions` 只取前 3 维，`dim[4]`（如 fMRI 时间轴）被静默丢弃。

**修复**: 不完全支持 4D，但检测并给出警告：
1. 在 `parseNifti` 中检测 `dim[0] >= 4 && dim[4] > 1`
2. 添加 `console.warn` 提示用户 4D 数据不支持
3. 在 `NiftiVolume` 类型中新增可选 `warnings?: string[]` 字段

**修改文件**: `packages/parser-nifti/src/parser.ts`, `packages/parser-nifti/src/types.ts`, `packages/core/src/types.ts`

---

## Phase 4: React/Demo 交互改进

### 4.1 修复 Demo 加载失败静默 ✅

**问题**: `fetch` 和 `parseNifti` 的错误被 `.catch(() => {})` 完全吞掉。

**修复**:
1. Demo 文件 fetch 错误时用 `console.error` 打印并设置 `loadError` 提示用户手动加载
2. `loadVolume` 增加了 `setIsLoading` 状态管理
3. 添加了 `LoadingSpinner` 组件，loading 期间在 viewer area 显示旋转动画

**修改文件**: `apps/demo/src/App.tsx`, `apps/demo/src/styles.css`

### 4.2 添加加载状态指示器 ✅

**问题**: 加载 117MB 文件时无任何进度反馈，UI 看起来像冻结。

**修复**: 在 `App.tsx` 中添加 `isLoading` state，在 `loadVolume` 和 demo fetch 期间设为 `true`，渲染时在 viewer area 显示 spinner。

### 4.3 改进 Resize Handler

**问题**: resize handler 闭包捕获的 `crosshair` 值可能在注册后过时。

**修复**: 在 resize effect 中同时监听 `crosshair` 变化，或将 crosshair position 作为参数传入而非从闭包读取。

### 4.4 修复十字线圆点颜色 ✅

**问题**: 圆点使用垂直轴颜色（sagittal 色），应该用自身 orientation 颜色或白色区分。

**修复**: 圆点改用 `ORIENTATION_COLORS[orientation]`（即 axial=蓝、coronal=绿、sagittal=橙）。

**修改文件**: `apps/demo/src/App.tsx`

### 4.5 侧边栏响应式 ✅

**问题**: 固定 `width: 260px`，窄屏下溢出。

**修复**: 添加 `@media (max-width: 768px)` 媒体查询，窄屏下侧边栏宽度改为 `200px`。

**修改文件**: `apps/demo/src/styles.css`

### 4.6 改进 ESLint 抑制注释

**问题**: `eslint-disable-line react-hooks/exhaustive-deps` 抑制了潜在问题。

**修复**: 改为带说明的注释，解释为什么每个 dep 被有意排除：
```typescript
}, [
  volume,
  orientation,
  // windowLevel 在单独的 useEffect 中处理，避免重建 WebGL 上下文
  // crosshair 变化通过 RAF throttle effect 单独响应，不触发重建
]); // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
```

---

## Phase 5: 测试覆盖

### 5.1 Renderer-2d 单元测试

**当前状态**: 零测试覆盖。

**新增测试文件**: `tests/unit/renderer-2d/`

需覆盖：
- [ ] `slice-extractor.ts`: swizzle 维度变换（axial/coronal/sagittal 各方向正确性）
- [ ] `slice-extractor.ts`: 归一化逻辑（min/max 计算、边界值）
- [ ] `slice-extractor.ts`: 纹理缓存驱逐
- [ ] `webgl-slice-view.ts`: `mouseToIJK()` 坐标转换（各 orientation）
- [ ] `webgl-slice-view.ts`: `getDisplayRect()` 宽高比保持
- [ ] `webgl-slice-view.ts`: `setWindowLevel()` shader uniform 更新
- [ ] 边界条件：`windowWidth === 0`、`dimensions 含 0`、越界 `mouseToIJK`
- [ ] `TextureManager`: 数据类型处理（RGB24, INT16, FLOAT32 等）

### 5.2 坐标转换单元测试

需覆盖：
- [ ] `ijkToRas` / `rasToIjk` / `rasToLps` / `lpsToRas` 往返一致性
- [ ] 实际 affine 矩阵（非手工输入）的往返验证
- [ ] 负 spacing / 镜像轴处理
- [ ] quaternion 归一化边界（quatMagSq > 1）

### 5.3 React 组件测试

需覆盖：
- [ ] 文件加载流程（fetch → parse → 渲染）
- [ ] 拖拽 crosshair 后三个视图同步
- [ ] `handleWheel` 滚动切片
- [ ] Window/Level 拖拽
- [ ] MPR 模式切换

### 5.4 清理无效测试断言

| 文件 | 问题 |
|------|------|
| `real-files.test.ts:95-101` | 只检查 `affine[15]`，应验证完整矩阵有效性 |
| `real-files.test.ts:187` | `qform_code + sform_code >= 0` 恒为真，应 `> 0` |
| `real-files.test.ts:96-101` | `isIdentity` 计算后未断言 |
| `error-handling.test.ts:127-140` | 截断 buffer 测试无有效性断言 |

---

## Phase 6: Oblique MPR 重构

详见 [oblique-mpr-plan.md](./oblique-mpr-plan.md)，实现前应完成 Phase 1-5 以确保稳定基础。

---

## 执行顺序与依赖关系

```
Phase 0 (Critical Bug)          ← 独立，无依赖，最先做
    ↓
Phase 1 (消除重复 + 统一路径)    ← 依赖 Phase 0 完成的共享 datatype 函数
    ↓
Phase 2 (Parser 校验加固)        ← 独立，可与 Phase 1 并行
    ↓
Phase 3 (类型安全)               ← 依赖 Phase 1 的共享类型
    ↓
Phase 4 (React/Demo 改进)       ← 独立，可与 Phase 2/3 并行
    ↓
Phase 5 (测试覆盖)               ← 依赖 Phase 1-4，为后续重构提供安全网
    ↓
Phase 6 (Oblique MPR)           ← 依赖 Phase 5 完成
```

---

## 附录: 问题清单汇总

| ID | 优先级 | 问题 | 阶段 |
|----|--------|------|------|
| R-01 | Critical | Canvas DOM 节点泄漏 | Phase 0 |
| R-02 | Critical | Shader windowWidth=0 除零 | Phase 0 |
| R-03 | Critical | 数据截断静默通过 | Phase 0 |
| R-04 | High | datatype 工具 3 处重复 | Phase 1 |
| R-05 | High | Canvas 2D 路径废弃 | Phase 1 |
| R-06 | High | 死代码清理 | Phase 1 |
| R-07 | High | NIfTI-2 字段偏移量错误 | Phase 2 | ✅ 已完成 |
| R-08 | High | 无 magic 字段验证 | Phase 2 | ✅ 已完成 |
| R-09 | High | 大端文件未处理 | Phase 2 | ⏭️ 跳过 |
| R-10 | High | pixdim[2/3] 未取绝对值 | Phase 2 | ✅ 已完成 |
| R-11 | High | sform_inv 命名混乱 | Phase 2 | ✅ 已完成 |
| R-12 | Medium | loadImageData 选项未实现 | Phase 1 |
| R-13 | Medium | TextureManager 无 dispose | Phase 1 |
| R-14 | Medium | zero-size 容器无限 RAF | Phase 3 | ✅ 已完成 |
| R-15 | Medium | 4D dimensions 丢失第 4 维 | Phase 3 | ✅ 已完成（检测+警告） |
| R-16 | Medium | Demo 加载失败静默 | Phase 4 | ✅ 已完成 |
| R-17 | Medium | 无加载状态指示器 | Phase 4 | ✅ 已完成 |
| R-18 | Medium | Resize handler 闭包陷阱 | Phase 4 |
| R-19 | Low | 十字线圆点颜色错误 | Phase 4 | ✅ 已完成 |
| R-20 | Low | 侧边栏无响应式 | Phase 4 | ✅ 已完成 |
| R-21 | Low | 坐标系注释与实现不符 | Phase 3 |
| R-22 | Low | quaternion 归一化未校验 | Phase 2 | ✅ 已完成 |
| R-23 | Low | 弱测试断言 | Phase 5 |
| R-24 | Low | Renderer 无测试覆盖 | Phase 5 |
