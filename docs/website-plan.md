# jsMedgl Promotional Website — Implementation Plan

## Context

jsMedgl 需要一个宣传 landing page，向开发者和研究人员展示其核心功能和技术优势。网站放在 monorepo 的 `apps/website/` 下，通过 GitHub Actions 自动部署到 GitHub Pages。

- **技术栈**: Astro 5 + React（交互组件）+ Tailwind CSS
- **视觉风格**: 深色科技风（Vercel/Linear 风格）
- **部署**: GitHub Pages via GitHub Actions
- **内容语言**: 英文

---

## 目录结构

```
apps/website/
├── astro.config.mjs
├── package.json
├── tsconfig.json
├── tailwind.config.mjs
├── public/
│   ├── favicon.svg
│   ├── og-image.png              # Open Graph 社交卡片（后期添加）
│   └── fixtures/
│       └── demo-volume.nii.gz     # 小体积 demo NIfTI（从 demo/fixtures 复制 98KB 的文件）
└── src/
    ├── layouts/
    │   └── BaseLayout.astro       # HTML shell, meta tags, 全局样式
    ├── pages/
    │   └── index.astro            # 单页面，包含所有 sections
    ├── components/
    │   ├── Navbar.astro           # 固定顶部导航
    │   ├── HeroSection.astro      # Hero 文字 + 包裹 LiveDemo
    │   ├── LiveDemo.tsx            # React 交互式 MPR viewer（Astro island）
    │   ├── FeatureShowcase.astro   # 功能特性卡片网格
    │   ├── FeatureCard.astro       # 单个功能卡片
    │   ├── CodeExamples.astro      # 代码示例（语法高亮）
    │   ├── ComparisonTable.astro   # 竞品对比表格
    │   ├── Roadmap.astro           # 版本路线图时间线
    │   └── Footer.astro           # 页脚
    ├── styles/
    │   └── global.css             # Tailwind directives + 自定义 CSS
    └── data/
        ├── features.ts            # 功能卡片数据
        ├── comparison.ts          # 对比表格数据
        └── roadmap.ts             # 路线图数据
```

额外文件：
- `.github/workflows/deploy-website.yml` — GitHub Actions 部署流程
- `package.json`（根目录）— 添加 `website:dev` 和 `website:build` scripts

---

## 页面板块（从上到下）

### 1. Navbar
- 左侧: jsMedgl logo（文字 + accent 色）
- 中间: 导航链接（Features / Demo / Code / Roadmap）
- 右侧: GitHub 链接 + Star badge
- 半透明背景 + backdrop-blur，固定顶部

### 2. Hero + Live Demo
- **左栏**: 大标题 "Browser-Native Medical Imaging"、副标题、CTA 按钮
- **右栏**: 嵌入式 WebGL 实时 demo（`LiveDemo.tsx`，React island）
  - 自动加载一个小 NIfTI 文件，渲染 axial slice
  - 用户可以滚轮切换 slice、点击定位 crosshair
  - 带 glow border 的容器，加载时显示 spinner
- 渐变发光背景，标题有 gradient text 效果
- `min-h-screen` 占满首屏

### 3. Feature Showcase
- 4 个功能卡片 2×2 网格（移动端 1 列）
- 每个卡片: SVG icon + 标题 + 描述 + 可选截图/动画
- 功能:
  1. **Multi-Planar Reconstruction** — 三视图同步 + crosshair 导航
  2. **Oblique MPR** — 任意角度旋转 + 交互手柄
  3. **Window/Level Control** — 实时窗宽窗位 + 预设
  4. **Coordinate Accuracy** — 正确的 sform/qform 处理（修复 MRIcroWeb 缺陷）
- 卡片有 glow border，hover 时发光增强
- IntersectionObserver 触发 fade-in 动画

### 4. Code Examples
- 标题 "Integrate in Minutes"
- 两个代码块并排（移动端竖排）
  - Block 1: `parseNifti()` 解析文件
  - Block 2: `createWebGLSliceView()` 渲染切片
- Astro 内置 Shiki 语法高亮（github-dark 主题）
- 每个 block 有 Copy 按钮

### 5. Comparison Table
- 标题 "Why jsMedgl?"
- 对比 jsMedgl vs NiiVue vs MRIcroWeb vs vtk-js
- 维度: Zero-install | 坐标系精度 | MPR | Oblique MPR | Framework-agnostic | Bundle size | License
- jsMedgl 列高亮显示
- 移动端横向滚动

### 6. Roadmap
- 水平时间线，三个节点（移动端竖直）
  - **v0.1 (Current)**: NIfTI, 2D MPR, WebGL2, Oblique MPR
  - **v1.0 (Next)**: DICOM, 3D volume rendering, measurement tools, React/Vue adapters
  - **v2.0 (Future)**: WebGPU, VR/AR, collaborative viewing, segmentation
- 当前版本高亮 accent 色

### 7. Footer
- 三栏: logo + 描述 / 导航链接 / License + copyright
- `bg-surface`（比页面更深）

---

## 关键实现细节

### LiveDemo.tsx（React Island）

这是最复杂的组件。作为 Astro island 使用 `client:load` 指令：

```astro
<LiveDemo client:load />
```

实现要点：
1. `useEffect` 内 fetch NIfTI → `parseNifti()` → `createWebGLSliceView()`
2. 所有 WebGL 代码必须在 `useEffect` 内执行（不能在模块顶层或 render 时）
3. 容器 div 需要 `useRef` + 明确尺寸（不能用 0 宽高）
4. unmount 时调用 `view.dispose()` 清理
5. NIfTI 文件路径用 `import.meta.env.BASE_URL + 'fixtures/demo-volume.nii.gz'`

依赖 monorepo 包（通过 Vite alias 直接引用源码）：
- `@jsmedgl/parser-nifti` → `packages/parser-nifti/src`
- `@jsmedgl/renderer-2d` → `packages/renderer-2d/src`

### Astro 配置

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import { resolve } from 'path';

export default defineConfig({
  site: 'https://yuchen-prog.github.io',
  base: '/jsMedgl/',           // 匹配 GitHub repo 名称
  integrations: [react(), tailwind()],
  vite: {
    resolve: {
      alias: {
        '@jsmedgl/parser-nifti': resolve(__dirname, '../../packages/parser-nifti/src'),
        '@jsmedgl/renderer-2d': resolve(__dirname, '../../packages/renderer-2d/src'),
      },
    },
  },
});
```

`base` 路径确保 GitHub Pages 部署时资源路径正确。

### Tailwind 暗色主题

自定义颜色体系：
- `background: #0a0a0a`（主背景）
- `surface: #111111`（卡片/面板）
- `border: #222222` / `borderLight: #333333`
- `accent: #6366f1`（靛蓝色，主要发光色）
- `textPrimary/textSecondary/textMuted`

自定义动画：`fadeInUp`、`glowPulse`、`gradientShift`

### GitHub Actions 部署

创建 `.github/workflows/deploy-website.yml`：
- 触发: push to main，且 paths 包含 `apps/website/` 或 `packages/`
- 步骤: checkout → pnpm install → astro build → deploy to GitHub Pages
- 使用 `actions/deploy-pages@v4`（需要 repo settings 切换到 GitHub Actions source）

---

## 实施步骤（按顺序）

### Phase 1: 项目脚手架
1. 创建 `apps/website/` 目录结构
2. 创建 `package.json`（astro, @astrojs/react, @astrojs/tailwind, tailwindcss, workspace:* deps）
3. 创建 `astro.config.mjs`（含 Vite alias）
4. 创建 `tsconfig.json`、`tailwind.config.mjs`、`global.css`
5. 复制 `corocta_vessel_mask.nii.gz`（98KB）到 `public/fixtures/`
6. 根目录 `pnpm install`
7. 验证 `pnpm website:dev` 能启动

### Phase 2: 静态页面框架
8. `BaseLayout.astro` — HTML shell + meta + 全局样式
9. `index.astro` — 引入所有 section 占位
10. `Navbar.astro`
11. `Footer.astro`

### Phase 3: 内容板块
12. 创建 `data/features.ts`、`comparison.ts`、`roadmap.ts`
13. `FeatureCard.astro` + `FeatureShowcase.astro`
14. `CodeExamples.astro`
15. `ComparisonTable.astro`
16. `Roadmap.astro`
17. `HeroSection.astro`（先不含 LiveDemo）

### Phase 4: Live Demo
18. `LiveDemo.tsx` — 简化版 SliceViewer
19. 集成到 `HeroSection.astro`
20. 测试加载、渲染、交互

### Phase 5: 动画与润色
21. 滚动触发 fade-in 动画
22. hover 效果、glow 动画
23. 响应式测试与调整

### Phase 6: 部署
24. 创建 `.github/workflows/deploy-website.yml`
25. 根 `package.json` 添加 `website:dev` / `website:build` scripts
26. 配置 GitHub Pages settings
27. Push 测试部署

---

## 验证

1. `pnpm website:dev` — 本地开发服务器正常启动
2. 首页所有 section 正确渲染
3. Live Demo 能加载 NIfTI 并渲染切片，滚轮和点击可用
4. 响应式: 桌面/平板/手机三个断点布局正确
5. `pnpm website:build` — 构建无错误
6. Push to main → GitHub Actions 自动部署成功
7. GitHub Pages URL 可访问，所有功能正常
