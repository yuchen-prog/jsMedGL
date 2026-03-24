// WebGL Slice View - Slice rendering with window/level support

import type { SliceOrientation, WindowLevel, OrientationLabels } from './types';
import type { NiftiVolume } from '@jsmedgl/parser-nifti';

export interface WebGLSliceViewOptions {
  container: HTMLElement;
  orientation?: SliceOrientation;
  initialWindowLevel?: WindowLevel;
  initialSliceIndex?: number;
}

export interface WebGLSliceView {
  setSliceIndex(index: number): void;
  getSliceIndex(): number;
  setWindowLevel(window: number, level: number): void;
  render(): void;
  dispose(): void;
}

export function createWebGLSliceView(
  volume: NiftiVolume,
  options: WebGLSliceViewOptions
): WebGLSliceView {
  return new WebGLSliceViewImpl(volume, options);
}

class WebGLSliceViewImpl implements WebGLSliceView {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private orientation: SliceOrientation;
  private sliceIndex: number = 0;
  private volume: NiftiVolume;
  private crosshairElement: HTMLElement | null = null;
  private labelsElement: HTMLElement | null = null;
  private listeners: Map<string, Set<(data: any) => void>> = new Map();

  // Normalized volume data (all types converted to Uint8)
  private normalizedData: Uint8Array;

  constructor(volume: NiftiVolume, options: WebGLSliceViewOptions) {
    this.volume = volume;
    this.container = options.container;
    this.orientation = options.orientation || 'axial';
    this.sliceIndex = options.initialSliceIndex || 0;

    // Create visible display canvas
    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context');
    this.ctx = ctx;

    // Pre-normalize volume data
    this.normalizedData = new Uint8Array(0);
    this.normalizeVolumeData();

    // Find first slice with data
    this.sliceIndex = this.findFirstSliceWithData();

    this.setupDOM();
    this.setupEventHandlers();

    // Delay first render to ensure container has proper size
    requestAnimationFrame(() => this.render());
  }

  private normalizeVolumeData(): void {
    const { data, header } = this.volume;
    const datatype = header.datatype;
    const byteSize = this.getDataTypeSize(datatype);
    const numVoxels = data.byteLength / byteSize;

    // Find min/max
    let vMin = Infinity, vMax = -Infinity;
    const step = Math.max(1, Math.floor(numVoxels / 10000));
    for (let i = 0; i < numVoxels; i += step) {
      const v = this.readVoxel(data, datatype, i * byteSize);
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
    const range = vMax - vMin;

    // Normalize all data to Uint8Array
    this.normalizedData = new Uint8Array(numVoxels);
    for (let i = 0; i < numVoxels; i++) {
      const v = this.readVoxel(data, datatype, i * byteSize);
      let normalized = range > 0 ? Math.round(((v - vMin) / range) * 255) : (v > 0 ? 255 : 0);
      this.normalizedData[i] = Math.max(0, Math.min(255, normalized));
    }
  }

  private findFirstSliceWithData(): number {
    const dims = this.volume.dimensions;
    const sliceSize = dims[0] * dims[1];
    const totalSlices = dims[2];

    for (let z = 0; z < totalSlices; z++) {
      const offset = z * sliceSize;
      for (let i = 0; i < sliceSize; i++) {
        if (this.normalizedData[offset + i] > 0) {
          return z;
        }
      }
    }
    return 0;
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

  private setupDOM(): void {
    this.container.innerHTML = '';
    this.container.style.position = 'relative';
    this.container.style.backgroundColor = '#000';
    this.container.style.overflow = 'hidden';

    this.container.appendChild(this.canvas);

    // Crosshair overlay
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

    // Orientation labels
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

  private setupEventHandlers(): void {
    // Mouse wheel for slice navigation
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
    const { dimensions } = this.volume;
    const d0 = dimensions[0], d1 = dimensions[1];

    let sliceW: number, sliceH: number;
    let pixels: Uint8ClampedArray;

    // Simple direct mapping - normalizedData is already 0-255
    if (this.orientation === 'axial') {
      sliceW = d0;
      sliceH = d1;
      pixels = new Uint8ClampedArray(sliceW * sliceH * 4);
      const offset = this.sliceIndex * sliceW * sliceH;
      for (let y = 0; y < sliceH; y++) {
        for (let x = 0; x < sliceW; x++) {
          const idx = offset + y * sliceW + x;
          const v = this.normalizedData[idx];
          const pi = (y * sliceW + x) * 4;
          pixels[pi] = v;
          pixels[pi + 1] = v;
          pixels[pi + 2] = v;
          pixels[pi + 3] = 255;
        }
      }
    } else if (this.orientation === 'coronal') {
      sliceW = d0;
      sliceH = dimensions[2];
      pixels = new Uint8ClampedArray(sliceW * sliceH * 4);
      for (let z = 0; z < sliceH; z++) {
        for (let x = 0; x < sliceW; x++) {
          const linearIdx = x + this.sliceIndex * d0 + z * d0 * d1;
          const v = this.normalizedData[linearIdx];
          const pi = (z * sliceW + x) * 4;
          pixels[pi] = v;
          pixels[pi + 1] = v;
          pixels[pi + 2] = v;
          pixels[pi + 3] = 255;
        }
      }
    } else {
      // sagittal
      sliceW = d1;
      sliceH = dimensions[2];
      pixels = new Uint8ClampedArray(sliceW * sliceH * 4);
      for (let z = 0; z < sliceH; z++) {
        for (let y = 0; y < sliceW; y++) {
          const linearIdx = this.sliceIndex + y * d0 + z * d0 * d1;
          const v = this.normalizedData[linearIdx];
          const pi = (z * sliceW + y) * 4;
          pixels[pi] = v;
          pixels[pi + 1] = v;
          pixels[pi + 2] = v;
          pixels[pi + 3] = 255;
        }
      }
    }

    return { data: pixels, width: sliceW, height: sliceH };
  }

  render(): void {
    const containerW = this.container.offsetWidth;
    const containerH = this.container.offsetHeight;

    if (containerW === 0 || containerH === 0) {
      requestAnimationFrame(() => this.render());
      return;
    }

    const { width: sliceW, height: sliceH, data: pixels } = this.extractSliceData();

    // Update display canvas size
    if (this.canvas.width !== containerW || this.canvas.height !== containerH) {
      this.canvas.width = containerW;
      this.canvas.height = containerH;
    }

    // Clear display
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, containerW, containerH);

    // Calculate scaled drawing area
    const scale = Math.min(containerW / sliceW, containerH / sliceH);
    const drawW = sliceW * scale;
    const drawH = sliceH * scale;
    const drawX = (containerW - drawW) / 2;
    const drawY = (containerH - drawH) / 2;

    // Create ImageData and draw
    const imageData = new ImageData(sliceW, sliceH);
    imageData.data.set(pixels);

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

  getSliceIndex(): number {
    return this.sliceIndex;
  }

  setWindowLevel(_window: number, _level: number): void {
    // Window/Level not implemented in this simplified version
    this.render();
  }

  private getMaxSliceIndex(): number {
    const dims = this.volume.dimensions;
    switch (this.orientation) {
      case 'axial': return dims[2] - 1;
      case 'coronal': return dims[1] - 1;
      case 'sagittal': return dims[0] - 1;
    }
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

  dispose(): void {
    this.listeners.clear();
    this.container.innerHTML = '';
  }
}
