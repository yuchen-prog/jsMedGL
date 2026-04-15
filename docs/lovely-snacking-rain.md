# Plan: `@jsmedgl/parser-dicom` — DICOM 文件解析器包

## Context

根据 PRD v1.0/v2.0（§6.1.1），jsMedgl 需要支持原始 DICOM 文件加载与解析。目前仅有 `@jsmedgl/parser-nifti`，renderer-2d/renderer-3d 直接依赖 `NiftiVolume` 类型。

**目标**：新建 `@jsmedgl/parser-dicom` 包，在 `@jsmedgl/core` 中定义统一的 `Volume` 接口，使 renderer 无需修改即可渲染 DICOM 数据。支持单文件和多文件序列解析。MVP 不含 DICOMweb。

---

## 第一步：在 `@jsmedgl/core` 定义统一 Volume 接口

**修改文件**: `packages/core/src/types.ts`, `packages/core/src/index.ts`

renderer 实际访问的字段（通过代码分析）：
- `volume.data` → ArrayBuffer（原始体素字节）
- `volume.header.datatype` → 传给 `getDataTypeSize()` / `readVoxel()`（NIfTI datatype 枚举值）
- `volume.dimensions` → `[number, number, number]`
- `volume.spacing` → `[number, number, number]`
- `volume.affine` → `number[]`（4x4 IJK→RAS）
- `volume.inverseAffine` → `number[]`
- `volume.header` → `ObliquePlane` 传给 `extractAffineMatrix()`（NiftiHeader 特有）

**策略**：定义 `Volume` 接口为最小公共字段，`NiftiVolume` 和 `DicomVolume` 都扩展它。renderer 逐步迁移为依赖 `Volume` 而非 `NiftiVolume`。

```typescript
// packages/core/src/types.ts 新增

/**
 * 统一体数据接口 — renderer 只依赖此接口
 */
export interface Volume {
  data: ArrayBuffer;
  dimensions: [number, number, number];
  spacing: [number, number, number];
  affine: number[];           // 4x4 IJK→RAS
  inverseAffine: number[];
  /** 用于 renderer 归一化。NIfTI 用原始 datatype code；DICOM 用映射后的等价 code */
  datatype: number;
}
```

同时让 `NiftiVolume` 扩展 `Volume`（在 parser-nifti 中添加 `datatype` 便利字段，或通过类型兼容）。

**关键兼容性问题**：`SliceExtractor` 和 `VolumeTextureManager` 使用 `getDataTypeSize(volume.header.datatype)` 和 `readVoxel(data, offset, volume.header.datatype)`。我们需要在统一接口中暴露 `datatype` 字段（顶层而非嵌套在 header 中），或在迁移期让 renderer 继续接受 NiftiVolume 的 header 结构。

**最小改动方案**：renderer 暂不改动。parser-dicom 的输出类型 `DicomVolume` 结构与 `NiftiVolume` 兼容（包含 `header.datatype`），renderer 通过 TypeScript structural typing 自动兼容。

---

## 第二步：创建 `@jsmedgl/parser-dicom` 包

### 2.1 目录结构

```
packages/parser-dicom/
├── src/
│   ├── index.ts                    # 统一导出
│   ├── types.ts                    # DICOM 类型定义
│   ├── parser.ts                   # 主解析入口（单文件 + 多文件序列）
│   ├── tag-reader.ts               # DICOM Tag 读取（Part 5 §7）
│   ├── vr-reader.ts                # Value Representation 解码
│   ├── pixel-data.ts               # 像素数据解码（OB/OW + rescale）
│   ├── transfer-syntax.ts          # Transfer Syntax 映射与解码器选择
│   ├── lps-coordinate.ts           # LPS 坐标 → Affine 构建
│   ├── series-builder.ts           # 多文件序列排序与合并为 3D volume
│   └── utils.ts                    # 字节序、字符串、常量
├── package.json
└── tsconfig.json
```

### 2.2 类型定义 (`types.ts`)

```typescript
/** DICOM Tag (group, element) */
export interface DicomTag {
  group: number;
  element: number;
}

/** Transfer Syntax UIDs — MVP 支持列表 */
export const TRANSFER_SYNTAX = {
  IMPLICIT_VR_LE: '1.2.840.10008.1.2',           // CT/MRI 最常见
  EXPLICIT_VR_LE: '1.2.840.10008.1.2.1',
  EXPLICIT_VR_BE: '1.2.840.10008.1.2.2',
  DEFLATE:        '1.2.840.10008.1.2.5',           // zlib deflate
  JPEG_BASELINE:  '1.2.840.10008.1.2.4.50',       // 8-bit only
} as const;

/** DICOM 元素 */
export interface DicomElement {
  tag: DicomTag;
  vr: string;        // Value Representation (2 chars)
  length: number;
  value: unknown;
}

/** 核心 DICOM 头信息（渲染所需） */
export interface DicomHeader {
  rows: number;
  columns: number;
  bitsAllocated: number;
  bitsStored: number;
  highBit: number;
  pixelRepresentation: number;     // 0=unsigned, 1=signed
  rescaleSlope: number;
  rescaleIntercept: number;
  windowCenter: number;
  windowWidth: number;
  imagePositionPatient: [number, number, number];
  imageOrientationPatient: [number, number, number, number, number, number];
  pixelSpacing: [number, number];
  sliceThickness: number;
  modality: string;
  studyDate: string;
  patientName: string;
  seriesInstanceUid: string;
  sopInstanceUid: string;
  studyInstanceUid: string;
  seriesNumber: number;
  instanceNumber: number;
  transferSyntaxUid: string;
  /** 映射到 NIfTI 兼容的 datatype code，供 renderer 使用 */
  datatype: number;
}

/** 解析后的 DICOM Volume（结构与 NiftiVolume 兼容） */
export interface DicomVolume {
  header: DicomHeader;
  data: ArrayBuffer;
  dimensions: [number, number, number];
  spacing: [number, number, number];
  affine: number[];
  inverseAffine: number[];
  warnings?: string[];
  // DICOM 特有的元信息
  patientName?: string;
  studyDate?: string;
  modality?: string;
  seriesDescription?: string;
}

export interface DicomParserOptions {
  strictMode?: boolean;
  /** 自定义不支持的 Transfer Syntax 处理 */
  onUnsupportedSyntax?: (uid: string) => 'skip' | 'throw' | 'raw';
}
```

### 2.3 核心模块

#### `tag-reader.ts` — DICOM Tag 读取
- 跳过 128 字节 preamble + 4 字节 "DICM" magic
- 支持 Explicit VR（读取 2 字节 VR 字符）和 Implicit VR（VR 从字典查）
- 返回 `Map<string, DicomElement>`

#### `vr-reader.ts` — VR 解码
- DS (Decimal String) → number
- IS (Integer String) → number
- US/SS → uint16/int16
- FL/FD → float32/float64
- OB/OW → Uint8Array/Uint16Array（像素数据）
- UI → string（UID）
- PN → string（患者姓名）
- DA/TM → string
- LO/SH/CS → string
- SQ → 跳过（MVP 不需要嵌套序列）

#### `pixel-data.ts` — 像素数据解码
- 从 Tag (7FE0,0010) 提取像素数据
- 根据 bitsAllocated/bitsStored/pixelRepresentation 确定输出格式
- 应用 rescaleSlope/rescaleIntercept（HU 转换）
- 输出 ArrayBuffer（与 NIfTI 的 data 字段格式兼容）

#### `transfer-syntax.ts` — Transfer Syntax 选择
- Implicit VR Little Endian (1.2.840.10008.1.2) — 最常见
- Explicit VR Little Endian (1.2.840.10008.1.2.1)
- Explicit VR Big Endian (1.2.840.10008.1.2.2) — 罕见但需处理字节序
- Deflate (1.2.840.10008.1.2.5) — 用 Decompress (pako)
- JPEG Baseline (1.2.840.10008.1.2.4.50) — 8-bit JPEG 解码
- 不支持的 → 根据 onUnsupportedSyntax 回调处理

#### `lps-coordinate.ts` — LPS → Affine
- 从 ImageOrientationPatient (0020,0037) 构建行列方向余弦
- 从 ImagePositionPatient (0020,0032) 获取原点
- 从 PixelSpacing (0028,0030) 获取间距
- 从 SliceThickness (0018,0050) 获取层间距
- 构建 4x4 affine: IJK → LPS
- 转换为 IJK → RAS（与 NIfTI 一致）：negate X, Y 列

```typescript
export function buildDicomAffine(
  ipp: [number, number, number],
  iop: [number, number, number, number, number, number],
  pixelSpacing: [number, number],
  sliceThickness: number,
  sliceIndex: number
): { affine: number[]; inverseAffine: number[] };
```

#### `series-builder.ts` — 多文件序列合并
```typescript
export async function parseDicomSeries(
  files: (ArrayBuffer | File | Blob)[],
  options?: DicomParserOptions
): Promise<DicomVolume>;
```
- 解析每个文件的 header
- 按 SeriesInstanceUID 分组
- 同一序列内按 InstanceNumber / SliceLocation / ImagePositionPatient[2] 排序
- 合并像素数据为 3D ArrayBuffer
- 用第一个切片的 IPP + 最后一个切片的 IPP 计算层间距（比 SliceThickness 更可靠）

#### `parser.ts` — 主入口
```typescript
/** 解析单个 DICOM 文件（单帧或多帧） */
export async function parseDicom(
  source: ArrayBuffer | File | Blob,
  options?: DicomParserOptions
): Promise<DicomVolume>;

/** 解析多个 DICOM 文件，按序列合并为 3D volume */
export async function parseDicomSeries(
  files: (ArrayBuffer | File | Blob)[],
  options?: DicomParserOptions
): Promise<DicomVolume>;

/** 仅解析 header（不加载像素数据） */
export async function parseDicomHeader(
  source: ArrayBuffer | File | Blob
): Promise<DicomHeader>;

/** 创建可复用解析器实例 */
export function createDicomParser(options?: DicomParserOptions);
```

### 2.4 依赖

```json
{
  "dependencies": {
    "@jsmedgl/core": "workspace:*"
  }
}
```

仅依赖 core 中的 `invertMatrix()` 和 `lpsToRas()` 等坐标工具。**不引入 pako**（DICOM deflate 场景极少，使用浏览器原生 `DecompressionStream` API 替代）。

---

## 第三步：使 renderer 兼容

### 3.1 关键兼容性处理

renderer 通过 structural typing 消费 volume。`DicomVolume` 的 `header.datatype` 字段映射到 NIfTI datatype code：

| DICOM bitsAllocated + pixelRepresentation | 映射到 NIfTI datatype |
|:---|:---|
| 8-bit unsigned (bitsAllocated=8, pixelRep=0) | UINT8 = 2 |
| 16-bit signed (bitsAllocated=16, pixelRep=1) | INT16 = 4 |
| 16-bit unsigned (bitsAllocated=16, pixelRep=0) | UINT16 = 512 |
| 32-bit signed (bitsAllocated=32, pixelRep=1) | INT32 = 8 |
| 32-bit unsigned (bitsAllocated=32, pixelRep=0) | UINT32 = 768 |

这样 renderer 的 `getDataTypeSize(volume.header.datatype)` 和 `readVoxel()` 无需任何修改。

### 3.2 ObliquePlane 兼容

`ObliquePlane` 调用 `extractAffineMatrix(volume.header)`，这个函数读取 `NiftiHeader` 特有字段（sform_code, qform_code, sform 等）。DICOM 的 affine 在 parser 中已计算好，直接存入 `volume.affine`。

解决方案：在 `ObliquePlane` 中改为优先使用 `volume.affine`（如果存在），而非从 header 重新计算。这是一个小改动，影响 `renderer-2d/src/oblique/ObliquePlane.ts:45`。

---

## 第四步：集成与验证

### 4.1 更新配置
- `packages/parser-dicom/package.json` — 新建
- `packages/parser-dicom/tsconfig.json` — 新建
- `packages/core/src/types.ts` — 添加 `Volume` 接口
- `packages/core/src/index.ts` — 导出 `Volume`
- `tsconfig.json` — 添加 `@jsmedgl/parser-dicom` 路径别名

### 4.2 验证清单
1. `pnpm build` — 所有包编译通过
2. `pnpm test` — 现有测试不被破坏
3. parser-dicom 单元测试：
   - VR 读取（DS/IS/US/SS/FL/OB/OW/UI/PN）
   - Implicit VR Little Endian 解析
   - Explicit VR Little Endian 解析
   - Affine 构建（LPS → RAS）
   - 多文件序列排序
   - datatype 映射正确性
4. 集成测试：用真实 CT DICOM 文件验证渲染正确性

---

## 实施步骤（有序）

| # | 任务 | 涉及文件 | 状态 |
|:--|:-----|:--------|:-----|
| 1 | 在 core 中定义 `Volume` 接口 | `core/src/types.ts`, `core/src/index.ts` | ✅ |
| 2 | 创建 parser-dicom 目录结构 | `packages/parser-dicom/` | ✅ |
| 3 | 实现 `types.ts` | 类型 + Transfer Syntax 常量 | ✅ |
| 4 | 实现 `utils.ts` | 字节序、字符串解析、DICOM 字典常量 | ✅ |
| 5 | 实现 `tag-reader.ts` | Tag 读取（Explicit/Implicit VR） | ✅ |
| 6 | 实现 `vr-reader.ts` | Value Representation 解码 | ✅ |
| 7 | 实现 `transfer-syntax.ts` | TS 映射与解码器选择 | ✅ |
| 8 | 实现 `pixel-data.ts` | 像素提取 + rescale | ✅ |
| 9 | 实现 `lps-coordinate.ts` | Affine 构建 | ✅ |
| 10 | 实现 `series-builder.ts` | 多文件排序合并 | ✅ |
| 11 | 实现 `parser.ts` | 主入口 | ✅ |
| 12 | 实现 `index.ts` | 统一导出 | ✅ |
| 13 | 创建 package.json + tsconfig.json | 包配置 | ✅ |
| 14 | 更新根 tsconfig.json | 添加路径别名 | ✅ |
| 15 | 修复 ObliquePlane affine 兼容 | `renderer-2d/src/oblique/ObliquePlane.ts:45` | ✅ |
| 16 | 编写单元测试 | `tests/unit/dicom.test.ts` | ✅ |

**验证结果**: `pnpm build` ✅ `pnpm test` ✅ (424 tests)
