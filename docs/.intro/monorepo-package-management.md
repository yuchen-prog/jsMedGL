# pnpm Monorepo 包管理详解

> 以 jsMedgl 项目为实际案例，从零讲清楚 pnpm 的依赖管理机制。

---

## 1. 什么是 Monorepo？

把多个相关的包放在同一个 Git 仓库里管理，就是 Monorepo。jsMedgl 就是典型的 Monorepo：

```
jsMedgl/                          ← 一个 Git 仓库
├── packages/
│   ├── parser-nifti/             ← @jsmedgl/parser-nifti（NIfTI 解析器）
│   ├── core/                     ← @jsmedgl/core（共享逻辑层）
│   ├── renderer-2d/              ← @jsmedgl/renderer-2d（2D 切片渲染器）
│   ├── renderer-3d/              ← @jsmedgl/renderer-3d（3D 体渲染器）
│   └── react/                    ← @jsmedgl/react（React 适配器）
├── apps/
│   ├── demo/                     ← Demo 应用
│   └── website/                  ← 官网
├── tests/                        ← 测试文件（不属于任何子包）
├── package.json                  ← 根 package.json
└── pnpm-workspace.yaml           ← 告诉 pnpm 哪些是子包
```

每个 `packages/*` 和 `apps/*` 下都有自己的 `package.json`，是一个**独立的 npm 包**。

### 为什么要用 Monorepo？

| 问题 | 没有 Monorepo | 有 Monorepo |
|:---|:---|:---|
| 改了 parser-nifti，renderer 能立刻测试吗？ | 不能，要先发版、再装版 | 能，本地直接引用 |
| 坐标系工具要在 3 个包里保持一致 | 手动同步，容易漏 | 从 core 统一导出，改一处生效 |
| 跨包重构 | 分别改 3 个仓库，3 次 PR | 一次 PR 全部改完 |

---

## 2. 三个包管理器对比：npm vs yarn vs pnpm

### 2.1 安装方式的核心区别

假设有三个包都依赖 `lodash`：

**npm / yarn（v1 classic）— 扁平化安装**

```
node_modules/
├── lodash/              ← 实际文件（只装一份）
├── package-a/           ← package-a 能看到 lodash ✅
├── package-b/           ← package-b 能看到 lodash ✅
├── package-c/           ← package-c 能看到 lodash ✅
└── some-other-lib/      ← 即使没声明 lodash，也能看到！❌
```

npm 和 yarn v1 把**所有依赖都摊平到一层 `node_modules/` 下**。这导致了著名的"幽灵依赖"问题——你没声明的包，也能 import 进来。

**pnpm — 严格隔离 + 硬链接**

```
node_modules/
├── .pnpm/                          ← 所有包的实际文件（硬链接到全局 store）
│   ├── lodash@4.17.21/
│   │   └── node_modules/
│   │       └── lodash/            ← 只有一份真实文件
│   ├── package-a@1.0.0/
│   │   └── node_modules/
│   │       ├── package-a/
│   │       └── lodash → ../../lodash@4.17.21/node_modules/lodash  ← 符号链接
│   ├── package-b@1.0.0/
│   │   └── node_modules/
│   │       ├── package-b/
│   │       └── lodash → ../../lodash@4.17.21/node_modules/lodash  ← 符号链接
│   └── package-c@1.0.0/
│       └── node_modules/
│           ├── package-c/
│           └── lodash → ../../lodash@4.17.21/node_modules/lodash  ← 符号链接
├── package-a → .pnpm/package-a@1.0.0/node_modules/package-a      ← 顶层符号链接
├── package-b → .pnpm/package-b@1.0.0/node_modules/package-b
└── package-c → .pnpm/package-c@1.0.0/node_modules/package-c
```

关键区别：

| 特性 | npm / yarn v1 | pnpm |
|:---|:---|:---|
| 依赖结构 | 扁平化（全部摊开） | 嵌套（严格隔离） |
| 磁盘占用 | 每个项目各装一份 | 全局 store 硬链接，多项目共享 |
| 幽灵依赖 | 有（能 import 未声明的包） | 没有（只能 import 声明的包） |
| 安装速度 | 较慢 | 快（硬链接秒完成） |

### 2.2 硬链接是什么？

pnpm 不会为每个项目重新下载 `lodash`。它在一个**全局 store** 中只存一份：

```
# pnpm 的全局 store（你的机器上的实际路径）
~/.local/share/pnpm/store/v10/
└── files/
    └── 00/
        └── abc123...   ← lodash 的 index.js（只有这一份）

# jsMedgl 项目中的 lodash
jsMedgl/node_modules/.pnpm/lodash@4.17.21/node_modules/lodash/index.js
  → 硬链接到 store 中的 abc123...（不是复制，是同一个文件）
```

**硬链接意味着：**
- 磁盘上只有一份数据
- 多个项目"装"同一个 lodash 时，不额外占空间
- `pnpm store prune` 可以清理不再被任何项目引用的旧版本

---

## 3. pnpm 的 hoist 机制

### 3.1 为什么需要 hoist？

pnpm 的严格隔离虽然安全，但有些工具链（比如 Vite、ESLint）假设依赖是扁平的。如果完全不 hoist，这些工具会找不到包。

### 3.2 pnpm 默认的 hoist 行为

pnpm 默认 `hoist=true`，意思是：**把根 `package.json` 中声明的依赖，在根 `node_modules/` 下创建符号链接。**

```
# jsMedgl 根 package.json 的 devDependencies:
{
  "vitest": "^1.0.0",
  "": "^3.4.3",
  ...
}

# 对应的根 node_modules/ 结构:
node_modules/
├── .pnpm/                          ← 所有包的真实位置
│   ├── vitest@1.6.1_.../
│   │   └── node_modules/vitest/    ← 实际文件
│   └── @3.4.4/
│       └── node_modules//  ← 实际文件
├── vitest → .pnpm/vitest@1.6.1_.../node_modules/vitest     ← 符号链接（hoist）
└──  → .pnpm/@3.4.4/node_modules/     ← 符号链接（hoist）
```

**核心规则：只有根 `package.json` 自己声明的依赖才会被 hoist 到根 `node_modules/` 下。**

### 3.3 子包的依赖不在根 node_modules 下

子包声明的依赖，只在该子包自己的 `node_modules/` 下可见：

```
# renderer-2d 的 package.json 声明了 
packages/renderer-2d/node_modules/
├── @jsmedgl/ → ../../..   ← workspace 包的符号链接
├──  → ...                ← 符号链接，指向 .pnpm 中的真实文件
└── typescript → ...

# 根 node_modules/ 中也会有  吗？
# 取决于根 package.json 是否也声明了 
```

### 3.4 实际案例：删除根目录  后发生了什么

#### 删除前

```
根 package.json:         devDependencies: { "": "^3.4.3" }  ← 有
renderer-2d/package.json: dependencies:    { "": "^3.4.3" }  ← 有
renderer-3d/package.json: dependencies:    { "": "^3.4.3" }  ← 有

根 node_modules/
├──  → .pnpm/@3.4.4/...    ← 符号链接存在（因为根声明了）
└── ...

packages/renderer-2d/node_modules/
├──  → ...                  ← 符号链接存在（因为 renderer-2d 声明了）
└── ...

tests/unit/oblique-plane.test.ts 中 import '' → 解析根 node_modules/ → ✅ 找到
```

#### 删除后

```
根 package.json:         devDependencies: { /* 没有  */ }    ← 删了
renderer-2d/package.json: dependencies:    { "": "^3.4.3" }  ← 还在
renderer-3d/package.json: dependencies:    { "": "^3.4.3" }  ← 还在

根 node_modules/
├── (没有  符号链接了！)      ← pnpm 不再 hoist，因为根没声明
└── ...

packages/renderer-2d/node_modules/
├──  → ...                  ← 还在
└── ...

tests/unit/oblique-plane.test.ts 中 import '' → 解析根 node_modules/ → ❌ 找不到！
```

**测试文件 `tests/` 在项目根目录下，不属于 `renderer-2d` 也不属于 `renderer-3d`。它的模块解析路径是根 `node_modules/`，但那里已经没有  了。**

#### 原因总结

```
tests/unit/oblique-plane.test.ts
  │
  ├── import from ''          ← 走 Node 模块解析：查根 node_modules/
  │                               → 根没声明 → 没有 → 报错 ❌
  │
  └── import from '@jsmedgl/renderer-2d'
                                  ← 走 vitest alias 配置 → 直接指向源码 → ✅
```

所以正确的做法是：**谁消费了第三方包，谁就必须在自己的 `package.json` 中声明它。**

```
根 package.json         devDependencies: { "": "^3.4.3" }    ← tests/ 用到了，必须声明
renderer-2d/package.json dependencies:    { "": "^3.4.3" }    ← oblique/ 用到了，必须声明
renderer-3d/package.json dependencies:    { "": "^3.4.3" }    ← VolumeCamera 用到了，必须声明
```

三处声明缺一不可。

---

## 4. 子包之间怎么互相引用？

### 4.1 workspace 协议

pnpm 用 `workspace:*` 表示"引用本仓库内的包"：

```json
// packages/renderer-2d/package.json
{
  "dependencies": {
    "@jsmedgl/core": "workspace:*",          ← 指向本仓库的 core
    "@jsmedgl/parser-nifti": "workspace:*",  ← 指向本仓库的 parser-nifti
    "": "^3.4.3"                      ← 外部第三方包
  }
}
```

`workspace:*` 的效果：
- 开发时：直接链接到本地源码，改了立刻生效
- 发版时：自动替换成实际版本号（如 `@jsmedgl/core: "^0.1.0"`）

### 4.2 解析路径

```
renderer-2d 代码中 import { buildColorLUT } from '@jsmedgl/core'

解析过程：
  1. Node 找 packages/renderer-2d/node_modules/@jsmedgl/core
     → 发现是符号链接，指向 ../../../../node_modules/.pnpm/.../core
  2. 但 vitest.config.ts 中配置了 alias：
     '@jsmedgl/core' → '/home/yuchen/jsMedgl/packages/core/src'
  3. 直接读到 core 的 TypeScript 源码，无需编译
```

### 4.3 jsMedgl 的依赖图

```
parser-nifti（最底层，无内部依赖）
    ↑
  core（依赖 parser-nifti + zustand）
    ↑         ↑
renderer-2d  renderer-3d（都依赖 core + parser-nifti + ）
    ↑         ↑
  react 适配器（依赖 core）
```

---

## 5. 常见误区

### 误区 1："根声明了，子包就不用声明了"

**错误。** 每个子包是独立的包，必须自己声明自己用到的依赖。

### 误区 2："子包声明的依赖会自动 hoist 到根"

**错误。** pnpm 的 hoist 只提升根 `package.json` 自己声明的依赖到根 `node_modules/`。子包的依赖只在子包的 `node_modules/` 下。

### 误区 3："pnpm 跟 npm 一样，依赖都是扁平的"

**错误。** pnpm 用 `.pnpm/` 嵌套 + 符号链接实现严格隔离，只有在根 `package.json` 声明的包才会出现在根 `node_modules/` 顶层。

### 误区 4："测试文件能访问子包的依赖"

**错误。** 测试文件（`tests/`）属于根目录，模块解析从根 `node_modules/` 开始。它只能访问根 `package.json` 声明的依赖，以及通过 alias 配置指向的子包源码。

---

## 6. jsMedgl 项目中  的正确分布

| 位置 | 声明类型 | 原因 |
|:---|:---|:---|
| 根 `package.json` | `devDependencies` | `tests/unit/oblique-plane.test.ts` 和 `tests/unit/volume-camera.test.ts` 直接 import 了它 |
| `packages/renderer-2d/package.json` | `dependencies` | `src/oblique/math.ts`、`src/oblique/ObliquePlane.ts` 中使用了 `vec3`、`quat`、`mat3` |
| `packages/renderer-3d/package.json` | `dependencies` | `src/VolumeCamera.ts` 中使用了 `mat4`、`vec3`、`quat` |
| `packages/parser-nifti/package.json` | ~~无~~ | 代码中没有 import ，之前是遗留声明，已移除 |
| `packages/core/package.json` | 无 | core 层不使用  |

---

*本文档基于 pnpm v10.15.0 和 jsMedgl 项目的实际结构编写。*
