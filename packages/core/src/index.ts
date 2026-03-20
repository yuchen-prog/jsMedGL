// jsMedgl Core - Main Entry Point

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

export function createVolumeViewer(options: ViewerOptions): VolumeViewer {
  console.log('jsMedgl createVolumeViewer', options);

  return {
    async loadNifti(_source) {
      console.log('Loading NIfTI');
    },
    setSlice(_axis, _index) {
      console.log('Set slice');
    },
    setWindowLevel(_window, _level) {
      console.log('Set window/level');
    },
    async screenshot() {
      return new Blob(['placeholder'], { type: 'image/png' });
    },
    dispose() {
      console.log('Disposing viewer');
    },
  };
}

export type * from './types';
