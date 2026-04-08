// VolumeRenderView - DOM + interaction wrapper for volume rendering

import type { NiftiVolume } from '@jsmedgl/parser-nifti';
import type {
  CompositingMode,
  ColormapName,
  VolumeCameraState,
  OrientationCubeConfig,
  TissuePreset,
} from './types';
import { DEFAULT_ORIENTATION_CUBE_CONFIG } from './types';
import { WebGLVolumeRenderer } from './WebGLVolumeRenderer';
import { OrientationCube } from './OrientationCube';

type RenderEventData = Record<string, unknown>;
type CameraEventData = { state: VolumeCameraState };
type WindowLevelEventData = { window: number; level: number };
type VolumeRenderViewEvent = 'render' | 'cameraChange' | 'windowLevelChange';

/**
 * Simple event emitter for VolumeRenderView
 */
type EventCallback<T> = (data: T) => void;

class EventEmitter {
  private listeners: Map<VolumeRenderViewEvent, Set<EventCallback<unknown>>> = new Map();

  on<T>(event: VolumeRenderViewEvent, cb: EventCallback<T>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(cb as EventCallback<unknown>);
  }

  off<T>(event: VolumeRenderViewEvent, cb: EventCallback<T>): void {
    this.listeners.get(event)?.delete(cb as EventCallback<unknown>);
  }

  emit(event: VolumeRenderViewEvent, data: unknown): void {
    this.listeners.get(event)?.forEach(cb => cb(data));
  }
}

/**
 * Interaction state during mouse drag
 */
interface DragState {
  active: boolean;
  button: number; // 0=left, 2=right
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
}

/**
 * Full VolumeRenderView interface implementation with canvas + interaction
 */
export class VolumeRenderViewImpl {
  private renderer: WebGLVolumeRenderer;
  private orientationCube: OrientationCube | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private labelCanvas: HTMLCanvasElement | null = null;
  private labelCtx: CanvasRenderingContext2D | null = null;
  private container: HTMLElement | null = null;

  private config: {
    colormap: ColormapName;
    gradientLighting: boolean;
    window: number;
    level: number;
    orientationCube: OrientationCubeConfig;
  } = {
    colormap: 'grayscale',
    gradientLighting: true,
    window: 1.0,
    level: 0.5,
    orientationCube: { size: 100, position: 'bottom-right' },
  };

  // Interaction
  private drag: DragState = {
    active: false,
    button: -1,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
  };

  // Events
  private emitter = new EventEmitter();

  // Resize observer
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    container: HTMLElement,
    options?: {
      canvas?: HTMLCanvasElement;
      orientationCube?: Partial<OrientationCubeConfig>;
    }
  ) {
    // Create or use provided canvas
    if (options?.canvas) {
      this.canvas = options.canvas;
    } else {
      this.canvas = document.createElement('canvas');
      this.canvas.style.position = 'absolute';
      this.canvas.style.top = '0';
      this.canvas.style.left = '0';
      this.canvas.style.width = '100%';
      this.canvas.style.height = '100%';
      this.canvas.style.display = 'block';
    }

    // Create WebGL context and renderer
    const gl = this.canvas.getContext('webgl2', {
      antialias: false,
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      throw new Error('WebGL2 not supported');
    }

    this.renderer = new WebGLVolumeRenderer(gl);

    // Setup orientation cube if requested
    const cubeConfig = { ...DEFAULT_ORIENTATION_CUBE_CONFIG, ...(options?.orientationCube ?? {}) };
    if (cubeConfig.size > 0) {
      this.orientationCube = new OrientationCube(gl, this.canvas, cubeConfig);
    }

    // Update orientation cube config
    this.config.orientationCube = cubeConfig;

    this.container = container;

    this.setupDOM();
    this.setupEvents();
    this.setupResizeObserver();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  setVolume(volume: NiftiVolume): void {
    this.renderer.setVolume(volume);
    this.scheduleRender();
  }

  setCompositingMode(mode: CompositingMode): void {
    this.renderer.setConfig({ compositingMode: mode });
    this.scheduleRender();
  }

  setColormap(colormap: ColormapName): void {
    this.config.colormap = colormap;
    this.renderer.setConfig({
      transferFunction: {
        colormap,
        window: this.config.window,
        level: this.config.level,
        gradientLighting: this.config.gradientLighting,
      },
    });
    this.scheduleRender();
  }

  setWindowLevel(window: number, level: number): void {
    this.config.window = window;
    this.config.level = level;
    this.renderer.setConfig({
      transferFunction: {
        colormap: this.config.colormap,
        window,
        level,
        gradientLighting: this.config.gradientLighting,
      },
    });
    this.scheduleRender();
  }

  applyPreset(preset: TissuePreset): void {
    const nl = { window: preset.window / 255, level: preset.level / 255 };
    this.config.colormap = preset.colormap;
    this.config.window = nl.window;
    this.config.level = nl.level;
    this.renderer.setConfig({
      transferFunction: {
        colormap: preset.colormap,
        window: nl.window,
        level: nl.level,
        gradientLighting: this.config.gradientLighting,
      },
    });
    this.emitter.emit('windowLevelChange', { window: nl.window, level: nl.level } satisfies WindowLevelEventData);
    this.scheduleRender();
  }

  setGradientLighting(enabled: boolean): void {
    this.config.gradientLighting = enabled;
    this.renderer.setConfig({
      transferFunction: {
        colormap: this.config.colormap,
        window: this.config.window,
        level: this.config.level,
        gradientLighting: enabled,
      },
    });
    this.scheduleRender();
  }

  setCamera(state: Partial<VolumeCameraState>): void {
    this.renderer.setCamera(state);
    this.emitter.emit('cameraChange', { state: this.renderer.getCamera() } satisfies CameraEventData);
    this.scheduleRender();
  }

  getCamera(): VolumeCameraState {
    return this.renderer.getCamera();
  }

  on(event: VolumeRenderViewEvent, cb: EventCallback<unknown>): void {
    this.emitter.on(event, cb as EventCallback<RenderEventData>);
  }

  off(event: VolumeRenderViewEvent, cb: EventCallback<unknown>): void {
    this.emitter.off(event, cb as EventCallback<RenderEventData>);
  }

  dispose(): void {
    // Stop listening
    this.removeEvents();

    // Disconnect resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // Dispose renderer
    this.renderer.dispose();

    // Dispose orientation cube
    this.orientationCube?.dispose();

    // Remove canvases from DOM
    this.canvas?.remove();
    this.labelCanvas?.remove();

    // Clear references
    this.canvas = null;
    this.labelCanvas = null;
    this.container = null;
  }

  /**
   * Trigger a render frame manually
   */
  render(): void {
    this.scheduleRender();
  }

  // ── DOM Setup ───────────────────────────────────────────────────────────────

  private setupDOM(): void {
    if (!this.canvas || !this.container) return;

    // Append main canvas
    this.container.appendChild(this.canvas);

    // Create 2D overlay canvas for labels
    if (this.orientationCube) {
      this.labelCanvas = document.createElement('canvas');
      this.labelCanvas.style.position = 'absolute';
      this.labelCanvas.style.top = '0';
      this.labelCanvas.style.left = '0';
      this.labelCanvas.style.width = '100%';
      this.labelCanvas.style.height = '100%';
      this.labelCanvas.style.pointerEvents = 'none';
      this.labelCanvas.style.display = 'block';
      this.container.appendChild(this.labelCanvas);
      this.labelCtx = this.labelCanvas.getContext('2d');
    }

    // Set initial size
    this.resize();
  }

  private setupResizeObserver(): void {
    if (!this.container) return;

    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
      this.scheduleRender();
    });
    this.resizeObserver.observe(this.container);
  }

  private resize(): void {
    if (!this.canvas || !this.container) return;

    const dpr = window.devicePixelRatio || 1;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;

    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);

    if (this.labelCanvas) {
      this.labelCanvas.width = Math.round(w * dpr);
      this.labelCanvas.height = Math.round(h * dpr);
    }
  }

  // ── Event Handling ─────────────────────────────────────────────────────────

  private setupEvents(): void {
    if (!this.canvas) return;

    // Mouse events on canvas
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    this.canvas.addEventListener('dblclick', this.handleDblClick);
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    this.canvas.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });

    // Global mouse move/up for drag tracking
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.handleMouseUp);
  }

  private removeEvents(): void {
    if (!this.canvas) return;

    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('wheel', this.handleWheel);
    this.canvas.removeEventListener('dblclick', this.handleDblClick);

    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mouseup', this.handleMouseUp);
  }

  private handleMouseDown = (e: MouseEvent): void => {
    e.preventDefault();
    this.drag = {
      active: true,
      button: e.button,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
    };
  };

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.drag.active) return;

    const dx = e.clientX - this.drag.lastX;
    const dy = e.clientY - this.drag.lastY;
    this.drag.lastX = e.clientX;
    this.drag.lastY = e.clientY;

    if (this.drag.button === 0) {
      // Left button: orbit
      const sensitivity = 0.005;
      this.renderer.getCameraObject().orbit(-dx * sensitivity, -dy * sensitivity);
      this.emitter.emit('cameraChange', { state: this.renderer.getCamera() } satisfies CameraEventData);
    } else if (this.drag.button === 1) {
      // Middle button: window/level
      const sensitivity = 0.005;
      const newWindow = Math.max(0.01, Math.min(1.0, this.config.window + dx * sensitivity));
      const newLevel = Math.max(0.0, Math.min(1.0, this.config.level - dy * sensitivity));
      this.config.window = newWindow;
      this.config.level = newLevel;
      this.renderer.setConfig({
        transferFunction: {
          colormap: this.config.colormap,
          window: newWindow,
          level: newLevel,
          gradientLighting: this.config.gradientLighting,
        },
      });
      this.emitter.emit('windowLevelChange', { window: newWindow, level: newLevel } satisfies WindowLevelEventData);
    } else if (this.drag.button === 2) {
      // Right button: pan
      this.renderer.getCameraObject().pan(-dx, dy);
      this.emitter.emit('cameraChange', { state: this.renderer.getCamera() } satisfies CameraEventData);
    }

    this.scheduleRender();
  };

  private handleMouseUp = (): void => {
    this.drag.active = false;
  };

  private handleWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const sensitivity = 0.001;
    this.renderer.getCameraObject().zoom(-e.deltaY * sensitivity);
    this.emitter.emit('cameraChange', { state: this.renderer.getCamera() } satisfies CameraEventData);
    this.scheduleRender();
  };

  private handleDblClick = (): void => {
    this.renderer.getCameraObject().reset();
    this.emitter.emit('cameraChange', { state: this.renderer.getCamera() } satisfies CameraEventData);
    this.scheduleRender();
  };

  // ── Rendering ─────────────────────────────────────────────────────────────

  private pendingFrame = false;

  private scheduleRender(): void {
    if (this.pendingFrame) return;
    this.pendingFrame = true;
    requestAnimationFrame(() => {
      this.pendingFrame = false;
      this.doRender();
    });
  }

  private doRender(): void {
    if (!this.canvas) return;

    const gl = this.canvas.getContext('webgl2');
    if (!gl) return;

    // Resize if needed
    this.resize();

    // Clear canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.05, 0.05, 0.05, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Render volume
    this.renderer.render();

    // Render orientation cube
    if (this.orientationCube) {
      this.orientationCube.render(this.renderer.getCameraObject().getRotationMatrix() as unknown as Float32Array);
    }

    // Draw orientation cube labels
    if (this.orientationCube && this.labelCtx && this.labelCanvas) {
      this.labelCtx.clearRect(0, 0, this.labelCanvas.width, this.labelCanvas.height);
      this.orientationCube.drawLabels(
        this.labelCtx,
        this.renderer.getCameraObject().getRotationMatrix() as unknown as Float32Array
      );
    }

    this.emitter.emit('render', {});
  }
}

// ─── Factory Pattern ─────────────────────────────────────────────────────────

/**
 * VolumeRenderView options
 */
export interface VolumeRenderViewOptions {
  /** External canvas element (optional, creates one if not provided) */
  canvas?: HTMLCanvasElement;
  /** Orientation cube configuration */
  orientationCube?: Partial<OrientationCubeConfig>;
}

/**
 * Create a VolumeRenderView instance.
 * Manages canvas, WebGL context, camera interaction, and orientation cube.
 */
export function createVolumeRenderView(
  container: HTMLElement,
  options?: VolumeRenderViewOptions
): VolumeRenderViewImpl {
  return new VolumeRenderViewImpl(container, options);
}

// Re-export the VolumeRenderView interface from types for consumers
export type { VolumeRenderView } from './types';
