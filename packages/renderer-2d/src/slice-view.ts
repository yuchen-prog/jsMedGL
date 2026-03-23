// Slice View - Individual slice rendering component

import type {
  SliceView as ISliceView,
  SliceOrientation,
  CrosshairPosition,
  OrientationLabels
} from './types';
export type { SliceView } from './types';
import type { NiftiVolume } from '@jsmedgl/parser-nifti';

export interface SliceViewOptions {
  container: HTMLElement;
  orientation: SliceOrientation;
  enableCrosshair?: boolean;
  enableOrientationLabels?: boolean;
}

export function createSliceView(
  volume: NiftiVolume,
  options: SliceViewOptions
): ISliceView {
  return new SliceViewImpl(volume, options);
}

class SliceViewImpl implements ISliceView {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private orientation: SliceOrientation;
  private sliceIndex: number = 0;
  private volume: NiftiVolume;
  private crosshairElement: HTMLElement | null = null;
  private labelsElement: HTMLElement | null = null;
  private listeners: Map<string, Set<(data: any) => void>> = new Map();
  private windowWidth: number = 255;
  private windowCenter: number = 128;
  private volumeMin: number = 0;
  private volumeMax: number = 255;
  private volumeRange: number = 255;

  constructor(volume: NiftiVolume, options: SliceViewOptions) {
    this.volume = volume;
    this.container = options.container;
    this.orientation = options.orientation;

    // Pre-compute volume-wide min/max for consistent normalization
    const datatype = volume.header.datatype;
    const byteSize = this.getDataTypeSize(datatype);
    let vMin = Infinity, vMax = -Infinity;
    const numVoxels = volume.data.byteLength / byteSize;
    const step = Math.max(1, Math.floor(numVoxels / 10000));
    for (let i = 0; i < numVoxels; i += step) {
      const v = this.readVoxel(volume.data, datatype, i * byteSize);
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
    this.volumeMin = vMin;
    this.volumeMax = vMax;
    this.volumeRange = vMax - vMin;
    console.log('[SliceView] Volume stats - min:', this.volumeMin.toFixed(2), 'max:', this.volumeMax.toFixed(2), 'range:', this.volumeRange.toFixed(2));

    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not supported');
    this.ctx = ctx;

    console.log('[SliceView]', this.orientation, '- container:', this.container.offsetWidth, 'x', this.container.offsetHeight);

    this.setupDOM(options.enableCrosshair !== false, options.enableOrientationLabels !== false);
    this.setupEventHandlers();
    this.render();
  }

  private setupDOM(enableCrosshair: boolean, enableLabels: boolean): void {
    this.container.innerHTML = '';
    this.container.style.position = 'relative';
    this.container.style.backgroundColor = '#000';
    this.container.style.overflow = 'hidden';

    this.canvas.width = this.container.offsetWidth;
    this.canvas.height = this.container.offsetHeight;
    console.log('[SliceView]', this.orientation, '- canvas size:', this.canvas.width, 'x', this.canvas.height);

    this.container.appendChild(this.canvas);

    if (enableCrosshair) {
      this.crosshairElement = document.createElement('div');
      this.crosshairElement.style.cssText = `
        position: absolute; top: 0; left: 0; right: 0; bottom: 0;
        pointer-events: none; z-index: 10;
      `;
      this.crosshairElement.innerHTML = `
        <div style="position:absolute;height:1px;background:rgba(0,255,0,0.7);left:0;right:0;top:50%;"></div>
        <div style="position:absolute;width:1px;background:rgba(0,255,0,0.7);top:0;bottom:0;left:50%;"></div>
      `;
      this.container.appendChild(this.crosshairElement);
    }

    if (enableLabels) {
      this.labelsElement = document.createElement('div');
      this.labelsElement.style.cssText = `
        position: absolute; top: 0; left: 0; right: 0; bottom: 0;
        pointer-events: none; z-index: 20;
        font-family: Arial; font-size: 14px; color: white;
        text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
      `;
      this.updateLabels();
      this.container.appendChild(this.labelsElement);
    }
  }

  private setupEventHandlers(): void {
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.setSliceIndex(this.sliceIndex + (e.deltaY > 0 ? 1 : -1));
    });
  }

  private updateLabels(): void {
    if (!this.labelsElement) return;
    const labels = this.getOrientationLabels();
    this.labelsElement.innerHTML = `
      <div style="position:absolute;top:8px;left:50%;transform:translateX(-50%);">${labels.top}</div>
      <div style="position:absolute;bottom:8px;left:50%;transform:translateX(-50%);">${labels.bottom}</div>
      <div style="position:absolute;left:8px;top:50%;transform:translateY(-50%);">${labels.left}</div>
      <div style="position:absolute;right:8px;top:50%;transform:translateY(-50%);">${labels.right}</div>
    `;
  }

  private getOrientationLabels(): OrientationLabels {
    switch (this.orientation) {
      case 'axial': return { top: 'A', bottom: 'P', left: 'L', right: 'R' };
      case 'coronal': return { top: 'S', bottom: 'I', left: 'L', right: 'R' };
      case 'sagittal': return { top: 'S', bottom: 'I', left: 'A', right: 'P' };
    }
  }

  private extractSliceData(): { data: Uint8ClampedArray; width: number; height: number } {
    const { dimensions, data, header } = this.volume;
    const datatype = header.datatype;
    const byteSize = this.getDataTypeSize(datatype);
    const d0 = dimensions[0], d1 = dimensions[1], d2 = dimensions[2];
    const [sliceW, sliceH, planeBase] = this.getSliceGeometry(d0, d1, d2);

    const pixels = new Uint8ClampedArray(sliceW * sliceH * 4);

    // Compute byte offset for each voxel: linearIdx * byteSize
    // axial:   i = x + y*dim0 + z*dim0*dim1  → x varies fastest, then y, then z
    // coronal: i = x + z*dim0*dim1 + y*dim0  → x varies fastest, then z, then y
    // sagittal: i = y*dim0 + z*dim0*dim1 + x → y varies fastest, then z, then x
    let min = Infinity, max = -Infinity;
    const rawBuf = new Uint8Array(data);

    if (this.orientation === 'axial') {
      // z = planeBase
      for (let y = 0; y < sliceH; y++) {
        for (let x = 0; x < sliceW; x++) {
          const linearIdx = x + y * d0 + planeBase * d0 * d1;
          const val = this.readVoxel(data, datatype, linearIdx * byteSize);
          if (val < min) min = val;
          if (val > max) max = val;
          rawBuf[linearIdx] = Math.max(0, Math.min(255, val)); // store normalized for debug
        }
      }
    } else if (this.orientation === 'coronal') {
      // y = planeBase
      for (let z = 0; z < sliceH; z++) {
        for (let x = 0; x < sliceW; x++) {
          const linearIdx = x + z * d0 * d1 + planeBase * d0;
          const val = this.readVoxel(data, datatype, linearIdx * byteSize);
          if (val < min) min = val;
          if (val > max) max = val;
        }
      }
    } else {
      // sagittal: x = planeBase
      for (let z = 0; z < sliceH; z++) {
        for (let y = 0; y < sliceW; y++) {
          const linearIdx = y * d0 + z * d0 * d1 + planeBase;
          const val = this.readVoxel(data, datatype, linearIdx * byteSize);
          if (val < min) min = val;
          if (val > max) max = val;
        }
      }
    }

    const range = this.volumeRange;
    console.log('[SliceView]', this.orientation, 'slice', this.sliceIndex,
      '- using volume range:', range.toFixed(2), '(min:', this.volumeMin.toFixed(2), 'max:', this.volumeMax.toFixed(2), ')');

    // Second pass: normalize to 0-255 and write pixels
    if (this.orientation === 'axial') {
      for (let y = 0; y < sliceH; y++) {
        for (let x = 0; x < sliceW; x++) {
          const linearIdx = x + y * d0 + planeBase * d0 * d1;
          const rawVal = this.readVoxel(data, datatype, linearIdx * byteSize);
          let v = range > 0 ? Math.round(((rawVal - this.volumeMin) / range) * 255) : (rawVal > 0 ? 255 : 0);
          v = Math.max(0, Math.min(255, v));
          const pi = (y * sliceW + x) * 4;
          pixels[pi] = v; pixels[pi+1] = v; pixels[pi+2] = v; pixels[pi+3] = 255;
        }
      }
    } else if (this.orientation === 'coronal') {
      for (let z = 0; z < sliceH; z++) {
        for (let x = 0; x < sliceW; x++) {
          const linearIdx = x + z * d0 * d1 + planeBase * d0;
          const rawVal = this.readVoxel(data, datatype, linearIdx * byteSize);
          let v = range > 0 ? Math.round(((rawVal - this.volumeMin) / range) * 255) : (rawVal > 0 ? 255 : 0);
          v = Math.max(0, Math.min(255, v));
          const pi = (z * sliceW + x) * 4;
          pixels[pi] = v; pixels[pi+1] = v; pixels[pi+2] = v; pixels[pi+3] = 255;
        }
      }
    } else {
      for (let z = 0; z < sliceH; z++) {
        for (let y = 0; y < sliceW; y++) {
          const linearIdx = y * d0 + z * d0 * d1 + planeBase;
          const rawVal = this.readVoxel(data, datatype, linearIdx * byteSize);
          let v = range > 0 ? Math.round(((rawVal - this.volumeMin) / range) * 255) : (rawVal > 0 ? 255 : 0);
          v = Math.max(0, Math.min(255, v));
          const pi = (z * sliceW + y) * 4;
          pixels[pi] = v; pixels[pi+1] = v; pixels[pi+2] = v; pixels[pi+3] = 255;
        }
      }
    }

    return { data: pixels, width: sliceW, height: sliceH };
  }

  private getSliceGeometry(d0: number, d1: number, d2: number): [number, number, number] {
    switch (this.orientation) {
      case 'axial':   return [d0, d1, this.sliceIndex];    // [width, height, z]
      case 'coronal': return [d0, d2, this.sliceIndex];    // [width, height, y]
      case 'sagittal': return [d1, d2, this.sliceIndex];   // [width, height, x]
    }
  }

  private getDataTypeSize(datatype: number): number {
    const sizes: Record<number, number> = {
      2: 1, 4: 2, 8: 4, 16: 4, 64: 8,
      256: 1, 512: 2, 768: 4, 1024: 8, 1280: 8
    };
    return sizes[datatype] || 1;
  }

  private readVoxel(data: ArrayBuffer, datatype: number, byteOffset: number): number {
    const view = new DataView(data, byteOffset);
    switch (datatype) {
      case 2:   return view.getUint8(0);
      case 4:   return view.getInt16(0, true);
      case 8:   return view.getInt32(0, true);
      case 16:  return view.getFloat32(0, true);
      case 64:  return view.getFloat64(0, true);
      case 256: return view.getInt8(0);
      case 512: return view.getUint16(0, true);
      case 768: return view.getUint32(0, true);
      default:  return view.getUint8(0);
    }
  }

  render(): void {
    const { width: sliceW, height: sliceH, data: pixels } = this.extractSliceData();
    const canvasW = this.canvas.width;
    const canvasH = this.canvas.height;

    console.log('[SliceView]', this.orientation, '- render slice', this.sliceIndex,
      '- canvas:', canvasW, 'x', canvasH, '- slice:', sliceW, 'x', sliceH,
      '- volumeRange:', this.volumeRange.toFixed(1));

    // Verify pixel array has correct size
    const expectedPixels = sliceW * sliceH * 4;
    console.log('[SliceView] pixels length:', pixels.length, 'expected:', expectedPixels, '- match:', pixels.length === expectedPixels);

    // Check center pixel value
    const centerIdx = Math.floor(sliceH / 2) * sliceW + Math.floor(sliceW / 2);
    const centerR = pixels[centerIdx * 4];
    console.log('[SliceView] center pixel value:', centerR);

    // Draw: fill canvas black first
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, canvasW, canvasH);

    // Scale slice to fit canvas
    const scale = Math.min(canvasW / sliceW, canvasH / sliceH);
    const drawW = sliceW * scale;
    const drawH = sliceH * scale;
    const drawX = (canvasW - drawW) / 2;
    const drawY = (canvasH - drawH) / 2;

    // Create ImageData from pixel array
    const imageData = new ImageData(sliceW, sliceH);
    imageData.data.set(pixels);

    // Draw via OffscreenCanvas for scaling
    const offscreen = new OffscreenCanvas(sliceW, sliceH);
    const offCtx = offscreen.getContext('2d')!;
    offCtx.putImageData(imageData, 0, 0);
    this.ctx.drawImage(offscreen, drawX, drawY, drawW, drawH);
  }

  setSliceIndex(index: number): void {
    const maxIndex = this.getMaxSliceIndex();
    index = Math.max(0, Math.min(index, maxIndex));
    if (index === this.sliceIndex) return;
    this.sliceIndex = index;
    this.render();
    this.emit('sliceChange', { orientation: this.orientation, index: this.sliceIndex });
  }

  getSliceIndex(): number { return this.sliceIndex; }

  setWindowLevel(window: number, level: number): void {
    this.windowWidth = window;
    this.windowCenter = level;
    this.render();
  }

  updateCrosshair(_position: CrosshairPosition): void {
    // TODO: implement crosshair position from other views
  }

  on(event: string, callback: (data: any) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: (data: any) => void): void {
    this.listeners.get(event)?.delete(callback);
  }

  private emit(event: string, data?: any): void {
    this.listeners.get(event)?.forEach(cb => cb(data));
  }

  private getMaxSliceIndex(): number {
    const dims = this.volume.dimensions;
    switch (this.orientation) {
      case 'axial': return dims[2] - 1;
      case 'coronal': return dims[1] - 1;
      case 'sagittal': return dims[0] - 1;
    }
  }

  dispose(): void {
    this.listeners.clear();
    this.container.innerHTML = '';
  }
}
