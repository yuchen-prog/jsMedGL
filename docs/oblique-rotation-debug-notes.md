# Oblique MPR 旋转交互 — 调查文档

## 问题

旋转十字线手柄时，偶现图像不刷新的现象：displayRect 宽高在变化（canvas 缩放），但切片图像内容不变。

## 已排除的原因

### 1. ObliqueExtractor 缓存命中旧数据 ✅ 已修复

**现象**：旋转一周后回到近似初始角度，缓存 key 碰撞导致返回旧图像。

**原因**：缓存 key 只包含 `center`、`normal`、`width/height`，不包含 `uAxis/vAxis`。

**修复**：
- 缓存 key 加入 `uAxis` 和 `vAxis` 的量化值
- 旋转和焦点变化时调用 `extractor.clearCache()` 作为安全保障

### 2. React StrictMode 导致 WebGL GL ERROR 1282 ⚠️ 已知问题

**现象**：初始化时出现 `WebGL: INVALID_OPERATION: useProgram: attempt to use a deleted object`，以及 `stale GL error before render: 1282`。

**原因**：React 18 StrictMode 在开发模式下 double-invoke `useEffect`：
1. 第1次 effect → 创建 view1（WebGL program1）
2. cleanup → `view1.dispose()` 删除 program1
3. 第2次 effect → 创建 view2（新 canvas + 新 gl context + program2）

第1次 cleanup 中的 `deleteProgram(program1)` 会产生 GL ERROR 1282，此错误驻留在错误队列中，被后续 `getError()` 捕获。**但由于 view2 有独立的 gl context，此错误不影响 view2 的渲染。**

**结论**：这是 dev-mode only 的 warning，生产构建（无 StrictMode）不会出现。不影响功能。

### 3. 数据层 / WebGL 层问题 ✅ 已排除

通过诊断日志确认：
- `ObliqueExtractor.extractSlice()` 每次返回新数据（CACHE MISS，`nonzero` 数量变化）
- `gl.texImage2D()` 每次上传新纹理
- `gl.drawArrays()` 不产生新错误（drain stale error 后 checkErr 全部正常）
- `gl.readPixels()` 返回正确的像素值（非 0,0,0,0）
- DOM 中没有 stale canvas 覆盖

### 4. React memo 阻止重渲染 ✅ 已排除

`intersections` props 每次 `renderTick` 变化时由 `useMemo` 返回新对象，`onRotateOtherPlanes` 是内联函数，`memo` 不会阻止重渲染。

## 未解决：偶现图像不刷新

### 现象

- 拖动旋转手柄过程中，偶尔出现图像不更新
- displayRect 宽高在变化（canvas 区域缩放），但内容不变
- 偶发，非必现

### 已验证的数据流

```
mousemove → handleRotateOtherPlanes()
  → plane.applyRotationDelta(deltaQ)
  → extractor.clearCache()
  → setRenderTick(t+1)
    → useMemo 重新计算 intersections
    → ObliqueSliceViewer 重渲染（memo 不阻止）
      → useEffect（无依赖）执行
        → plane.getComputed() 返回新参数 ✓
        → extractor.extractSlice() 返回新数据 ✓
        → view.setObliquePlane() → render()
          → gl.texImage2D() 上传新纹理 ✓
          → gl.drawArrays() 成功 ✓
          → gl.readPixels() 返回正确像素 ✓
```

所有环节都正确，但视觉上图像没变。

### 可能的方向（TODO）

1. **浏览器合成时序**：三个 WebGL context 在同一个 React 批处理中同步 draw，浏览器可能延迟合成。可尝试 `requestAnimationFrame` 延迟 render 调用。

2. **GPU 命令缓冲区 flush**：WebGL draw 命令可能被缓存在 GPU 侧，未及时提交到显示。可在 draw 后加 `gl.flush()` 验证。

3. **Canvas 尺寸变化触发机制**：当 `drawW/drawH` 几乎不变（差 1-2px）时，浏览器可能认为 canvas 内容没变而跳过合成。

4. **`preserveDrawingBuffer` 交互**：多个 canvas 同时设置 `preserveDrawingBuffer: true`，在高频更新场景下可能有未定义行为。

5. **CPU 提取性能**：`extractSlice` 在主线程上做三线性插值（337×400+ 像素），高频 mousemove 可能导致帧丢失。可考虑 Web Worker 或降采样预览。

### 建议的调试步骤

1. 在 `setObliquePlane` 中用 `requestAnimationFrame` 包裹 `render()`，避免同步 draw
2. 在 `drawArrays` 后加 `gl.flush()` 强制提交
3. 用 Chrome DevTools → Rendering → Paint flashing 确认浏览器是否跳过了 paint
4. 对比连续两帧 `readPixels` 的结果，确认 backbuffer 内容确实不同
