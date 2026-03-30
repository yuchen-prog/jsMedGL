# Oblique MPR 深入解析

> 受众：零基础小白。本文从医学影像基础出发，逐步建立坐标系概念，最终解释 Oblique 功能的设计与修复思路。

---

## 一、医学影像基础（十分钟入门）

### 1.1 什么是 CT/MRI 断层扫描？

想象你把一个人切成一片一片的薄片，每片拍照记录。CT 和 MRI 扫描就是这个道理——它们产生一大堆"截面图像"，每张图像对应人体的一个横截面。

这些截面堆叠在一起，就形成了 **3D 体积数据**。一个典型的 CT 扫描可能是 512 × 512 × 300 像素，意思是：横向 512 列、纵向 512 行、共 300 层切片。

### 1.2 体素（Voxel）是什么？

2D 图像的最小单位叫**像素（pixel）**，3D 体积的最小单位叫**体素（voxel）**。每个体素存储一个数值——在 CT 中，这个数值代表该点的射线密度（Hounsfield 单位），MRI 中代表信号强度。

```
     2D: 像素 (pixel)        3D: 体素 (voxel)
    ┌────┬────┐              ┌────┬────┐
    │    │    │              │    │    │
    ├──┼──┼──┤              ├──┼──┼──┤  ← 一层切片
    │    │    │              │    │    │
    └────┴────┘              ├──┼──┼──┤
                              │    │    │  ← 堆叠起来
                              └──┴──┴──┘
```

### 1.3 NIfTI 文件格式

医学影像数据通常以 [NIfTI](https://nifti.nimh.nih.gov/) 格式存储。一个 NIfTI 文件包含两部分：
- **Header（头文件）**：图像尺寸、体素间距、坐标系信息等元数据
- **Data（数据）**：实际的体素数值，压缩或未压缩的二进制数组

jsMedgl 的 `parser-nifti` 包负责解析 NIfTI 文件，提取出体积数据和元数据。

---

## 二、三维坐标系详解

这是理解渲染逻辑的核心。医学影像涉及多个坐标系，理解它们之间的转换是Oblique功能的基石。

### 2.1 IJK 坐标系——体素索引

NIfTI 文件中，每个体素的位置用 **(I, J, K)** 三个整数索引表示，从 0 开始：

| 索引 | 含义 | 方向 |
|------|------|------|
| **I** | 列索引（Column） | I=0 是人体左侧，I=max 是右侧 |
| **J** | 行索引（Row） | J=0 是**前**（Anterior），J=max 是**后**（Posterior） |
| **K** | 层索引（Slice） | K=0 是**底部**（Inferior），K=max 是**顶部**（Superior） |

> **小提醒**：不要用直觉上的"前/后"混淆。这里的"前"指面对人体正面时的朝向，"后"是背面的朝向。

在内存中，体素按行主序（row-major）线性存储：

```
线性索引 = i + j × D0 + k × D0 × D1
```

其中 `D0, D1, D2` 是三个维度的尺寸。所以访问坐标 `(i, j, k)` 的体素，直接用数组下标即可。

### 2.2 RAS 坐标系——物理空间

IJK 索引只告诉我们"第几个体素"，但不知道这个体素在物理世界中的真实位置。我们需要知道：

- 体素有多大（间距）？
- 它们朝向哪个方向？
- 原点在哪里？

**RAS 坐标系**（Right-Anterior-Superior）是物理空间中常用的约定：

| 方向 | 含义 |
|------|------|
| **R** (Right) | X 正方向 = 人体右侧 |
| **A** (Anterior) | Y 正方向 = 人体前侧 |
| **S** (Superior) | Z 正方向 = 人体头侧（上） |

RAS 坐标的单位是**毫米（mm）**，不是像素。例如一个体素中心在 RAS 空间中可能是 `(10.5, -23.0, 150.2)` mm。

### 2.3 两种坐标的转换——Affine 矩阵

**IJK → RAS** 的变换由一个 4×4 的 **Affine 矩阵** 描述：

```
| RAS_x |   | m00  m01  m02  m03 |   | I |
| RAS_y | = | m10  m11  m12  m13 | × | J |
| RAS_z |   | m20  m21  m22  m23 |   | K |
|   1   |   |  0    0    0    1  |   | 1 |
```

展开后：

```
RAS_x = m00×I + m01×J + m02×K + m03
RAS_y = m10×I + m11×J + m12×K + m13
RAS_z = m20×I + m21×J + m22×K + m23
```

矩阵中每一列代表一个轴的方向：

```
第0列 [m00, m10, m20] = I 方向在 RAS 中的向量
第1列 [m01, m11, m21] = J 方向在 RAS 中的向量
第2列 [m02, m12, m22] = K 方向在 RAS 中的向量
第3列 [m03, m13, m23] = 原点（偏移）
```

以 `img-3d.nii.gz` 的实际 affine 为例：

```
[-1.316,    0,    0,    0]
[    0, -1.316,    0,    0]
[    0,     0, 1.316,    0]
[    0,     0,     0,    1]
```

这说明：
- I 方向映射到 **-X**（向右取反，变成向左）
- J 方向映射到 **-Y**（向前取反，变成向后）
- K 方向映射到 **+Z**（向上，不变）

这种常见的对角线负值模式是因为 NIfTI 默认使用 RAS 约定。

**反向变换（RAS → IJK）** 使用 affine 矩阵的逆矩阵：

```
I = inv00×RAS_x + inv01×RAS_y + inv02×RAS_z + inv03
J = inv10×RAS_x + inv11×RAS_y + inv12×RAS_z + inv13
K = inv20×RAS_x + inv21×RAS_y + inv22×RAS_z + inv23
```

---

## 三、正交 MPR 渲染——基础中的基础

**MPR** = Multi-Planar Reconstruction（多平面重建），即从 3D 体积中切出互相垂直的标准截面来查看。

### 3.1 三种标准截面

```
          人体坐标系示意（面向前方）
                    S (头)
                    ↑
                    |
              A     |
            (前)←──┼──→ P (后)
                   |
                   ↓
                   I (脚)

横断位 (Axial)    →  XY 平面切片，K=常数，从头向脚看
冠状位 (Coronal)   →  XZ 平面切片，J=常数，从前向后看
矢状位 (Sagittal)  →  YZ 平面切片，I=常数，从右向左看
```

### 3.2 正交渲染的像素映射

jsMedgl 的 `slice-extractor.ts` 负责从体积中提取 2D 切片数据。它直接操作 IJK 索引，不经过 RAS 空间。

**纹理坐标到 IJK 的映射规则**（与 `extractSliceData` 函数一一对应）：

| 视图 | 纹理像素 (x, y) | 对应 IJK | 解剖学含义 |
|------|----------------|----------|-----------|
| **Axial** | texture X | I | 左→右（不反转） |
| **Axial** | texture Y | J（**反转**） | 屏幕顶部 → J=0 = **前（Anterior）** |
| **Coronal** | texture X | I | 左→右 |
| **Coronal** | texture Y | K | 屏幕顶部 → K=0 = **头（Superior）** |
| **Sagittal** | texture X | J | 屏幕左侧 → J=0 = **前（Anterior）** |
| **Sagittal** | texture Y | K | 屏幕顶部 → K=0 = **头（Superior）** |

#### Axial 的 J 反转——一个常见的困惑点

直觉上，J=0 是前（Anterior），放在屏幕顶部看起来很自然，不需要反转。**但反转的真正原因不是解剖方向，而是 WebGL 纹理坐标系的 Y 轴方向。**

这涉及一个关键的图形学知识：

**WebGL 纹理坐标的原点在左下角**，而不是左上角。

```
屏幕坐标系（Canvas）：          WebGL 纹理坐标系：
(0,0)─────────(W,0)             texCoord (0,1)──────(1,1)
  │               │                        ↑ Y 轴正方向
  │   屏幕空间    │                        │
  │               │              (0,0)─────┘──(1,0)
(0,H)─────────(W,H)               纹理坐标原点在左下角
   ↑ Y 轴正方向
```

当我们用 `texImage2D()` 上传一个 Uint8Array 时：
- **data[0] (row 0)** → 纹理坐标 Y=0 → **屏幕底部**
- **data[height-1] (row max)** → 纹理坐标 Y=1 → **屏幕顶部**

这一点非常重要！**texture row 0 不是在屏幕顶部，而是在底部。**

所以在 axial 中，如果不反转：

```
不反转：
  data row 0   → J=0（前）     → 纹理 Y=0 → 屏幕底部 = 前
  data row max → J=max（后）   → 纹理 Y=1 → 屏幕顶部 = 后

  屏幕顶部 = Posterior（后）❌ ← 放射学标准要求顶部是 Anterior（前）
```

反转后：

```
J 反转 (ry = height - 1 - y)：
  data row 0   → J=max（后）   → 纹理 Y=0 → 屏幕底部 = 后
  data row max → J=0（前）     → 纹理 Y=1 → 屏幕顶部 = 前

  屏幕顶部 = Anterior（前）✓
```

```typescript
// axial 中的 J 反转逻辑
const ry = height - 1 - y; // row 0 → ry = height-1 = J最大（后）
sliceData[y * width + x] = this.normalizedData[sliceIndex * d0 * d1 + ry * d0 + x];
```

**一句话总结**：J 反转是为了补偿 WebGL 纹理 Y 轴（向上）和屏幕 Y 轴（向下）方向不一致。不是"把前变后"，而是"让前出现在它该出现的���幕位置——顶部"。

> **那 Coronal 和 Sagittal 为什么不反转？**
>
> 关键看 affine 矩阵第 2 列的方向。以 `img-3d.nii.gz` 为例，`RAS_Z = +1.316 × K`：
> - K 越大 → RAS Z 越大 → 越靠近头（Superior）
> - K 越小 → RAS Z 越小 → 越靠近脚（Inferior）
>
> 所以 K 的递增方向 = 向上 = RAS +Z。
>
> 而 WebGL 纹理 Y 的递增方向也是向上（Y=0 是底部，Y=1 是顶部）。
>
> 两个"向上"天然一致，所以 texture row 0（屏幕底部）→ K=0（偏脚），texture row max（屏幕顶部）→ K=max（偏头），不需要反转。

> **那 Axial 的 J 为什么不一致？**
>
> 因为 affine 第 1 列是负的：`RAS_Y = -1.316 × J`。J 递增 → RAS Y 递减 → 远离前（Anterior）→ 向后（Posterior）。
> 也就是说 J 的递增方向 = 向后，但 WebGL 纹理 Y 递增 = 向上（对应屏幕上前应该在上），方向冲突了，所以必须反转。

---

## 四、Oblique（斜切）渲染——核心问题

### 4.1 什么是 Oblique？

Oblique（斜切）MPR 允许你绕着体积中任意一个点，旋转出一个**非正交**的截面。例如，沿着血管的走向切一刀，看到血管的纵切面——这是正交 MPR 做不到的。

```
正交 MPR（三个面互相垂直）：

        ┌─────┐
        │  A  │  ← Axial（横切）
    ────┼─────┼────
    S   │  C  │       ← Coronal（竖切）
        │  S  │
        └─────┘


Oblique MPR（任意角度）：

        ╱ A ╲
       ╱─────╲    ← 可以绕任意轴倾斜
      ╱   C   ╲
```

### 4.2 斜切平面的数学描述

斜切平面用**平面方程**来描述。在 jsMedgl 中，一个斜切平面由以下参数定义：

```
中心点 C = (cx, cy, cz)   — 共享焦点，在 RAS 空间中
法向量 N = (nx, ny, nz)  — 垂直于平面，单位向量
U 轴   U = (ux, uy, uz)  — 平面上水平方向，单位向量
V 轴   V = (vx, vy, vz)  — 平面上垂直方向，与 U 垂直

约束：N · U = 0，N · V = 0，U · V = 0（三向量两两正交）
```

给定平面上任意一点 P，可以通过下式计算：

```
P = C + u × U + v × V
```

其中 `(u, v)` 是该点相对于平面中心的二维坐标。

### 4.3 斜切渲染的两条路线

这是问题的核心。oblique 渲染有两种截然不同的路径：

**路线 A：正交渲染（已有的 slice-extractor）**

```
屏幕像素 (px, py)
     ↓
直接映射到 IJK 索引
     ↓
读取体素值
```

**路线 B：Oblique 渲染（ObliqueExtractor）**

```
屏幕像素 (px, py)
     ↓
计算 (u, v) 坐标
     ↓
P = C + u×U + v×V     ← 平面坐标 → RAS 坐标
     ↓
通过逆 affine 矩阵
     ↓
得到 IJK 索引
     ↓
三线性插值采样
```

路线 B 的关键在于：**U 轴和 V 轴的方向选择**，直接决定了像素到 IJK 的映射方向。

### 4.4 基向量的方向决定一切

Oblique 渲染的目标是：斜切视图的渲染效果，要与正交视图"感觉一致"——左边还是左边，上边还是上边。

为了做到这一点，Oblique 的 U/V 轴必须与正交渲染的 IJK 遍历方向**一一对应**：

| 正交视图 | 正交纹理遍历 | Oblique 轴 |
|----------|-------------|-----------|
| Axial | texture X → I+（I 增大） | U 轴方向须使 IJK 的 I 随 px 增大而增大 |
| Axial | texture Y → **J 反转** | V 轴方向须使 IJK 的 J 随 py 增大而**减小** |
| Coronal | texture X → I+ | U 轴方向使 I 增大 |
| Coronal | texture Y → K+ | V 轴方向使 K 增大 |
| Sagittal | texture X → J+ | U 轴方向使 J 增大 |
| Sagittal | texture Y → K+ | V 轴方向使 K 增大 |

但这里有一个陷阱：Oblique 经过 **RAS 中转**，而 affine 矩阵的符号会翻转方向！

以 `img-3d.nii.gz` 为例：
- I 方向的 affine 列是 `[-1.316, 0, 0]`（负的）
- 这意味着：RAS +X 方向 ↔ IJK **减小**方向

所以如果直接设 `U = [1, 0, 0]`（RAS +X），会导致 I 随 U 增大而**减小**——左右反了！

### 4.5 解决方案：基向量由 Affine 决定

正确的做法是：**从 affine 矩阵的列向量推导出基向量**，而不是硬编码固定值。

```
Affine 列向量 = I/J/K 方向在 RAS 中的实际方向
```

从 affine 列向量出发，我们选择 U/V 轴，使得经过 `RAS → IJK` 变换后，IJK 分量的变化方向与正交渲染一致：

```
Axial:
  U 轴 = affine 的第0列（归一化）  → dI/du > 0（I 随 U 增大）
  V 轴 = affine 的第1列取负        → dJ/dv < 0（J 随 V 增大而减小 → top 是 Anterior）

Coronal:
  U 轴 = affine 的第0列           → dI/du > 0
  V 轴 = affine 的第2列             → dK/dv > 0（K 随 V 增大）

Sagittal:
  U 轴 = affine 的第1列             → dJ/du > 0（J 随 U 增大）
  V 轴 = affine 的第2列             → dK/dv > 0
```

这样，无论 NIfTI 文件的 affine 矩阵是 `[-s, -s, +s]`、`[+s, +s, +s]` 还是任意方向，oblique 渲染都会与正交渲染保持一致。

---

## 五、像素到体素的完整旅程

以 oblique axial 视图为例，追踪一个像素的完整旅程：

```
屏幕像素 (px=0, py=0)  ← canvas 左上角
     │
     │  归一化到 [-1, +1]
     ↓
(u=-halfW, v=-halfH)  ← 平面坐标系，左上角
     │
     │  P = C + u×U + v×V
     │  其中 U = affine_col0, V = -affine_col1
     ↓
RAS 点
     │
     │  [i, j, k]ᵀ = inverseAffine × RAS
     ↓
IJK 浮点坐标 (i=0.3, j=255.7, k=126.0)
     │
     │  三线性插值
     ↓
体素值（灰度 0-255）
```

### 5.1 三线性插值（Trilinear Interpolation）

当计算出的 IJK 坐标不是整数时，需要在周围 8 个体素之间做加权平均——这就是三线性插值。

```
在三个方向上各做一次线性插值：

Step 1: 在 X 方向插值（c000 → c100, c001 → c101 等）
Step 2: 在 Y 方向插值（c00 → c10）
Step 3: 在 Z 方向插值（c0 → c1）

        k=1 层
       ┌─────┐
  c101 │c111 │ c001
 c001  ├─────┤ c000
       │c100 │
       └─────┘
           k=0 层
```

```typescript
const x0 = Math.floor(i), x1 = x0 + 1;
const y0 = Math.floor(j), y1 = y0 + 1;
const z0 = Math.floor(k), z1 = z0 + 1;

const xf = i - x0, yf = j - y0, zf = k - z0;

const c00 = c000 * (1-xf) + c100 * xf;
const c10 = c010 * (1-xf) + c110 * xf;
const c01 = c001 * (1-xf) + c101 * xf;
const c11 = c011 * (1-xf) + c111 * xf;

const c0 = c00 * (1-yf) + c10 * yf;
const c1 = c01 * (1-yf) + c11 * yf;

value = c0 * (1-zf) + c1 * zf;
```

插值使得倾斜平面上的图像边缘更加平滑，不会出现明显的锯齿。

---

## 六、架构总览

```
packages/renderer-2d/src/
├── oblique/
│   ├── math.ts            ← 所有数学工具
│   │   ├── getBasisForOrientation()  基向量推导（修复后的核心）
│   │   ├── orthonormalizeBasis()      Gram-Schmidt 正交化
│   │   ├── rotateBasis()              四元数旋转
│   │   ├── planeIntersection()         两平面交线
│   │   ├── projectBoundingBox()        投影尺寸计算
│   │   └── applyAffine() / applyInverseAffine()  坐标变换
│   ├── ObliquePlane.ts      ← 斜切平面几何管理
│   │   ├── 维护焦点（RAS 空间）
│   │   ├── 维护旋转四元数
│   │   ├── getBasis() / setRotation() 等方法
│   │   └── getComputed() → 返回 ObliquePlaneComputed
│   ├── ObliqueExtractor.ts  ← CPU 斜切面提取
│   │   ├── extractSlice()              完整分辨率提取
│   │   ├── extractSliceDownsampled()   降采样预览
│   │   ├── trilinearSample()           三线性插值
│   │   └── LRU 缓存（最多 20 条）
│   ├── types.ts             ← 类型定义
│   │   ├── ObliqueBasis { normal, uAxis, vAxis }
│   │   ├── ObliquePlaneComputed { center, basis, width, height }
│   │   └── ObliqueMPRState { focalPoint, planes }
│   └── index.ts             ← 统一导出
│
├── slice-extractor.ts       ← WebGL 正交切片提取
│   ├── extractSliceData()   ← IJK 直接索引，J 反转
│   ├── WebGL 纹理上传
│   └── 纹理缓存（最多 30 条）
│
└── webgl-slice-view.ts      ← 渲染引擎（正交 + 斜切）
    ├── setObliquePlane()     ← 注入斜切模式
    ├── uploadObliqueTexture() ← CPU 数据上传为 WebGL 纹理
    └── render()              ← 统一渲染管线
```

**渲染管线**（`webgl-slice-view.ts` 的 `render()` 方法）：

```
体积数据 (Uint8Array, 归一化 0-255)
     │
     ├── [正交模式]
     │      slice-extractor.extractSlice()
     │      → WebGL 纹理（GPU 切片）
     │
     └── [斜切模式]
            ObliqueExtractor.extractSlice()
            → CPU Uint8Array → WebGL 纹理

WebGL 纹理
     ↓
着色器：window/level 调整（灰度窗宽窗位）
     ↓
Canvas 像素 → 最终画面
```

---

## 七、修复记录

### 7.1 问题描述

Oblique 模式下，axial 视图上下颠倒（顶部显示床板而非头部），coronal 和 sagittal 视图左右翻转。

### 7.2 根因分析

`getBasisForOrientation()` 函数之前**硬编码**基向量为固定方向：

```typescript
// 修复前（错误）
case 'axial':
  return {
    uAxis: [1, 0, 0],   // 始终 = RAS +X
    vAxis: [0, -1, 0],  // 始终 = RAS -Y
  };
```

但 affine 矩阵的列向量方向取决于 NIfTI 文件的存储方式。当列向量为负值时（如 `[-1.316, 0, 0]`），硬编码的 `[1, 0, 0]` 方向就反了：

```
RAS +X 方向 ↔ IJK I 减小（因为 affine 对角线是负的）
```

正交渲染直接操作 IJK 索引不受影响，但 oblique 经过 RAS 中转，方向全部反了。

### 7.3 修复方案

修改 `getBasisForOrientation()` 为动态计算，根据 affine 矩阵的列向量推导：

```typescript
// 修复后（正确）
function getBasisForOrientation(orientation, affine) {
  const col0 = normalize(affineColumn(affine, 0)); // I 方向的实际 RAS 向量
  const col1 = normalize(affineColumn(affine, 1)); // J 方向
  const col2 = normalize(affineColumn(affine, 2)); // K 方向

  switch (orientation) {
    case 'axial':
      return {
        normal: col2,
        uAxis: col0,                           // 使 dI/du > 0
        vAxis: negate(col1),                    // 使 dJ/dv < 0（J reversal）
      };
    // ...
  }
}
```

### 7.4 涉及文件

| 文件 | 改动 |
|------|------|
| `packages/renderer-2d/src/oblique/math.ts` | `getBasisForOrientation()` 增加 `affine` 参数，改为动态计算 |
| `packages/renderer-2d/src/oblique/ObliquePlane.ts` | 构造函数和旋转方法传入 `this.affine` |
| `tests/unit/oblique-plane.test.ts` | 添加 identity/negative affine 两种情况的测试覆盖 |

---

## 八、名词速查表

| 名词 | 解释 |
|------|------|
| **Voxel / 体素** | 3D 图像的最小单位，每个体素存储一个数值 |
| **IJK** | 体素的整数索引坐标（列、行、层） |
| **RAS** | 物理空间坐标系（Right-Anterior-Superior），单位 mm |
| **Affine 矩阵** | 4×4 变换矩阵，描述 IJK → RAS 的映射关系 |
| **Oblique** | 斜切，允许非正交的任意角度截面 |
| **MPR** | Multi-Planar Reconstruction，多平面重建 |
| **Trilinear** | 三线性插值，在 8 个体素之间做加权平均 |
| **Gram-Schmidt** | 一种将基向量正交化的数学方法 |
| **Quaternion / 四元数** | 表示三维旋转的数学工具，比欧拉角更稳定 |
| **Window/Level** | 窗宽窗位，调整图像对比度和亮度 |
| **LPS** | Left-Posterior-Superior，DICOM 标准的坐标系（LPS = -RAS） |
