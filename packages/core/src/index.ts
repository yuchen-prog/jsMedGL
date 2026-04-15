// jsMedgl Core - Main Entry Point

// ─── API Facade ───

export interface ViewerOptions {
  container: HTMLElement;
  crosshair?: boolean;
  colorbar?: boolean;
  orientationLabels?: boolean;
}

export interface VolumeViewer {
  loadNifti: (source: string | File | ArrayBuffer) => Promise<void>;
  setSlice: (axis: 'axial' | 'coronal' | 'sagittal', index: number) => void;
  setWindowLevel: (window: number, level: number) => void;
  screenshot: () => Promise<Blob>;
  dispose: () => void;
}

export function createVolumeViewer(_options: ViewerOptions): VolumeViewer {
  // TODO: Phase 3 — compose renderer-2d + renderer-3d internally
  return {
    async loadNifti(_source) {},
    setSlice(_axis, _index) {},
    setWindowLevel(_window, _level) {},
    async screenshot() {
      return new Blob(['placeholder'], { type: 'image/png' });
    },
    dispose() {},
  };
}

// ─── Coordinate utilities ───
export {
  identityMatrix,
  invertMatrix,
  extractAffineMatrix,
  ijkToRas,
  rasToIjk,
  rasToLps,
  lpsToRas,
  validateOrientation,
} from './coordinate';

// ─── Window/Level utilities ───
export {
  applyWindowLevel,
  computeAutoWindowLevel,
  buildOpacityLUT,
} from './window-level';

// ─── Colormap utilities ───
export {
  buildColorLUT,
  getColormapData,
  getColormapNames,
} from './colormaps';

// ─── Store ───
export { createViewerStore } from './store';
export type {
  ViewerStore,
  ViewerState,
  ViewerActions,
} from './store';

// ─── EventEmitter ───
export { createEventEmitter } from './events';
export type { EventEmitter, EventCallback } from './events';

// ─── Unified type re-exports ───
export type * from './types';
export type { Volume } from './types';
