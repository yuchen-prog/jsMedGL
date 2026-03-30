// ObliqueExtractor — CPU-based oblique slice extraction with trilinear interpolation

import type { NiftiVolume } from '@jsmedgl/parser-nifti';
import { getDataTypeSize, readVoxel } from '@jsmedgl/parser-nifti';
import type { ObliquePlaneComputed } from './types';

export interface ObliqueExtractorOptions {
  /** NIfTI 体积数据 */
  volume: NiftiVolume;
  /**
   * 预归一化的体素数据 [0, 255]。
   * 如果不提供，则从 volume 自行归一化。
   * 传入已归一化的数据可避免重复计算。
   */
  normalizedData?: Uint8Array;
}

/**
 * 斜切面提取器
 *
 * 负责从 3D 体积中提取任意朝向的 2D 斜切面。
 * 使用三线性插值（trilinear interpolation）进行采样。
 *
 * 性能优化：
 * - 接受预归一化的 Uint8Array，避免重复归一化
 * - 纹理缓存：相同平面参数的结果被缓存
 * - RAS → IJK 变换内联，避免函数调用开销
 */
export class ObliqueExtractor {
  private volume: NiftiVolume;
  private normalizedData: Uint8Array;
  private dimensions: [number, number, number];
  // Cache key → { data, width, height }
  private cache: Map<string, { data: Uint8Array; width: number; height: number }> = new Map();
  private cacheMaxSize = 20;

  constructor(options: ObliqueExtractorOptions) {
    this.volume = options.volume;
    this.dimensions = options.volume.dimensions as [number, number, number];

    if (options.normalizedData) {
      // Fast path: use pre-normalized data (from SliceExtractor)
      this.normalizedData = options.normalizedData;
    } else {
      // Slow path: normalize ourselves
      this.normalizedData = this.normalizeVolumeData();
    }
  }

  /**
   * 将体积数据归一化到 Uint8Array [0, 255]
   */
  private normalizeVolumeData(): Uint8Array {
    const { data, header } = this.volume;
    const datatype = header.datatype;
    const byteSize = getDataTypeSize(datatype);
    if (byteSize === 0) {
      throw new Error(`Unsupported datatype for oblique extraction: ${datatype}`);
    }

    const numVoxels = data.byteLength / byteSize;

    // Find min/max via sampling
    let vMin = Infinity, vMax = -Infinity;
    const step = Math.max(1, Math.floor(numVoxels / 10000));
    for (let i = 0; i < numVoxels; i += step) {
      const v = readVoxel(data, i * byteSize, datatype);
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
    const range = vMax - vMin;

    // Normalize all data
    const normalized = new Uint8Array(numVoxels);
    for (let i = 0; i < numVoxels; i++) {
      const v = readVoxel(data, i * byteSize, datatype);
      let n = range > 0
        ? Math.round(((v - vMin) / range) * 255)
        : (v > 0 ? 255 : 0);
      normalized[i] = Math.max(0, Math.min(255, n));
    }
    return normalized;
  }

  /**
   * 获取归一化后的数据（Uint8Array）
   */
  getNormalizedData(): Uint8Array {
    return this.normalizedData;
  }

  /**
   * 三线性插值采样（内联版，避免函数调用开销）
   */
  trilinearSample(ijk: [number, number, number]): number {
    const [x, y, z] = ijk;
    const [dx, dy, dz] = this.dimensions;

    // 边界检查：完全越界返回 0
    if (x < -0.5 || x >= dx - 0.5 || y < -0.5 || y >= dy - 0.5 || z < -0.5 || z >= dz - 0.5) {
      return 0;
    }

    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const z0 = Math.floor(z);
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    const z1 = z0 + 1;

    const xf = x - x0;
    const yf = y - y0;
    const zf = z - z0;

    const c000 = this.sv(x0, y0, z0);
    const c100 = this.sv(x1, y0, z0);
    const c010 = this.sv(x0, y1, z0);
    const c110 = this.sv(x1, y1, z0);
    const c001 = this.sv(x0, y0, z1);
    const c101 = this.sv(x1, y0, z1);
    const c011 = this.sv(x0, y1, z1);
    const c111 = this.sv(x1, y1, z1);

    const c00 = c000 * (1 - xf) + c100 * xf;
    const c10 = c010 * (1 - xf) + c110 * xf;
    const c01 = c001 * (1 - xf) + c101 * xf;
    const c11 = c011 * (1 - xf) + c111 * xf;

    const c0 = c00 * (1 - yf) + c10 * yf;
    const c1 = c01 * (1 - yf) + c11 * yf;

    return c0 * (1 - zf) + c1 * zf;
  }

  /** 内联采样：越界返回 0 */
  private sv(i: number, j: number, k: number): number {
    const [dx, dy] = this.dimensions;
    if (i < 0 || i >= dx || j < 0 || j >= dy || k < 0 || k >= this.dimensions[2]) {
      return 0;
    }
    return this.normalizedData[k * dx * dy + j * dx + i];
  }

  /**
   * 生成缓存 key（基于中心点 + 基向量方向）
   */
  private cacheKey(plane: ObliquePlaneComputed): string {
    const c = plane.center;
    const b = plane.basis;
    // 量化到 0.5mm 精度，避免浮点精度问题
    return `${Math.round(c[0]*2)}:${Math.round(c[1]*2)}:${Math.round(c[2]*2)}` +
           `|${Math.round(b.normal[0]*100)}:${Math.round(b.normal[1]*100)}:${Math.round(b.normal[2]*100)}` +
           `|${plane.width}:${plane.height}`;
  }

  /**
   * 提取完整的斜切面
   *
   * @param plane - 计算后的斜切平面参数
   * @returns Uint8Array (width * height)
   */
  extractSlice(plane: ObliquePlaneComputed): { data: Uint8Array; width: number; height: number } {
    return this.extractSliceDownsampled(plane, 1);
  }

  /**
   * 提取降采样的斜切面（交互预览用）
   *
   * @param plane - 计算后的斜切平面参数
   * @param scale - 降采样比例 (0 < scale <= 1)
   * @returns 降采样后的图像数据
   */
  extractSliceDownsampled(
    plane: ObliquePlaneComputed,
    scale: number
  ): { data: Uint8Array; width: number; height: number } {
    const { width: fullW, height: fullH } = plane;

    // 降采样 key（区分 scale）
    const scaleKey = `${this.cacheKey(plane)}@${scale}`;
    if (this.cache.has(scaleKey)) {
      return this.cache.get(scaleKey)!;
    }

    const outW = Math.max(1, Math.round(fullW * scale));
    const outH = Math.max(1, Math.round(fullH * scale));
    const output = new Uint8Array(outW * outH);

    const { center, basis } = plane;
    const [uAx0, uAx1, uAx2] = basis.uAxis;
    const [vAx0, vAx1, vAx2] = basis.vAxis;
    const [ctx, cty, ctz] = center;
    const halfW = fullW / 2;
    const halfH = fullH / 2;

    const { inverseAffine } = this.volume;
    const [ia0,ia1,ia2,ia3, ia4,ia5,ia6,ia7, ia8,ia9,ia10,ia11] = inverseAffine;
    const [dx, dy, dz] = this.dimensions;

    for (let py = 0; py < outH; py++) {
      const v = (py / (outH - 1 || 1)) * fullH - halfH;
      const rowOffset = py * outW;

      for (let px = 0; px < outW; px++) {
        const u = (px / (outW - 1 || 1)) * fullW - halfW;

        // 平面坐标 → IJK（内联 affine 逆变换）
        const rasX = ctx + u * uAx0 + v * vAx0;
        const rasY = cty + u * uAx1 + v * vAx1;
        const rasZ = ctz + u * uAx2 + v * vAx2;

        const i = ia0 * rasX + ia1 * rasY + ia2 * rasZ + ia3;
        const j = ia4 * rasX + ia5 * rasY + ia6 * rasZ + ia7;
        const k = ia8 * rasX + ia9 * rasY + ia10 * rasZ + ia11;

        // 内联三线性插值
        if (i < -0.5 || i >= dx - 0.5 || j < -0.5 || j >= dy - 0.5 || k < -0.5 || k >= dz - 0.5) {
          output[rowOffset + px] = 0;
          continue;
        }

        const x0 = Math.floor(i), y0 = Math.floor(j), z0 = Math.floor(k);
        const x1 = x0 + 1, y1 = y0 + 1, z1 = z0 + 1;
        const xf = i - x0, yf = j - y0, zf = k - z0;

        const c000 = (x0<0||x0>=dx||y0<0||y0>=dy||z0<0||z0>=dz) ? 0 : this.normalizedData[z0*dx*dy+y0*dx+x0];
        const c100 = (x1<0||x1>=dx||y0<0||y0>=dy||z0<0||z0>=dz) ? 0 : this.normalizedData[z0*dx*dy+y0*dx+x1];
        const c010 = (x0<0||x0>=dx||y1<0||y1>=dy||z0<0||z0>=dz) ? 0 : this.normalizedData[z0*dx*dy+y1*dx+x0];
        const c110 = (x1<0||x1>=dx||y1<0||y1>=dy||z0<0||z0>=dz) ? 0 : this.normalizedData[z0*dx*dy+y1*dx+x1];
        const c001 = (x0<0||x0>=dx||y0<0||y0>=dy||z1<0||z1>=dz) ? 0 : this.normalizedData[z1*dx*dy+y0*dx+x0];
        const c101 = (x1<0||x1>=dx||y0<0||y0>=dy||z1<0||z1>=dz) ? 0 : this.normalizedData[z1*dx*dy+y0*dx+x1];
        const c011 = (x0<0||x0>=dx||y1<0||y1>=dy||z1<0||z1>=dz) ? 0 : this.normalizedData[z1*dx*dy+y1*dx+x0];
        const c111 = (x1<0||x1>=dx||y1<0||y1>=dy||z1<0||z1>=dz) ? 0 : this.normalizedData[z1*dx*dy+y1*dx+x1];

        const c00 = c000*(1-xf)+c100*xf, c10 = c010*(1-xf)+c110*xf;
        const c01 = c001*(1-xf)+c101*xf, c11 = c011*(1-xf)+c111*xf;
        const c0 = c00*(1-yf)+c10*yf, c1 = c01*(1-yf)+c11*yf;

        output[rowOffset + px] = Math.round(c0*(1-zf)+c1*zf);
      }
    }

    // LRU cache
    if (this.cache.size >= this.cacheMaxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(scaleKey, { data: output, width: outW, height: outH });

    return { data: output, width: outW, height: outH };
  }

  /**
   * 获取体积尺寸
   */
  getDimensions(): [number, number, number] {
    return this.dimensions;
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cache.clear();
  }
}

/**
 * 工厂函数：创建斜切面提取器
 */
export function createObliqueExtractor(options: ObliqueExtractorOptions): ObliqueExtractor {
  return new ObliqueExtractor(options);
}
