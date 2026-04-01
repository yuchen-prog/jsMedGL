# CI/CD 流水线详解

> 本文档面向零基础读者，讲解 jsMedgl 项目中两套 GitHub Actions workflow 的设计原理与使用方法。

## 一、什么是 CI/CD？

### 1.1 从手动发布说起

在没有 CI/CD 之前，如果你想发布网站，流程是这样的：

```
写代码 → 本地测试 → 手动打包 → 用 FTP/SCP 上传到服务器 → 配置域名 → 完成
```

这套流程的问题：
- 每次改代码都要手动操作，容易出错
- 不同开发者的环境可能不同（"在我机器上能跑"）
- 没法知道代码改完后是否破坏了已有功能

### 1.2 CI 是什么

**CI（Continuous Integration，持续集成）**：代码 push 后，自动跑一套检查——类型对不对、代码规范吗、测试通过吗。如果任何一步失败，立刻通知开发者。

这就好比请了一个**24 小时在线的代码质量门卫**。

### 1.3 CD 是什么

**CD（Continuous Deployment，持续部署）**：检查全部通过后，自动把代码构建成可发布的产物，并部署到服务器上。你不需要登录服务器、不需要手动上传文件，push 代码后几分钟网站就自动更新了。

```
你 push 代码
    ↓
CI 自动检查（类型、测试、规范）
    ↓
检查通过
    ↓
CD 自动构建 + 部署
    ↓
网站上线 ✅
```

### 1.4 GitHub Actions 是什么

GitHub 内置的 CI/CD 工具。你在项目里放一个 `.yml` 配置文件（称为 **workflow**），告诉 GitHub："每当有人 push 代码时，按以下步骤做检查和发布。"

## 二、GitHub Actions 基本概念

### 2.1 核心概念

| 概念 | 解释 |
|------|------|
| **workflow（工作流）** | 一个 `.yml` 文件 = 一套自动化流程 |
| **runner（运行器）** | 执行 workflow 的虚拟机（我们用的是 GitHub 提供的 ubuntu） |
| **job（作业）** | 一组步骤的集合，跑在一个独立的虚拟机上 |
| **step（步骤）** | job 内的每个独立操作（如安装依赖、运行命令） |
| **action（动作）** | 别人写好的、可复用的 step（如 `actions/checkout@v4`） |

### 2.2 执行模型

```
workflow
  ├── trigger（触发条件：什么时候跑？）
  └── jobs
        ├── job 1（跑在虚拟机 A 上）
        │     └── steps（按顺序执行）
        ├── job 2（跑在虚拟机 B 上，跟 A 并行）
        │     └── steps
        └── job 3（跑在虚拟机 C 上）
              └── needs: [job 1, job 2]  ← 等前两个完成再跑
```

注意：job 之间如果**没有** `needs` 声明，则并行运行。

## 三、jsMedgl 的两个 workflow

本项目有两个独立的 workflow 文件：

```
.github/workflows/
├── ci.yml              # 代码质量检查
└── deploy-website.yml  # 网站自动部署
```

### 3.1 为什么分成两个文件？

| | ci.yml | deploy-website.yml |
|---|---|---|
| **职责** | 检查代码质量 | 把网站发布上线 |
| **触发频率** | 每次 push/PR 都跑 | 只在 main 分支且相关文件变化时跑 |
| **产物** | 测试报告、类型检查结果 | 可访问的线上网页 |
| **失败后果** | 告诉你代码有问题 | 网站不更新 |

这是两个完全不同的关注点。分开管理的好处：
- 可以单独禁用/修改其中一个
- 职责清晰，配置文件易读
- CI 失败不会阻止 deploy（反之亦然）

## 四、ci.yml 详解

### 4.1 触发条件

```yaml
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]
```

解释：
- `push`：任何人 push 代码到 main 或 develop 分支时触发
- `pull_request`：有人提 PR 到 main 或 develop 时触发

这意味着：**每次代码变更都自动跑检查**，不管是直接 push 还是通过 PR。

### 4.2 三个 Job 的关系

```
push/PR
    │
    ├── job 1: lint-and-typecheck ──────┐
    │      (并行)                        │ 两者都通过
    ├── job 2: test                     ├→ job 3: build
    │                                    │ (串行，等上面两个)
    └── （job 3 需要等 job 1 和 2 完成）
```

用 `needs` 声明依赖关系：build 必须等 lint + test 都通过才跑。这样可以**节省资源**——lint 失败了，test 还在跑，但 build 会直接跳过。

### 4.3 Job 1: lint-and-typecheck

```yaml
jobs:
  lint-and-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4        # ① 把代码拉到虚拟机
      - uses: pnpm/action-setup@v2       # ② 安装 pnpm 包管理器
        with:
          version: 8
      - uses: actions/setup-node@v4      # ③ 安装 Node.js 20
        with:
          node-version: '20'
          cache: 'pnpm'                   # 记住已下载的包，下次更快
      - name: Install dependencies
        run: pnpm install                # ④ 安装所有依赖
      - name: Type Check
        run: pnpm typecheck             # ⑤ TypeScript 编译检查
      - name: ESLint
        run: pnpm lint                  # ⑥ 代码规范检查
```

**逐步解释：**

① `actions/checkout@v4`：这是 GitHub 官方 action，作用是把你的代码仓库复制到虚拟机的当前目录下。这是**所有 workflow 的第一步**，没有它后续步骤无代码可操作。

② `pnpm/action-setup@v2`：安装 pnpm。GitHub Actions 虚拟机只有 npm 和 yarn，不含 pnpm，所以需要这个 action。

③ `actions/setup-node@v4`：安装 Node.js。注意 `cache: 'pnpm'`——GitHub 会记住上次 `pnpm install` 下载的包，下次运行直接从缓存读取，速度快很多。

④ `pnpm install`：安装所有 `package.json` 里声明的依赖。workspace 模式下会安装根目录和所有子包的依赖。

⑤ `pnpm typecheck`：运行 `pnpm -r typecheck`，检查所有 TypeScript 类型是否正确。如果代码有类型错误（如参数类型不匹配），这一步会失败。

⑥ `pnpm lint`：运行 ESLint，检查代码风格和潜在问题（如未使用的变量、不安全的语法）。

### 4.4 Job 2: test

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - checkout
      - pnpm/action-setup
      - actions/setup-node
      - name: Install dependencies
        run: pnpm install
      - name: Run tests
        run: pnpm test                   # 运行 vitest 单元测试
      - name: Upload coverage
        uses: codecov/codecov-action@v3  # 把覆盖率报告上传到 codecov.io
        with:
          files: ./coverage/coverage-final.json
          flags: unittests
```

跟 Job 1 类似，但最后一步是**运行测试**。`pnpm test` 运行 vitest，测试所有 `tests/` 下的用例。`codecov-action` 将覆盖率数据上传到 codecov.io，方便查看测试覆盖了多少代码。

### 4.5 Job 3: build

```yaml
jobs:
  build:
    name: Build
    runs-on: ubuntu-latest
    needs: [lint-and-typecheck, test]   # 等前两个完成
    steps:
      - checkout
      - pnpm/action-setup
      - actions/setup-node
      - pnpm install
      - name: Build packages
        run: pnpm build                 # 构建所有 packages 的 dist
      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: dist
          path: packages/*/dist         # 把构建产物打包保存
```

这里构建的是**库代码**（parser-nifti、renderer-2d、core 的 `dist/` 目录），不是网站。构建产物用 `upload-artifact` 保存，这样你可以从 CI 运行记录里下载。

## 五、deploy-website.yml 详解

### 5.1 触发条件

```yaml
on:
  push:
    branches: [main]
    paths:
      - 'apps/website/**'              # 改了网站源码
      - 'packages/**'                  # 改了依赖的库（网站依赖它们）
      - '.github/workflows/deploy-website.yml'  # 改了部署流程本身
  workflow_dispatch:                    # 允许手动触发
```

跟 ci.yml 的区别：

| 维度 | ci.yml | deploy-website.yml |
|------|---------|-------------------|
| 分支 | main + develop | **仅** main |
| PR | ✅ 触发 | ❌ 不触发 |
| paths 过滤 | 无（每次都跑） | 有（只管网站相关） |
| 手动触发 | ❌ | ✅ `workflow_dispatch` |

为什么只部署 main 分支？因为 develop 是开发分支，内容可能不完整，不应该部署到正式环境。

paths 过滤的好处：如果你只改了测试文件（`tests/`），CI 会跑检查，但 deploy 不会触发——因为测试变动不影响网站。

### 5.2 permissions（权限声明）

```yaml
permissions:
  contents: read    # 读取代码仓库（必须，否则 checkout 失败）
  pages: write      # 写入 GitHub Pages（必须，否则无法部署）
  id-token: write   # OIDC Token（GitHub Pages 安全认证用）
```

GitHub Actions 默认授予**所有**权限（读、写、删除所有内容）。显式声明最小权限是安全最佳实践：这个 workflow 只做两件事——读代码和写 Pages，不需要其他权限。

### 5.3 concurrency（并发控制）

```yaml
concurrency:
  group: pages
  cancel-in-progress: false
```

`group: pages`：同一 group 内同时只能有一个 workflow 在跑。

场景：你快速连续 push 了 3 次。如果不加这个设置，GitHub 会并行跑 3 个 deploy job，可能产生冲突、浪费资源。设置后，新的 deploy 会**等待**正在进行的那个完成后才跑。

`cancel-in-progress: false`：不会杀掉正在运行的 workflow。设为 `true` 则新的 push 会取消旧的。

### 5.4 Job 1: build

```yaml
jobs:
  build:
    name: Build
    runs-on: ubuntu-latest
    steps:
      - checkout
      - pnpm/action-setup
      - actions/setup-node
      - pnpm install
      - name: Build website
        run: pnpm website:build          # 等价于 pnpm --filter @jsmedgl/website build
      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: apps/website/dist         # 把构建产物打包给 Pages 用
```

跟 ci.yml 的 build 步骤几乎一样，但关键区别是最后一步：

`upload-pages-artifact@v3` 是 GitHub Pages 专用的 artifact 上传 action。它把 `apps/website/dist/` 打包成一个**特殊格式的 artifact**，专门供 `deploy-pages` 使用。

注意这里构建的是**网站**（`apps/website/dist/`），不是库代码（`packages/*/dist/`）。

### 5.5 Job 2: deploy

```yaml
jobs:
  deploy:
    name: Deploy
    needs: build                        # 必须等 build 完成
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

`needs: build`：deploy 必须等 build 完成。如果 build 失败（构建报错），deploy 不会跑。

`environment: github-pages`：GitHub 的"环境"概念。这里 `github-pages` 是 GitHub Pages 的内置环境名，关联你在 repo Settings → Pages 里配置的部署目标。

`actions/deploy-pages@v4`：GitHub 官方 action，从 Pages artifact 中取出构建产物，发布到 GitHub 的 CDN 上。这一步完成后，网站就可以访问了。

## 六、完整执行流程图

```
你: git push main
        │
        ├─────────────────────────────────────┐
        │  ci.yml 触发                         │  deploy-website.yml 触发
        │  (所有 push/PR 都触发)               │  (仅 main + paths 匹配)
        │                                     │
        ├─ lint-and-typecheck ──────┐         ├─ build
        │      (并行)                │         │    checkout → install → build
        ├─ test                     ├→ build  ├─ upload artifact
        │                           │         │
        │                           │         └→ deploy → 网站上线 ✅
        └─ 如果失败 → 通知你 ❌ ─────┘
              (不阻止 deploy)
```

## 七、GitHub Pages 的工作原理

### 7.1 什么是 GitHub Pages

GitHub Pages 是 GitHub 提供的**静态文件托管服务**。你可以把 HTML、CSS、JS 文件上传到 GitHub 仓库，GitHub 会把它变成一个可访问的网站。

URL 规则：`https://<username>.github.io/<repository>/`

- username: `yuchen-prog`
- repository: `jsMedGL`

所以网站地址是：`https://yuchen-prog.github.io/jsMedGL/`

### 7.2 静态托管意味着什么

GitHub Pages **不运行服务端代码**。没有 Node.js、没有 PHP、没有 Python。只有纯静态文件：HTML、CSS、图片、JS。

这正是 Astro 的优势——它把 React 组件、模板全部**在构建时编译成纯 HTML/CSS/JS**，部署时只需要这些静态文件。

```
开发时: React 组件 + 动态模板 + Tailwind 样式
                ↓  (pnpm website:build / Astro build)
部署时: index.html + *.js + *.css（纯静态，可直接托管）
```

### 7.3 `base` 配置的作用

```js
// apps/website/astro.config.mjs
export default defineConfig({
  site: 'https://yuchen-prog.github.io',  // 告诉 Astro 网站的完整 URL
  base: '/jsMedGL/',                      // 所有资源路径加此前缀
});
```

问题场景：如果 `base` 是 `/`，那么 CSS 文件路径是 `/jsMedGL/_astro/index.css`（正确）。

如果 `base` 设错了（如 `/jsMedgl/` 而实际 repo 名是 `/jsMedGL/`），CSS 文件路径就变成 `/jsMedgl/_astro/index.css` → **404**，页面没有样式。

这就是为什么 `base` 必须精确匹配 GitHub repo 名称（大小写敏感）。

### 7.4 部署数据流

```
1. 本地/CI 虚拟机
   Astro build
       ↓
   apps/website/dist/
     ├── index.html
     ├── _astro/index.css
     └── _astro/client.js
       ↓
2. upload-pages-artifact
       ↓ (打包成 GitHub 专用的 artifact)
3. GitHub Actions 云端存储
       ↓
4. deploy-pages
       ↓ (从 artifact 取出文件，发布到 CDN)
5. GitHub Pages CDN
       ↓
6. 用户浏览器
   https://yuchen-prog.github.io/jsMedGL/
```

## 八、常见问题排查

### 8.1 workflow 没有触发

检查：
1. 是否 push 到正确的分支？（deploy-website 只在 main）
2. 是否改了 paths 过滤包含的文件？（`apps/website/`、`packages/`、`.github/workflows/deploy-website.yml`）
3. 如果改的是 `.github/workflows/ci.yml`，它**不会**触发 deploy-website

解决方法：touch 一个 `apps/website/` 下的文件再 push。

### 8.2 "Install dependencies" 失败

常见原因：
- lockfile 格式不匹配（如本地 pnpm 版本新，CI 的旧）
- 网络问题（CI 虚拟机无法访问 npm registry）

解决方法：
- 使用 `--frozen-lockfile` 可以防止 lockfile 被意外修改，但要求 CI 和本地 pnpm 版本严格一致
- 如果版本不一致，去掉 `--frozen-lockfile`，让 pnpm 自动调整 lockfile

### 8.3 Deploy 失败但 build 成功

常见原因：
- GitHub Pages 的 Source 没有设为 "GitHub Actions"

解决方法：进入 repo Settings → Pages → Source，选择 **GitHub Actions**。

### 8.4 网站样式错乱（CSS 404）

检查 `astro.config.mjs` 中的 `base` 是否与实际 repo 名称完全一致（注意大小写）。

### 8.5 资源 404

检查：
- 所有静态资源（favicon、CSS、JS）是否在 `apps/website/public/` 或 `src/` 下
- 构建后 `apps/website/dist/` 目录是否存在且内容正确

## 九、如何手动触发 workflow

### 9.1 通过 GitHub 网页

1. 打开 https://github.com/yuchen-prog/jsMedGL/actions
2. 点击左侧 workflow 名称
3. 点击 "Run workflow" 按钮
4. 选择分支，点击绿色 "Run workflow"

这对于 `workflow_dispatch` 触发的 workflow（如 deploy-website）特别有用。

### 9.2 通过 git 强制触发

如果只是想触发 CI（不做任何代码改动）：

```bash
git commit --allow-empty -m "ci: re-run workflows"
git push
```

GitHub 会认为这是一个新的 commit，触发所有相关 workflow。

## 十、自定义修改指南

### 10.1 添加新的 package

packages 下的新包会被自动构建（`packages/*/dist`），无需修改 ci.yml。

### 10.2 修改 CI 检查步骤

在 ci.yml 的 `lint-and-typecheck` job 中添加/删除 step。

### 10.3 修改网站构建命令

在根目录 `package.json` 中修改：

```json
{
  "scripts": {
    "website:dev": "pnpm --filter @jsmedgl/website dev",
    "website:build": "pnpm --filter @jsmedgl/website build"
  }
}
```

deploy-website.yml 中的 `pnpm website:build` 会自动使用新命令。

### 10.4 修改触发条件

编辑 `on:` 部分。例如想让 develop 也部署：

```yaml
on:
  push:
    branches: [main, develop]  # 加一行 develop
    paths:
      - 'apps/website/**'
```

### 10.5 添加新的 workflow

在 `.github/workflows/` 下创建新的 `.yml` 文件即可。GitHub Actions 会自动识别并显示在 Actions 页面。

## 十一、相关资源

- [GitHub Actions 官方文档](https://docs.github.com/en/actions)
- [actions/checkout](https://github.com/actions/checkout)
- [pnpm/action-setup](https://github.com/pnpm/action-setup)
- [actions/deploy-pages](https://github.com/actions/deploy-pages)
- [GitHub Pages 文档](https://docs.github.com/en/pages)
