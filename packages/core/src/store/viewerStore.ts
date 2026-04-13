// Zustand viewer store — shared state between 2D and 3D renderers.
// Uses subscribeWithSelector for precise field-level subscriptions.

import { createStore } from 'zustand/vanilla';
import { subscribeWithSelector } from 'zustand/middleware';
import type { WindowLevel } from '../window-level';

/**
 * Axis identifiers
 */
export type Axis = 'axial' | 'coronal' | 'sagittal';

/**
 * Layout types
 */
export type LayoutType = 'single' | 'mpr' | '3x2';

/**
 * Slice position (current index for each axis)
 */
export interface SlicePosition {
  axial: number;
  coronal: number;
  sagittal: number;
}

/**
 * Camera state for 3D renderer
 */
export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
}

/**
 * Full viewer state — shared across renderers.
 * GPU-specific state (WebGL context, textures, shaders) is NOT stored here.
 */
export interface ViewerState {
  /** Current slice index per axis */
  slices: SlicePosition;
  /** Current window/level */
  windowLevel: WindowLevel;
  /** Layout mode */
  layout: LayoutType;
  /** 3D camera */
  camera: CameraState;
  /** Whether volume data is loaded */
  isLoaded: boolean;
  /** Crosshair visibility */
  crosshairVisible: boolean;
  /** Colorbar visibility */
  colorbarVisible: boolean;
}

/**
 * Store actions
 */
export interface ViewerActions {
  setSlice: (axis: Axis, index: number) => void;
  setSlices: (slices: Partial<SlicePosition>) => void;
  setWindowLevel: (windowLevel: WindowLevel) => void;
  setLayout: (layout: LayoutType) => void;
  setCamera: (camera: Partial<CameraState>) => void;
  setLoaded: (loaded: boolean) => void;
  setCrosshairVisible: (visible: boolean) => void;
  setColorbarVisible: (visible: boolean) => void;
}

const DEFAULT_STATE: ViewerState = {
  slices: { axial: 0, coronal: 0, sagittal: 0 },
  windowLevel: { window: 255, level: 128 },
  layout: 'mpr',
  camera: { position: [0, 0, 2.5], target: [0.5, 0.5, 0.5], zoom: 1 },
  isLoaded: false,
  crosshairVisible: true,
  colorbarVisible: true,
};

/**
 * Create a shared Zustand store for viewer state.
 * Each viewer instance creates its own store.
 */
export function createViewerStore(
  initialState?: Partial<ViewerState>,
) {
  return createStore<ViewerState & ViewerActions>()(
    subscribeWithSelector((set) => ({
      ...DEFAULT_STATE,
      ...initialState,

      setSlice: (axis, index) =>
        set((state) => ({
          slices: { ...state.slices, [axis]: index },
        })),

      setSlices: (slices) =>
        set((state) => ({
          slices: { ...state.slices, ...slices },
        })),

      setWindowLevel: (windowLevel) => set({ windowLevel }),

      setLayout: (layout) => set({ layout }),

      setCamera: (camera) =>
        set((state) => ({
          camera: { ...state.camera, ...camera },
        })),

      setLoaded: (isLoaded) => set({ isLoaded }),

      setCrosshairVisible: (crosshairVisible) => set({ crosshairVisible }),

      setColorbarVisible: (colorbarVisible) => set({ colorbarVisible }),
    })),
  );
}

export type ViewerStore = ReturnType<typeof createViewerStore>;
