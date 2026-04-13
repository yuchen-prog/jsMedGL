# jsMedgl 包结构重构规范

> **版本：** v0.1
> **作者：** 研发团队
> **日期：** 2026-04-13
> **状态：** 待评审

---

## 1. 背景与问题

当前包结构存在以下问题：

### 1.1 core 包职责混乱

- `@jsmedgl/core` 仅包含占位代码（`createVolumeViewer` 空实现），却依赖 `three.js`、`zustand` 等
- 实际渲染逻辑全部在 renderer 包中，core 与渲染层无真实关联
- 存在冗余依赖：`renderer-2d` 的 `package.json` 中 `@jsmedgl/parser-nifti` 重复声明了两次

### 1.2 共享逻辑分散

以下逻辑在多个包中重复实现或位置不当：

| 共享逻辑 | 当前实现位置 | 问题 |
|:---|:---|:---|
| 坐标系转换（IJK/RAS/LPS） | `parser-nifti` | parser 负责解析，转换是业务逻辑，不应放在此 |
| 窗宽窗位计算、预设 | renderer-2d 内嵌 | renderer-3d 重复实现 |
| 颜色映射表（grayscale/hot/viridis...） | renderer-2d | renderer-3d 未共享 |
| Zustand Store（ViewerState） | 未统一管理 | 各 renderer 独立状态 |
| 坐标系验证工具 | `parser-nifti` | 应归属 core |
| 三视图 Crosshair 联动状态 | renderer-2d | renderer-3d 未共享 |
| 坐标系验证工具 | `parser-nifti` | 应归属 core |

### 1.3 依赖关系与 PRD 不符

CLAUDE.md 中声明 `core → renderer-2d → parser-nifti`，但实际：

- renderer-2d 直接依赖 parser-nifti，不经过 core
- renderer-3d 完全独立于 core 和 renderer-2d 之外
- core 的三个依赖（three.js、zustand、）仅被 types 使用，实际未发挥价值

---

## 2. 重构原则

### 2.1 依赖方向（自底向上）

```
parser-nifti   （数据解析层）
      ↓
core            （共享逻辑 + 状态管理）
      ↓
renderer-2d    （2D 切片渲染）
renderer-3d    （3D 体渲染）
      ↓
react / vue    （框架适配器）
```

### 2.2 core 不做渲染抽象

core **不定义渲染接口**，不依赖 renderers。原因：

- renderer-2d 和 renderer-3d 是两个独立的渲染器，当前无共享抽象
- WebGL → WebGPU 迁移时，只改对应 renderer 包，不影响 core
- 状态共享通过 Zustand store 和纯函数实现，不通过渲染接口

### 2.3 单一职责

每个包职责明确，无重叠：

- **parser-nifti**：仅负责 NIfTI 文件解析和原始数据输出
- **core**：共享工具、状态管理、统一类型导出
- **renderer-2d/3d**：各自渲染逻辑，依赖 core 获取共享工具
- **react/vue**：框架适配器，最高层

---

## 3. 包职责重新定义

### 3.1 @jsmedgl/parser-nifti（不变）

> 数据解析层，仅负责将 NIfTI 文件解码为原始 header/data/ArrayBuffer。不含业务逻辑。

**保留内容：**
- NIfTI 文件解析（.nii / .nii.gz）
- Header 字段提取
- 原始 ArrayBuffer 数据输出

**移出内容：**
- 坐标系转换（IJK/RAS/LPS）→ 移入 core
- 坐标系验证工具（validateOrientation）→ 移入 core
- 颜色映射表 → 移入 core

### 3.2 @jsmedgl/core（重构重点）

> 共享逻辑层，包含工具函数、状态管理、统一类型和 API 门面。

**新增内容：**

#### 3.2.1 坐标系工具（从 parser-nifti 迁入）

- `ijkToRas(volume, i, j, k)` → `Vec3`
- `rasToIjk(volume, x, y, z)` → `[number, number, number]`
- `rasToLps(vec)` → `Vec3`
- `lpsToRas(vec)` → `Vec3`
- `getAxisCodes(affine)` → `[AxisCode, AxisCode, AxisCode]`
- `validateOrientation(volume)` → `OrientationReport`
- `computeSpacing(pixdim)` → `[number, number, number]`

#### 3.2.2 窗宽窗位工具（从 renderer-2d 迁入）

- `applyWindowLevel(value, window, level)` → `number`（0-255 归一化）
- `computeAutoWindowLevel(data, method?)` → `{ window, level }`
- `DEFAULT_WINDOW_PRESETS` 常量数组
- `PRESET_BRAIN / PRESET_BONE / PRESET_LUNG / PRESET_SOFT_TISSUE`

#### 3.2.3 颜色映射表（从 renderer-2d 迁入）

- `COLORMAPS` 映射对象（grayscale, hot, cool, spring, summer, autumn, winter, jet, viridis, inferno, plasma）
- `getColormap(name: ColormapName)` → `Uint8Array`（RGBA 预计算）
- `interpolateColormap(colors, steps)` → `Float32Array`

#### 3.2.4 Zustand Store（共享实例 + 选择器订阅）

使用单个 store 实例，通过 Zustand 的 `subscribeWithSelector` 中间件实现精确订阅。

**共享字段（放入 store）：**

| 字段 | 类型 | 说明 |
|:---|:---|:---|
| `windowLevel` | `WindowLevel` | 窗宽窗位，2D/3D 联动 |
| `slices` | `SlicePosition` | 当前切片索引，crosshair 联动 |
| `volume` | `NiftiVolume \| null` | 当前加载的体积数据 |
| `activeOverlays` | `Overlay[]` | 叠加层列表 |
| `layout` | `LayoutType` | 布局模式 |
| `crosshairVisible` | `boolean` | crosshair 显示开关 |
| `colorbarVisible` | `boolean` | 颜色条显示开关 |

**私有字段（不放 store，留在 renderer 内部管理）：**

| 所属包 | 私有状态 | 原因 |
|:---|:---|:---|
| renderer-2d | WebGL context、纹理 ID、shader program | GPU 资源，生命周期不同 |
| renderer-2d | crosshair 像素坐标 | 仅 2D 视图关心的 UI 状态 |
| renderer-3d | WebGL context、纹理 ID、shader program | GPU 资源，生命周期不同 |
| renderer-3d | 相机旋转/缩放角度 | 仅 3D 视图关心的 UI 状态 |
| renderer-3d | render quality / LOD | 仅 3D 渲染相关 |

**订阅方式示例：**

```typescript
// renderer-2d 只订阅 slices — windowLevel 变化不触发
const slices = useViewerStore(
  (state) => state.slices,
  (a, b) => a.axial === b.axial && a.coronal === b.coronal && a.sagittal === b.sagittal
);

// renderer-3d 只订阅 windowLevel + volume — slices 变化不触发
const wl = useViewerStore(
  (state) => ({ windowLevel: state.windowLevel, volume: state.volume })
);
```

#### 3.2.5 EventEmitter（跨 renderer 通信中枢）

renderer 之间不直接依赖，通过 core 的 EventEmitter 模块中转：

```
renderer-2d  ──emit('sliceChange')──►  core EventEmitter  ──subscribe──►  renderer-3d
renderer-3d  ──emit('cameraRotate')──► core EventEmitter  ──subscribe──►  renderer-2d
```

**核心 API：**

```typescript
// core/src/events.ts
interface EventEmitter {
  on(event: string, callback: (...args: any[]) => void): void;
  off(event: string, callback: (...args: any[]) => void): void;
  emit(event: string, ...args: any[]): void;
}

function createEventEmitter(): EventEmitter;
```

**设计理由：**
- renderer-2d 不需要知道 renderer-3d 存在
- 未来加 renderer-webgpu 不需要改现有代码，只管订阅事件
- 支持一对多（一个 sliceChange 同时通知 3D + 颜色条 + 坐标显示）

#### 3.2.6 统一类型导出

- 导出所有共享类型（NiftiVolume, WindowLevel, SlicePosition, CameraState, Axis, LayoutType, AxisCode, OrientationReport, WindowPreset, ColormapName, RenderStats 等）
- 移除 `three.js` 依赖

#### 3.2.7 createVolumeViewer API 门面

`createVolumeViewer()` 实现在 core 中，作为统一入口。内部组合 renderer-2d 和 renderer-3d，对外暴露 `VolumeViewer` 接口。

**移除内容：**
- `three.js` 依赖（完全移除）
- `` 依赖（改用 renderer 内部管理）

### 3.3 @jsmedgl/renderer-2d（调整依赖）

**变化：**
- 依赖 core（获取共享工具）
- 依赖 parser-nifti（数据来源）
- 移除内嵌的窗宽窗位逻辑、颜色映射表（改从 core 导入）
- 移除 package.json 中重复的 parser-nifti 依赖声明

### 3.4 @jsmedgl/renderer-3d（调整依赖）

**变化：**
- 依赖 core（获取共享工具）
- 依赖 parser-nifti（数据来源）
- 移除内嵌的颜色映射表（改从 core 导入）

---

## 4. 目标包依赖图

```
@jsmedgl/parser-nifti
    │
    └──► @jsmedgl/core
              │
              ├──► @jsmedgl/renderer-2d
              └──► @jsmedgl/renderer-3d
                        │
                        └──► @jsmedgl/react
```

**最终依赖矩阵：**

| 包 | parser-nifti | core | renderer-2d | renderer-3d |
|:---|:---:|:---:|:---:|:---:|
| parser-nifti | — | | | |
| core | ✅ | — | | |
| renderer-2d | ✅ | ✅ | — | |
| renderer-3d | ✅ | ✅ | — | — |
| react | — | ✅ | ✅ | ✅ |

---

## 5. 实施步骤

### Phase 1: 清理 core（无依赖风险）

1. 从 core 中移除 `three.js` 依赖及相关代码
2. 重写 `createVolumeViewer` 为真实实现（��合 renderer-2d + renderer-3d）
3. 删除 core 的 `package.json` 中 `three` 和 `@types/three` 依赖

### Phase 2: 迁移共享逻辑到 core（低风险）

1. 将坐标系转换工具从 `parser-nifti` 迁入 `core/src/coordinate.ts`
2. 将窗宽窗位工具从 `renderer-2d` 迁入 `core/src/window-level.ts`
3. 将颜色映射表从 `renderer-2d` 迁入 `core/src/colormaps.ts`
4. 创建 Zustand store 模块 `core/src/store/viewerStore.ts`
5. 创建 EventEmitter 模块 `core/src/events.ts`（实现 `on/off/emit`，作为跨 renderer 通信中枢）
6. 在 core 的 `index.ts` 中统一导出所有类型和工具

### Phase 3: 更新 renderer 依赖（需验证）

1. 更新 `renderer-2d` 的 `package.json`：
   - 添加 `core` workspace 依赖
   - 移除重复的 `parser-nifti` 声明
2. 更新 `renderer-2d` 源码：将内嵌工具替换为从 core 导入
3. 将 `renderer-2d` 中现有的直接调用 renderer-3d 的逻辑（如有）替换为通过 core EventEmitter 发布事件
4. 更新 `renderer-3d` 的 `package.json`：
   - 添加 `core` workspace 依赖
5. 更新 `renderer-3d` 源码：将内嵌颜色映射替换为从 core 导入
6. 将 `renderer-3d` 中现有的直接调用 renderer-2d 的逻辑（如有）替换为通过 core EventEmitter 发布事件

### Phase 4: 验证与测试

1. `pnpm build` 全量构建通过
2. `pnpm typecheck` 无错误
3. `pnpm test` 全部通过
4. Demo app 正常运行

---

## 6. 已确认决策

| # | 问题 | 决策 | 理由 |
|:---|:---|:---|:---|
| 1 | `createVolumeViewer` API 门面放哪里？ | **core**（统一入口） | 作为引擎唯一对外 API，内部组合 2D + 3D renderer |
| 2 | Zustand store 是否需要跨包共享实例？ | **共享一个 store 实例** | 2D 调窗宽窗位、3D 要立刻反映；通过 `subscribeWithSelector` 精确订阅，GPU 资源等私有状态留在 renderer 内部 |
| 3 | renderer-2d 和 renderer-3d 交叉通信方式？ | **core EventEmitter 事件发布/订阅** | renderer 之间不直接依赖，未来加 renderer-webgpu 不改现有代码；支持一对多通知 |

---

*本规范随开发进展持续更新。*
