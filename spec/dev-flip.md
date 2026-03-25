# 坐标系与渲染翻转规范

## 坐标系基础

### IJK 体积坐标系
NIfTI 体积数据使用 3D 索引坐标系 (I, J, K)：
- **I** → X 轴（列索引）：0 = 左 (L), max = 右 (R)
- **J** → Y 轴（行索引）：0 = 前 (Anterior), max = 后 (Posterior)
- **K** → Z 轴（层索引）：0 = 底 (Inferior), max = 顶 (Superior)

NIfTI 数据以行主序 (row-major) 存储在内存中，线性索引为 `i + j*D0 + k*D0*D1`。

### Canvas 像素坐标系
Canvas 容器左上角为原点 (0, 0)，Y 轴向下增长：
- `localX = 0` → Canvas 左边缘
- `localX = width` → Canvas 右边缘
- `localY = 0` → Canvas **顶部**（CSS top）
- `localY = height` → Canvas **底部**（CSS bottom）

### 显示区域 (displayRect)
图像在 Canvas 中居中显示，`displayRect` 描述图像区域相对于 Canvas 左上角的位置：
```ts
displayRect = { x, y, width, height }
```

---

## 渲染管线

```
Volume Data (IJK)
      │
      ▼
slice-extractor.ts
  extractSliceData()
  ─────────────────────────────
  · Axial:   提取 I×J 平面, J 轴反转
  · Coronal: 提取 I×K 平面, K 轴不反转
  · Sagittal: 提取 J×K 平面, J/K 轴不反转
      │
      ▼
WebGL Texture (行主序上传)
  · texture[row][col] 对应 (y=0 为底部行, y=max 为顶部行)
  · WebGL 默认行为: texture row 0 → canvas 底部
      │
      ▼
Fragment Shader
  直接采样 v_texCoord, 无 Y-flip
  (早期版本曾有 Y-flip, 已移除)
      │
      ▼
Canvas 像素 (最终画面)
```

---

## 各视图纹理映射与轴向处理

### Axial（横状位）
提取 K=常数平面，显示头/脚方向的横截面。

| 纹理坐标 | IJK | 视觉位置 | 标签 |
|----------|-----|----------|------|
| row 0 | J = D1-1 (Posterior) | Canvas **顶部** | A |
| row D1-1 | J = 0 (Anterior) | Canvas **底部** | P |

- **纹理提取**：J 轴**反转** (`ry = height - 1 - y`)
- **Shader**：无 Y-flip
- **mouseToIJK**：无 Y-flip
- **crosshairToPixels**：无 Y-flip

### Coronal（冠状位）
提取 J=常数平面，显示前/后方向的正交切面。

| 纹理坐标 | IJK | 视觉位置 | 标签 |
|----------|-----|----------|------|
| row 0 | K = 0 (Superior) | Canvas **顶部** | S |
| row D2-1 | K = D2-1 (Inferior) | Canvas **底部** | I |

- **纹理提取**：K 轴**不反转**
- **Shader**：无 Y-flip
- **mouseToIJK**：无 Y-flip
- **crosshairToPixels**：无 Y-flip

### Sagittal（矢状位）
提取 I=常数平面，显示左/右方向的正交切面。

| 纹理坐标 | IJK | 视觉位置 | 标签 |
|----------|-----|----------|------|
| col 0 | J = 0 (Anterior) | Canvas **左侧** | A |
| col D1-1 | J = D1-1 (Posterior) | Canvas **右侧** | P |
| row 0 | K = 0 (Superior) | Canvas **顶部** | S |
| row D2-1 | K = D2-1 (Inferior) | Canvas **底部** | I |

- **纹理提取**：J 轴和 K 轴都**不反转**
- **Shader**：无 Y-flip
- **mouseToIJK**：无 Y-flip
- **crosshairToPixels**：无 Y-flip

---

## 坐标转换

### mouseToIJK（鼠标 → 体积坐标）
位于 `packages/renderer-2d/src/webgl-slice-view.ts`。

将 Canvas 像素坐标转换为体积 IJK 索引：

```ts
nx = (localX - displayRect.x) / displayRect.width
ny = (localY - displayRect.y) / displayRect.height

// Axial
i = floor(nx * D0)
j = floor(ny * D1)
k = sliceIndex

// Coronal
i = floor(nx * D0)
j = sliceIndex
k = floor(ny * D2)

// Sagittal
i = sliceIndex
j = floor(nx * D1)
k = floor(ny * D2)
```

注意：`localX/localY` 必须是相对于 Canvas 容器的坐标（由 React 层通过 `wrapper.getBoundingClientRect()` 计算）。

### crosshairToPixels（体积坐标 → 鼠标）
位于 `apps/demo/src/App.tsx` 的 `crosshairToPixels` 函数。

将体积 IJK 坐标转换为十字线在 Canvas 中的像素位置：

```ts
// Axial
sliceI = ijk.i
sliceJ = ijk.j

// Coronal
sliceI = ijk.i
sliceJ = ijk.k

// Sagittal
sliceI = ijk.j
sliceJ = ijk.k

nx = sliceI / (sliceW - 1)
ny = sliceJ / (sliceH - 1)

px = displayRect.x + nx * displayRect.width
py = displayRect.y + ny * displayRect.height
```

注意：`displayRect` 通过 `view.getDisplayRect()` 获取，保证与 `mouseToIJK` 使用同一坐标系。

---

## Shader 演变历史

### v1（早期版本）
```glsl
vec2 texCoord = vec2(v_texCoord.x, 1.0 - v_texCoord.y);  // Y-flip
```
使用 Y-flip 补偿 WebGL 纹理坐标系和 Canvas 坐标系的差异。

### v2（移除 Y-flip）
```glsl
float intensity = texture2D(u_texture, v_texCoord).r * 255.0;  // 直接采样
```
移除 Shader 中的 Y-flip，改为在纹理提取阶段处理轴向映射。

**移除原因**：Shader Y-flip 无法区分不同视图的轴向需求，导致 Axial/Coronal/Sagittal 需要不同的处理策略。将轴向处理前移到数据提取层更清晰。

---

## 修改记录

### 2026-03-25 坐标系与翻转重构
- 移除 Shader 中的 Y-flip（`texCoord.y = 1.0 - v_texCoord.y`）
- Axial：纹理提取时反转 J 轴，使 A 在上、P 在下
- Coronal：纹理提取时不反转 K 轴，S 在上、I 在下
- Sagittal：纹理提取时不反转 J/K 轴，A 在左、P 在右、S 在上、I 在下
- React 层移除 `innerHTML = ''`，避免清空 React 渲染的 overlay
- 统一坐标系：鼠标坐标和十字线坐标均以 Canvas 容器为参考系

### 涉及文件
- `packages/renderer-2d/src/webgl-slice-view.ts`
- `packages/renderer-2d/src/slice-extractor.ts`
- `apps/demo/src/App.tsx`
- `apps/demo/src/styles.css`
