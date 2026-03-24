// MPR Layout - Multi-Planar Reconstruction Layout Manager

import { createSliceView, SliceView } from './slice-view';
import type { SliceOrientation, WindowLevel } from './types';
import type { NiftiVolume } from '@jsmedgl/parser-nifti';

export interface MPRLayoutOptions {
  container: HTMLElement;
  volume: NiftiVolume;
  layout?: 'single' | 'axial' | 'coronal' | 'sagittal' | 'mpr';
  initialWindowLevel?: WindowLevel;
  initialSlice?: number;
}

export interface MPRLayout {
  setWindowLevel(window: number, level: number): void;
  setSlice(index: number): void;
  dispose(): void;
}

export function createMPRLayout(options: MPRLayoutOptions): MPRLayout {
  return new MPRLayoutImpl(options);
}

class MPRLayoutImpl implements MPRLayout {
  private container: HTMLElement;
  private volume: NiftiVolume;
  private view!: SliceView;
  private currentWindowLevel: WindowLevel;
  private listeners: Map<string, Set<Function>> = new Map();

  constructor(options: MPRLayoutOptions) {
    this.container = options.container;
    this.volume = options.volume;
    this.currentWindowLevel = options.initialWindowLevel || { window: 255, level: 128 };

    this.injectCSS();
    this.setupLayout(options.layout || 'axial');
  }

  private injectCSS(): void {
    if (document.getElementById('jsmed-styles')) return;

    const style = document.createElement('style');
    style.id = 'jsmed-styles';
    style.textContent = `
      .jsmed-root {
        width: 100%;
        height: 100%;
        position: relative;
        background-color: #000;
      }

      .jsmed-view {
        width: 100%;
        height: 100%;
        position: absolute;
        top: 0;
        left: 0;
      }
    `;
    document.head.appendChild(style);
  }

  private setupLayout(layout: string): void {
    this.container.innerHTML = '';
    this.container.className = 'jsmed-root';

    const viewDiv = document.createElement('div');
    viewDiv.className = 'jsmed-view';

    this.container.appendChild(viewDiv);

    let orientation: SliceOrientation;
    switch (layout) {
      case 'coronal':
        orientation = 'coronal';
        break;
      case 'sagittal':
        orientation = 'sagittal';
        break;
      default:
        orientation = 'axial';
    }

    this.view = createSliceView(this.volume, {
      container: viewDiv,
      orientation,
      enableCrosshair: true,
      enableOrientationLabels: true
    });

    // Default to slice 0
    this.view.setSliceIndex(0);
    this.view.setWindowLevel(this.currentWindowLevel.window, this.currentWindowLevel.level);
  }

  setWindowLevel(window: number, level: number): void {
    this.currentWindowLevel = { window, level };
    this.view.setWindowLevel(window, level);
  }

  setSlice(index: number): void {
    this.view.setSliceIndex(index);
  }

  dispose(): void {
    this.listeners.clear();
    this.view.dispose();
    this.container.innerHTML = '';
  }
}
