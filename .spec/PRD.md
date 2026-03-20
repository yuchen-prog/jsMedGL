# jsMedgl — Web 医学影像渲染库 PRD

> **版本：** v1.0（初稿）
> **作者：** 产品/研发团队
> **日期：** 2026-03-19
> **状态：** 待评审

---

## 1. 产品愿景与定位

### 1.1 产品一句话描述

jsMedgl 是一个面向 Web 的零安装、诊断级医学影像渲染库，使开发者能在浏览器中嵌入专业级 NIfTI/DICOM 影像可视化能力，对标 NiiVue，定位高于 MRIcroWeb，最终扩展至 CT/MRI/PET 多模态覆盖。

### 1.2 核心价值主张

| 维度 | 现状（竞品痛点） | jsMedgl 解决方案 |
|:---|:---|:---|
| 空间定向 | MRIcroWeb 忽略 sform/qform，方向可能镜像反转 | 完整解析 NIfTI sform/qform 与 DICOM Orientation， LPS/RAS/IJK 互转 |
| 部署门槛 | NiiVue 功能全但绑定特定框架 | 全框架无关（React/Vue/Angular/原生 HTML 即插即用） |
| 性能天花板 | WebGL 同步状态机遇大规模体数据瓶颈 | WebGPU 计算着色器 + 多线程命令提交，支撑亿级体素 |
| 多模态 | 仅单一体积渲染，无叠加 | 支持多体积叠加（Overlay）+ 网格曲面 + 纤维追踪 |

### 1.3 目标用户分层

- **Tier 1 — 开发者集成方**：将 jsMedgl 嵌入自己的 Web 应用（科研平台、远程会诊、AI 标注工具）
- **Tier 2 — 科研终端用户**：直接使用基于 jsMedgl 构建的网页工具查看 NIfTI/DICOM 数据
- **Tier 3 — 临床试用用户**：使用 jsMedgl 构建的 viewer 进行影像初筛（未来版本）

### 1.4 对标竞品

| 竞品 | 优点 | 缺陷（jsMedgl 切入机会） |
|:---|:---|:---|
| **NiiVue** | 生态最完整，FSL/AFNI/FreeSurfer 全集成 | 框架绑定较重，部分 3D 性能受限 |
| **MRIcroWeb** | 极简 Demo 体积渲染 | 忽略空间定向、无 Overlay、无 MIP |
| **AMI (FNNDSC)** | DICOM 原生支持 | 体积渲染能力弱，文档欠完善 |
| **vtk-js** | 工业级功能 | 包体积过大，API 复杂，不适合轻量嵌入 |

---

## 2. 技术架构总览

### 2.1 技术栈选型

```
┌─────────────────────────────────────────────────────────┐
│                    应用层 / 用户 Demo                    │
├─────────────────────────────────────────────────────────┤
│              组件封装层（Framework Adapters）             │
│          React / Vue / Angular / Vanilla JS             │
├─────────────────────────────────────────────────────────┤
│                    核心渲染引擎                          │
│              @jsmedgl/core（引擎主体）                    │
├────────────────┬────────────────────┬───────────────────┤
│  影像解析模块    │    WebGPU 渲染管线   │    状态管理层     │
│ @jsmedgl/parser│ @jsmedgl/renderer  │ @jsmedgl/store    │
│ - NIfTI 解码   │ - 2D MPR 切片渲染   │ - Zustand        │
│ - DICOM 解析   │ - 3D 体绘制 (Raycast)│ - 切面索引       │
│ - itk-wasm     │ - MIP 投影         │ - 窗宽窗位       │
│ - Zarr 流式    │ - 光照梯度计算      │ - 旋转矩阵       │
├────────────────┴────────────────────┴───────────────────┤
│                    数据层                                │
│      File API / Fetch + Range / DICOMweb (WADO-RS)      │
└─────────────────────────────────────────────────────────┘
```

### 2.2 包结构

```
@jsmedgl/core          — 引擎核心，含渲染器、坐标系统、状态
@jsmedgl/parser-nifti  — NIfTI 文件解析（单包，便于 tree-shaking）
@jsmedgl/parser-dicom  — DICOM 解析（未来版本）
@jsmedgl/loader-zarr   — Zarr 云端流式加载（Phase 3+）
@jsmedgl/plugin-drawing — 标注绘图插件（Phase 3+）
@jsmedgl/plugin-mesh   — 网格/纤维追踪插件（Phase 3+）
@jsmedgl/react         — React 适配器
@jsmedgl/vue           — Vue 3 适配器
```

### 2.3 坐标系统处理策略

必须严格遵循 research.md 中的 LPS/RAS/IJK 规范：

- **DICOM 输入** → 标准 LPS（Left, Posterior, Superior）
- **NIfTI 输入** → RAS（Right, Anterior, Superior），需反转前两轴
- **内部运算** → 统一在物理空间（Physical Space）进行，IJK 仅用于纹理采样
- **仿射变换**：`physical = A × [i, j, k]ᵀ + t`，A 含间距与方向信息

---

## 3. 功能规划与版本路线图

```
v0.1(MVP) ────────────────────────────────────────────► v1.0(正式版) ──────────► v2.0(增强版)
  基础体渲染    多平面重建      插件体系      WebGPU 迁移
```

---

## 4. MVP 版本（v0.1）— 基础体渲染引擎

### 4.1 目标

实现最小可用的 NIfTI 体渲染库，支持基本交互，**直接超越 MRIcroWeb**（修复其忽略 sform/qform 的核心缺陷）。

### 4.2 功能列表

#### 4.2.1 NIfTI 文件解析

| 功能点 | 验收标准 |
|:---|:---|
| 解析 NIfTI-1/NIfTI-2（.nii / .nii.gz） | 成功解析标准格式，文件 MD5 校验一致 |
| 解析完整 Header | dims, pixdim, qform_code, sform_code, affine 矩阵 |
| sform/qform 矩阵解析 | 正确还原物理空间方向；视觉方向与 MRIcroGL 一致 |
| 各向异性体素处理 | 1mm×1mm×2mm 体数据渲染无几何畸变 |
| DataType 支持 | uint8, int16, float32（覆盖 95% 常见数据） |

#### 4.2.2 基础 2D 切片渲染（单视图）

| 功能点 | 验收标准 |
|:---|:---|
| 轴状位（Axial）切片显示 | Y 轴向下为默认方向，符合临床习惯 |
| 冠状位（Coronal）切片显示 | 视角正确对应人体解剖 |
| 矢状位（Sagittal）切片显示 | 左右方向正确（非镜像） |
| 交叉定位线（Crosshair） | 三平面相交处显示高亮十字线 |
| 切面滑动交互 | 鼠标滚轮 / 拖拽实时切换切片，≥ 30 FPS |
| 颜色条（Colorbar） | 右侧显示当前窗宽窗位对应的颜色映射条 |
| 方向标签 | 每帧左上角显示 "R/L/A/P/S/I" 方向标识 |

#### 4.2.3 窗宽窗位（Window/Level）控制

| 功能点 | 验收标准 |
|:---|:---|
| 预设窗位 | 脑窗（WL:40/WW:80）、骨窗、肺窗、软组织窗一键切换 |
| 鼠标拖拽调节 | 按住左键拖拽：左右=窗宽，上下=窗位，平滑无跳跃 |
| 数字输入框 | 支持直接输入数值精确设定 |
| 自动适应（Auto Window） | 基于体数据直方图自动计算最佳窗宽窗位 |
| 键盘快捷键 | `1-5` 切换预设，`←→↑↓` 微调窗宽窗位 |

#### 4.2.4 体绘制（3D Volume Rendering）

| 功能点 | 验收标准 |
|:---|
| 正交三视图联动 | 3D 视图与 2D 切面 Crosshair 同步 |
| 体绘制模式 | 基于 Raycasting 的半透明体渲染 |
| 梯度光照 | 基于体素强度梯度计算法线，Phong 光照 |
| 3D 旋转/缩放/平移 | 鼠标左键旋转，右键平移，滚轮缩放 |
| 背向剔除（Backface Culling） | 仅渲染从相机可见方向进入的体素 |

#### 4.2.5 坐标系验证工具

| 功能点 | 验收标准 |
|:---|:---|
| 方向一致性报告 | 加载 NIfTI 后输出坐标系统诊断（RAS/LPS/axcodes） |
| 像素间距显示 | 显示当前体素的物理间距（mm） |

---

## 5. v1.0 版本 — 多模态与完整功能集

### 5.1 功能列表

#### 5.1.1 多平面重建（MPR）增强

| 功能点 | 验收标准 |
|:---|:---|
| 任意角度斜位切面 | 用户可自定义旋转角度，实时重建斜位 MPR |
| 斜位切面 Crosshair 联动 | 斜位切面上的 Crosshair 正确投影到其他两个正交切面 |
| 双斜位（Double Oblique） | 支持同时在两个轴向上倾斜的切面 |

#### 5.1.2 多体积叠加（Overlay）

| 功能点 | 验收标准 |
|:---|:---|
| 叠加第二个 NIfTI 卷 | 两个体积在同一坐标系下正确叠加 |
| 独立窗宽窗位 | 每个叠加层有独立的 W/L 控制 |
| 透明度控制 | 滑块控制叠加层整体不透明度（0-100%） |
| 叠加颜色映射 | 叠加层支持红/绿/蓝/黄等专用颜色映射 |
| 图层管理面板 | 显示已加载图层列表，支持显示/隐藏切换 |

#### 5.1.3 最大强度投影（MIP）

| 功能点 | 验收标准 |
|:---|:---|
| MIP 模式 | 视线方向取最大密度投影，替代体绘制 |
| 实时 MIP 切换 | 可在体绘制与 MIP 之间一键切换 |
| 自动 MIP 阈值 | 根据数据直方图自动设置有效信号阈值 |

#### 5.1.4 帧序列动画播放

| 功能点 | 验收标准 |
|:---|:---|
| 4D NIfTI 支持 | 解析 4D NIfTI（第 4 维为时间/状态） |
| 时间序列播放 | 播放/暂停/速率控制（0.1x ~ 5x） |
| 时间轴滑轨 | 拖拽滑块精确定位帧 |
| 帧间插值 | 线性插值使播放更平滑 |

#### 5.1.5 场景快照与导出

| 功能点 | 验收标准 |
|:---|:---|
| PNG 导出 | 2D/3D 视图导出为 PNG |
| 完整报告截图 | 将当前所有可见视图合并为单张图像 |
| JSON 状态导出 | 导出当前窗宽窗位、切片位置等状态，供回放 |

#### 5.1.6 多格式支持

| 格式 | 支持阶段 |
|:---|:---|
| NIfTI (.nii, .nii.gz) | MVP |
| NRRD (.nrrd, .nhdr) | v1.0 |
| MGH/MGZ (FreeSurfer) | v1.0 |
| AFNI HEAD/BRIK | v1.0 |
| MHD/RAW | v1.0 |

---

## 6. v2.0 版本 — 插件生态与 WebGPU

### 6.1 功能列表

#### 6.1.1 DICOM 支持

| 功能点 | 验收标准 |
|:---|:---|
| DICOM 解析 | 解析标准 CT/MRI DICOM 文件（CT/MRI 常见 Transfer Syntax） |
| DICOMweb 集成 | 支持 WADO-RS 从远程服务器拉取帧 |
| 多序列管理 | 一个 DICOM Study 下的多个序列完整加载 |
| 病人/检查信息展示 | 展示 PatientName、StudyDate、Modality 等基本信息 |

#### 6.1.2 WebGPU 渲染管线迁移

| 功能点 | 验收标准 |
|:---|:---|
| WebGPU 计算着色器 | 体绘制核心计算迁移至 WGSL compute shader |
| GPU 降噪算法 | Compute shader 实现非局部均值降噪（NLM） |
| 深度学习推理绑定 | 可加载 ONNX 模型在 GPU 端推理分割（插件扩展点） |
| 多线程渲染 | Web Worker 提交渲染命令，主线程不阻塞 |
| WebGL 降级 | 不支持 WebGPU 的浏览器自动降级至 WebGL2 |

#### 6.1.3 插件系统

| 功能点 | 验收标准 |
|:---|:---|
| Hook 体系 | 提供 `onVolumeLoaded` / `onSliceChange` / `onRenderFrame` 等钩子 |
| 插件注册 API | `jsMedgl.use(plugin)` 一行代码注册 |
| 官方插件包 | @jsmedgl/plugin-drawing / @jsmedgl/plugin-mesh 独立发布 |
| 第三方插件沙箱 | 插件间命名空间隔离，避免冲突 |

#### 6.1.4 网格与曲面支持

| 功能点 | 验收标准 |
|:---|:---|
| GIfTI 曲面加载 | 加载大脑皮层网格（.gii） |
| FreeSurfer 格式 | 加载 .pial / .white / .inflated 等曲面 |
| OBJ/STL 导入 | 通用 3D 网格文件导入 |
| 网格叠加渲染 | 将网格叠加在体积上方，支持颜色映射 |
| 体积到网格转换 |  marching cubes 等值面提取（ITK-Wasm） |

#### 6.1.5 标注与绘图工具

| 功能点 | 验收标准 |
|:---|:---|
| 笔刷工具 | 圆形/方形笔刷，在当前切片上绘制 ROI |
| 橡皮擦 | 擦除已绘制的标注 |
| Grow Cut 辅助分割 | 用户设置少量种子点，算法自动扩展至组织边界 |
| ROI 统计 | 实时显示 ROI 内体素数、体积（mm³）、平均强度、SD |
| 标注导入/导出 | 绘制结果保存为新 NIfTI（掩码格式） |

#### 6.1.6 纤维追踪可视化

| 功能点 | 验收标准 |
|:---|:---|
| TRK/TCK 格式加载 | 加载纤维追踪结果文件 |
| 纤维束颜色映射 | 按 FA 值或长度着色 |
| 纤维束筛选 | 按束名称或阈值筛选显示 |
| 纤维与体积叠加 | 纤维追踪结果叠加在体积上方 |

#### 6.1.7 云端流式加载

| 功能点 | 验收标准 |
|:---|:---|
| Zarr 格式支持 | 渐进式加载超大体积（> 4GB） |
| 多尺度金字塔 | 缩放时自动切换分辨率层级，响应时间 < 500ms |
| HTTP Range 请求 | 仅请求当前视图可见的体素块 |
| IndexedDB 缓存 | 已加载块缓存至本地，重复访问秒开 |

---

## 7. 插件生态规划（v2.0+）

| 插件名称 | 功能描述 | 目标用户 |
|:---|:---|:---|
| @jsmedgl/plugin-drawing | ROI 标注、Grow Cut 分割 | 标注工程师、AI 训练数据准备 |
| @jsmedgl/plugin-mesh | 皮层曲面、纤维追踪可视化 | 神经科学研究人员 |
| @jsmedgl/plugin-stats | ROI 统计面板、体积测量报告 | 临床报告生成 |
| @jsmedgl/plugin-dicomweb | DICOMweb 远程服务连接 | 医院 PACS 集成 |
| @jsmedgl/plugin-ai | AI 模型推理集成（ONNX.js） | AI 辅助诊断集成方 |

---

## 8. 非功能需求

### 8.1 性能指标

| 指标 | 目标值 |
|:---|:---|
| 首次内容渲染（FCP）| < 1.5s（已加载 10MB NIfTI） |
| 切片滑动帧率 | ≥ 30 FPS（256×256×128 体素） |
| 体绘制帧率 | ≥ 24 FPS（同上，开启光照） |
| 体绘制帧率 | ≥ 15 FPS（512×512×256 体素，开启光照） |
| 内存占用 | 单个体积 < 内存的 50%（防止 OOM） |
| 包体积（core） | < 300 KB（gzip，不含 itk-wasm） |

### 8.2 浏览器兼容性

| 浏览器 | MVP | v1.0 | v2.0 |
|:---|:---:|:---:|:---:|
| Chrome 100+ | ✅ | ✅ | ✅ WebGPU |
| Firefox 100+ | ✅ | ✅ | ✅ |
| Safari 16+ | ✅ | ✅ | ⚠️ WebGPU 待验证 |
| Edge 100+ | ✅ | ✅ | ✅ |
| iOS Safari 16+ | ✅ | ✅ | ⚠️ WebGPU 不支持 |

### 8.3 可访问性

- 所有交互元素支持键盘导航
- 色彩对比度符合 WCAG 2.1 AA
- 窗宽窗位调节同时提供声音/触觉反馈（未来版本）

### 8.4 安全与隐私

- **零服务端依赖**：所有解析/渲染在浏览器本地完成，数据不离开客户端
- CSP 合规：支持严格 Content-Security-Policy 部署
- 无第三方追踪

---

## 9. API 设计概要

### 9.1 核心使用示例（原生 HTML）

```javascript
import { createVolumeViewer } from '@jsmedgl/core';

// 初始化渲染器
const viewer = createVolumeViewer({
  container: document.getElementById('viewer'),
  crosshair: true,
  colorbar: true,
});

// 加载 NIfTI 文件
const volume = await viewer.loadNifti('/data/mri.nii.gz');

// 监听切片变化
volume.onSliceChange((axis, index) => {
  console.log(`${axis}: slice ${index}`);
});

// 调整窗宽窗位
viewer.setWindowLevel({ window: 80, level: 40 });

// 导出当前视图
await viewer.screenshot().then(blob => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'snapshot.png'; a.click();
});
```

### 9.2 React 使用示例

```jsx
import { MedglVolumeView } from '@jsmedgl/react';

function App() {
  const [windowLevel, setWindowLevel] = useState({ window: 40, level: 80 });

  return (
    <MedglVolumeView
      src="/data/mri.nii.gz"
      layout="3x2"  // 3个正交视图 + 3D视图
      crosshair
      colorbar
      windowLevel={windowLevel}
      onWindowLevelChange={setWindowLevel}
      onSliceChange={(axis, idx) => console.log(axis, idx)}
    />
  );
}
```

### 9.3 关键 API 列表

| API | 参数 | 返回 | 版本 |
|:---|:---|:---|:---|
| `createVolumeViewer()` | container, options | ViewerInstance | MVP |
| `viewer.loadNifti(url/File/ArrayBuffer)` | string/Blob/Buffer | VolumeObject | MVP |
| `volume.setSlice(axis, index)` | 'axial'/'coronal'/'sagittal', number | void | MVP |
| `volume.setWindowLevel({window, level})` | {window: number, level: number} | void | MVP |
| `viewer.setLayout('single'|'mpr'|'3x2')` | string | void | MVP |
| `volume.addOverlay(url, options)` | url, {colorMap, opacity} | OverlayObject | v1.0 |
| `viewer.exportState()` | — | JSON | v1.0 |
| `viewer.importState(json)` | JSON | void | v1.0 |
| `jsMedgl.use(plugin)` | PluginObject | void | v2.0 |

---

## 10. 版本发布节奏（预估）

| 里程碑 | 主要交付物 | 目标周期 |
|:---|:---|:---|
| **v0.1 MVP** | NIfTI 解析 + 单视图 + 窗宽窗位 + 3D 体绘制 + 坐标系修复 | Sprint 1-4（~8周）|
| **v0.2 稳定版** | Bug 修复 + 性能优化 + NRRD/MGH 格式支持 | Sprint 5-6（~4周）|
| **v1.0 正式版** | MPR + Overlay + MIP + 4D + 快照导出 + Vue/Angular 适配器 | Sprint 7-12（~12周）|
| **v2.0 增强版** | WebGPU + 插件系统 + DICOM + 标注工具 + Mesh | Sprint 13+ |

> **注**：以上周期为粗略估算，实际以 Scrum 迭代计划为准。

---

## 11. Open Issues / 待决策项

| # | 问题 | 选项 | 优先级 |
|:---|:---|:---|:---|
| 1 | DICOM 解析：自研解析器 vs itk-wasm | 自研（轻量）vs itk-wasm（功能全但包大 ~8MB） | P0 |
| 2 | React 优先还是多框架同步？ | React 优先 v1.0，Vue/Angular v1.0 同步 | P1 |
| 3 | WebGPU 降级策略 | WebGL2 完全降级 vs 部分降级（仅体绘制走 WebGL） | P1 |
| 4 | 许可协议 | Apache 2.0（生态友好）vs AGPL（商业限制） | P1 |
| 5 | CI/CD 平台 | GitHub Actions vs Jenkins | P2 |

---

*本 PRD 将随开发进展持续更新，建议每两周评审一次。*
