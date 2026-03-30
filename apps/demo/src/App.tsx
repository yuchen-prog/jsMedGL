// jsMedgl Demo - NIfTI Viewer with WebGL Rendering and MPR Support
import { memo, useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { parseNifti } from '@jsmedgl/parser-nifti';
import { createWebGLSliceView, type WebGLSliceView } from '@jsmedgl/renderer-2d';
import {
  createObliquePlane,
  createObliqueExtractor,
  quaternionFromAxisAngle,
  type ObliquePlane,
  type ObliqueExtractor as ObliqueExtractorType,
} from '@jsmedgl/renderer-2d';
import type { NiftiVolume } from '@jsmedgl/parser-nifti';
import type { SliceOrientation, CrosshairPosition } from '@jsmedgl/renderer-2d';
import type { ObliquePlaneComputed } from '@jsmedgl/renderer-2d';
import './styles.css';

// ─── Types ──────────────────────────────────────────────────────────────────

const DATATYPE_NAMES: Record<number, string> = {
  2: 'UINT8', 4: 'INT16', 8: 'INT32', 16: 'FLOAT32', 64: 'FLOAT64', 128: 'RGB24',
};

interface WindowLevelState {
  window: number;
  level: number;
}

const WL_PRESETS: Array<{ label: string; window: number; level: number }> = [
  { label: 'Default', window: 255, level: 128 },
  { label: 'Brain', window: 80, level: 40 },
  { label: 'Bone', window: 2000, level: 500 },
];

// ─── Orientation Colors ──────────────────────────────────────────────────────

const ORIENTATION_COLORS: Record<SliceOrientation, string> = {
  axial: '#3b82f6',    // Blue
  coronal: '#22c55e',  // Green
  sagittal: '#f97316', // Orange
};

// Crosshair line colors based on which plane the axis represents
// X-axis (horizontal) represents: Axial→Coronal, Coronal→Axial, Sagittal→Axial
// Y-axis (vertical) represents: Axial→Sagittal, Coronal→Sagittal, Sagittal→Coronal
const CROSSHAIR_COLORS: Record<SliceOrientation, { h: string; v: string }> = {
  axial:    { h: ORIENTATION_COLORS.coronal,  v: ORIENTATION_COLORS.sagittal },
  coronal:  { h: ORIENTATION_COLORS.axial,    v: ORIENTATION_COLORS.sagittal },
  sagittal: { h: ORIENTATION_COLORS.axial,    v: ORIENTATION_COLORS.coronal },
};

// ─── Crosshair position → overlay pixel coords ────────────────────────────────

/**
 * Convert volume IJK crosshair position to pixel coords within the display area.
 */
function crosshairToPixels(
  ijk: CrosshairPosition,
  orientation: SliceOrientation,
  displayRect: { x: number; y: number; width: number; height: number },
  dims: [number, number, number]
): { px: number; py: number } | null {
  const { x, y, width, height } = displayRect;
  if (width === 0 || height === 0) return null;

  let sliceI: number, sliceJ: number;
  let sliceW: number, sliceH: number;

  switch (orientation) {
    case 'axial':
      sliceI = ijk.i;
      sliceJ = ijk.j;
      sliceW = dims[0];
      sliceH = dims[1];
      break;
    case 'coronal':
      sliceI = ijk.i;
      sliceJ = ijk.k;
      sliceW = dims[0];
      sliceH = dims[2];
      break;
    case 'sagittal':
      sliceI = ijk.j;
      sliceJ = ijk.k;
      sliceW = dims[1];
      sliceH = dims[2];
      break;
  }

  // Direct mapping: slice coords → pixel coords
  const nx = sliceI / Math.max(sliceW - 1, 1);
  const ny = sliceJ / Math.max(sliceH - 1, 1);

  return {
    px: x + nx * width,
    py: y + ny * height,
  };
}

// ─── Orientation Labels ──────────────────────────────────────────────────────

const ORIENTATION_LABELS: Record<SliceOrientation, { top: string; bottom: string; left: string; right: string }> = {
  axial: { top: 'A', bottom: 'P', left: 'R', right: 'L' },
  coronal: { top: 'S', bottom: 'I', left: 'R', right: 'L' },
  sagittal: { top: 'S', bottom: 'I', left: 'A', right: 'P' },
};

const OrientationLabels = memo(function OrientationLabels({ orientation }: { orientation: SliceOrientation }) {
  const labels = ORIENTATION_LABELS[orientation];
  return (
    <div className="orientation-labels">
      <div className="orientation-label orientation-label--top">{labels.top}</div>
      <div className="orientation-label orientation-label--bottom">{labels.bottom}</div>
      <div className="orientation-label orientation-label--left">{labels.left}</div>
      <div className="orientation-label orientation-label--right">{labels.right}</div>
    </div>
  );
});

// ─── Slice Viewer ───────────────────────────────────────────────────────────

interface SliceViewerProps {
  volume: NiftiVolume;
  orientation: SliceOrientation;
  windowLevel: WindowLevelState;
  crosshair: CrosshairPosition;
  onSliceChange: (ijk: CrosshairPosition) => void;
  onCrosshairMove: (ijk: CrosshairPosition) => void;
  enableCrosshair?: boolean;
}

const SliceViewer = memo(function SliceViewer({
  volume,
  orientation,
  windowLevel,
  crosshair,
  onSliceChange,
  onCrosshairMove,
  enableCrosshair = true,
}: SliceViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<WebGLSliceView | null>(null);

  // Refs for crosshair DOM elements (direct manipulation, no re-render)
  const hLineRef = useRef<HTMLDivElement>(null);
  const vLineRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);

  // Track canvas readiness
  const [canvasReady, setCanvasReady] = useState(false);

  // Derive dims once per volume
  const dims = useMemo(
    () => volume.dimensions as [number, number, number],
    [volume.dimensions]
  );

  // ── Create WebGL view ──────────────────────────────────────────────────
  useEffect(() => {
    const wrapper = canvasWrapperRef.current;
    const container = containerRef.current;
    if (!wrapper || !container) return;

    // Derive initial slice from crosshair
    let initialSlice: number;
    let maxSlice: number;
    switch (orientation) {
      case 'axial':    initialSlice = crosshair.k; maxSlice = dims[2] - 1; break;
      case 'coronal':  initialSlice = crosshair.j; maxSlice = dims[1] - 1; break;
      case 'sagittal': initialSlice = crosshair.i; maxSlice = dims[0] - 1; break;
    }
    initialSlice = Math.max(0, Math.min(initialSlice, maxSlice));

    const view = createWebGLSliceView(volume, {
      container: wrapper,
      orientation,
      initialWindowLevel: { window: windowLevel.window, level: windowLevel.level },
      initialSliceIndex: initialSlice,
    });
    viewRef.current = view;
    setCanvasReady(true);

    return () => {
      view.dispose();
      viewRef.current = null;
      setCanvasReady(false);
    };
  }, [volume, orientation]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Apply window/level ────────────────────────────────────────────────
  useEffect(() => {
    viewRef.current?.setWindowLevel(windowLevel.window, windowLevel.level);
  }, [windowLevel.window, windowLevel.level]);

  // ── Sync slice index with crosshair (RAF throttled) ───────────────────────────
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    let targetSlice: number;
    switch (orientation) {
      case 'axial':    targetSlice = crosshair.k; break;
      case 'coronal':  targetSlice = crosshair.j; break;
      case 'sagittal': targetSlice = crosshair.i; break;
    }

    // RAF throttle: only update once per animation frame
    const rafId = requestAnimationFrame(() => {
      if (view.getSliceIndex() !== targetSlice) {
        view.setSliceIndex(targetSlice);
      }
    });

    return () => cancelAnimationFrame(rafId);
  }, [crosshair.i, crosshair.j, crosshair.k, orientation]);

  // ── Update crosshair position ───────────────────────────────────────────
  useEffect(() => {
    if (!enableCrosshair || !canvasReady) return;

    const view = viewRef.current;
    if (!view) return;

    // Use the same displayRect as mouseToIJK (relative to canvas-wrapper)
    const displayRect = view.getDisplayRect();
    const pixels = crosshairToPixels(crosshair, orientation, displayRect, dims);
    if (!pixels) return;

    if (hLineRef.current) hLineRef.current.style.top = `${pixels.py}px`;
    if (vLineRef.current) vLineRef.current.style.left = `${pixels.px}px`;
    if (dotRef.current) {
      dotRef.current.style.left = `${pixels.px}px`;
      dotRef.current.style.top = `${pixels.py}px`;
    }
  }, [canvasReady, crosshair.i, crosshair.j, crosshair.k, orientation, dims, enableCrosshair]);

  // ── Resize handler ────────────────────────────────────────────────────
  useEffect(() => {
    if (!enableCrosshair) return;

    const updateCrosshair = () => {
      const view = viewRef.current;
      if (!view) return;

      const displayRect = view.getDisplayRect();
      const pixels = crosshairToPixels(crosshair, orientation, displayRect, dims);
      if (!pixels) return;

      if (hLineRef.current) hLineRef.current.style.top = `${pixels.py}px`;
      if (vLineRef.current) vLineRef.current.style.left = `${pixels.px}px`;
      if (dotRef.current) {
        dotRef.current.style.left = `${pixels.px}px`;
        dotRef.current.style.top = `${pixels.py}px`;
      }
    };

    window.addEventListener('resize', updateCrosshair);
    return () => window.removeEventListener('resize', updateCrosshair);
  }, [canvasReady, crosshair, orientation, dims, enableCrosshair]);

  // ── Mouse interaction handlers ──────────────────────────────────────────
  const isDragging = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const view = viewRef.current;
    const wrapper = canvasWrapperRef.current;
    if (!view || !wrapper) return;

    const wrapperRect = wrapper.getBoundingClientRect();
    const localX = e.clientX - wrapperRect.left;
    const localY = e.clientY - wrapperRect.top;

    const ijk = view.mouseToIJK(localX, localY);
    if (!ijk) return;

    isDragging.current = true;
    onCrosshairMove(ijk);
  }, [onCrosshairMove]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const view = viewRef.current;
    const wrapper = canvasWrapperRef.current;
    if (!view || !wrapper) return;

    const wrapperRect = wrapper.getBoundingClientRect();
    const localX = e.clientX - wrapperRect.left;
    const localY = e.clientY - wrapperRect.top;

    const ijk = view.mouseToIJK(localX, localY);
    if (!ijk) return;
    onCrosshairMove(ijk);
  }, [onCrosshairMove]);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const view = viewRef.current;
    if (!view) return;

    const newIndex = view.getSliceIndex() + (e.deltaY > 0 ? 1 : -1);
    const dims = volume.dimensions;
    let maxIndex: number;
    switch (orientation) {
      case 'axial':    maxIndex = dims[2] - 1; break;
      case 'coronal':  maxIndex = dims[1] - 1; break;
      case 'sagittal': maxIndex = dims[0] - 1; break;
    }
    newIndex !== view.getSliceIndex() && view.setSliceIndex(Math.max(0, Math.min(newIndex, maxIndex)));

    // Update crosshair to reflect new slice
    const curr = { ...crosshair };
    switch (orientation) {
      case 'axial':    curr.k = view.getSliceIndex(); break;
      case 'coronal':  curr.j = view.getSliceIndex(); break;
      case 'sagittal': curr.i = view.getSliceIndex(); break;
    }
    onSliceChange(curr);
  }, [orientation, volume.dimensions, crosshair, onSliceChange]);

  const colors = CROSSHAIR_COLORS[orientation];

  return (
    <div
      ref={containerRef}
      className="slice-viewer"
      style={{ border: `1px solid ${ORIENTATION_COLORS[orientation]}` }}
    >
      <div ref={canvasWrapperRef} className="canvas-wrapper" />
      {enableCrosshair && (
        <div className="crosshair-overlay">
          <div ref={hLineRef} className="crosshair-line crosshair-line--h" style={{ background: colors.h }} />
          <div ref={vLineRef} className="crosshair-line crosshair-line--v" style={{ background: colors.v }} />
          <div ref={dotRef} className="crosshair-dot" style={{ background: ORIENTATION_COLORS[orientation] }} />
        </div>
      )}
      <OrientationLabels orientation={orientation} />
      {/* Mouse capture layer */}
      <div
        style={{ position: 'absolute', inset: 0, cursor: 'crosshair' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />
    </div>
  );
});

// ─── Oblique Slice Viewer ────────────────────────────────────────────────────

interface ObliqueSliceViewerProps {
  volume: NiftiVolume;
  orientation: SliceOrientation;
  windowLevel: WindowLevelState;
  /** Shared extractor (with pre-normalized data) */
  extractor?: ObliqueExtractorType;
}

/**
 * Single oblique slice viewer.
 * Renders an oblique slice using ObliquePlane + ObliqueExtractor + WebGLSliceView.
 * Scroll wheel adjusts the plane's focal point along its normal axis.
 */
const ObliqueSliceViewer = memo(function ObliqueSliceViewer({
  volume,
  orientation,
  windowLevel,
  extractor,
}: ObliqueSliceViewerProps & { extractor: ObliqueExtractorType }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<WebGLSliceView | null>(null);
  const planeRef = useRef<ObliquePlane | null>(null);

  // ── Create plane and view (extractor shared from parent) ──────────────
  useEffect(() => {
    const wrapper = canvasWrapperRef.current;
    if (!wrapper) return;

    const plane = createObliquePlane({ volume, baseOrientation: orientation });
    planeRef.current = plane;

    const computed = plane.getComputed();
    const view = createWebGLSliceView(volume, {
      container: wrapper,
      orientation,
      initialWindowLevel: { window: windowLevel.window, level: windowLevel.level },
    });

    view.setObliquePlane(computed, extractor);
    viewRef.current = view;

    return () => {
      view.dispose();
      viewRef.current = null;
      planeRef.current = null;
    };
  }, [volume, orientation, extractor]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Apply window/level ────────────────────────────────────────────────
  useEffect(() => {
    viewRef.current?.setWindowLevel(windowLevel.window, windowLevel.level);
  }, [windowLevel.window, windowLevel.level]);

  // ── Scroll wheel: move focal point along normal ───────────────────────
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const plane = planeRef.current;
    const view = viewRef.current;
    if (!plane || !view) return;

    const ijk = plane.getFocalPointIjk();
    const step = e.deltaY > 0 ? 1 : -1;

    let newIjk = { ...ijk };
    switch (orientation) {
      case 'axial':    newIjk.k += step; break;
      case 'coronal':  newIjk.j += step; break;
      case 'sagittal': newIjk.i += step; break;
    }

    const dims = volume.dimensions;
    newIjk.i = Math.max(0, Math.min(dims[0] - 1, newIjk.i));
    newIjk.j = Math.max(0, Math.min(dims[1] - 1, newIjk.j));
    newIjk.k = Math.max(0, Math.min(dims[2] - 1, newIjk.k));

    plane.setFocalPointIjk(newIjk);
    view.setObliquePlane(plane.getComputed(), extractor);
  }, [orientation, volume.dimensions, extractor]);

  return (
    <div
      ref={containerRef}
      className="slice-viewer"
      style={{ border: `1px solid ${ORIENTATION_COLORS[orientation]}` }}
    >
      <div ref={canvasWrapperRef} className="canvas-wrapper" />
      <OrientationLabels orientation={orientation} />
      <div
        style={{ position: 'absolute', inset: 0, cursor: 'crosshair' }}
        onWheel={handleWheel}
      />
    </div>
  );
});

// ─── Oblique MPR Viewer ────────────────────────────────────────────────────

interface ObliqueMPRViewerProps {
  volume: NiftiVolume;
  windowLevel: WindowLevelState;
}

function ObliqueMPRViewer({ volume, windowLevel }: ObliqueMPRViewerProps) {
  // Use state so React re-renders when extractor is ready
  const [extractor, setExtractor] = useState<ObliqueExtractorType | null>(null);
  // Keep a ref for cleanup
  const sharedViewRef = useRef<WebGLSliceView | null>(null);

  useEffect(() => {
    // Create one hidden slice extractor just to get normalizedData
    const container = document.createElement('div');
    container.style.display = 'none';
    document.body.appendChild(container);

    const view = createWebGLSliceView(volume, {
      container,
      orientation: 'axial',
      initialWindowLevel: { window: 255, level: 128 },
    });
    sharedViewRef.current = view;

    const normalizedData = view.getNormalizedData();
    const ext = createObliqueExtractor({ volume, normalizedData });

    // Debug: test extraction
    const testPlane = createObliquePlane({ volume, baseOrientation: 'axial' });
    const computed = testPlane.getComputed();
    const testResult = ext.extractSlice(computed);
    console.log('[ObliqueMPRViewer] normalizedData length:', normalizedData.length);
    console.log('[ObliqueMPRViewer] plane computed:', computed.width, 'x', computed.height);
    console.log('[ObliqueMPRViewer] extractSlice result:', testResult.width, 'x', testResult.height, 'nonZero:', testResult.data.filter(v => v > 0).length);

    // Use setState so children re-render with the extractor
    setExtractor(ext);

    return () => {
      view.dispose();
      container.remove();
      sharedViewRef.current = null;
      setExtractor(null);
    };
  }, [volume]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="viewer-mpr">
      <div className="mpr-left">
        {extractor ? (
          <ObliqueSliceViewer
            volume={volume}
            orientation="axial"
            windowLevel={windowLevel}
            extractor={extractor}
          />
        ) : <LoadingSpinner />}
        <div className="mpr-label">Axial (Oblique)</div>
      </div>
      <div className="mpr-right">
        <div className="mpr-right-top">
          {extractor ? (
            <ObliqueSliceViewer
              volume={volume}
              orientation="coronal"
              windowLevel={windowLevel}
              extractor={extractor}
            />
          ) : <LoadingSpinner />}
          <div className="mpr-label">Coronal (Oblique)</div>
        </div>
        <div className="mpr-right-bottom">
          {extractor ? (
            <ObliqueSliceViewer
              volume={volume}
              orientation="sagittal"
              windowLevel={windowLevel}
              extractor={extractor}
            />
          ) : <LoadingSpinner />}
          <div className="mpr-label">Sagittal (Oblique)</div>
        </div>
      </div>
    </div>
  );
}

// ─── MPR Viewer ──────────────────────────────────────────────────────────────

interface MPRViewerProps {
  volume: NiftiVolume;
  crosshair: CrosshairPosition;
  windowLevel: WindowLevelState;
  onCrosshairChange: (ijk: CrosshairPosition) => void;
}

function MPRViewer({ volume, crosshair, windowLevel, onCrosshairChange }: MPRViewerProps) {
  const handleSliceChange = useCallback((ijk: CrosshairPosition) => {
    onCrosshairChange(ijk);
  }, [onCrosshairChange]);

  const handleCrosshairMove = useCallback((ijk: CrosshairPosition) => {
    onCrosshairChange(ijk);
  }, [onCrosshairChange]);

  return (
    <div className="viewer-mpr">
      <div className="mpr-left">
        <SliceViewer
          volume={volume}
          orientation="axial"
          windowLevel={windowLevel}
          crosshair={crosshair}
          onSliceChange={handleSliceChange}
          onCrosshairMove={handleCrosshairMove}
        />
        <div className="mpr-label">Axial</div>
      </div>
      <div className="mpr-right">
        <div className="mpr-right-top">
          <SliceViewer
            volume={volume}
            orientation="coronal"
            windowLevel={windowLevel}
            crosshair={crosshair}
            onSliceChange={handleSliceChange}
            onCrosshairMove={handleCrosshairMove}
          />
          <div className="mpr-label">Coronal</div>
        </div>
        <div className="mpr-right-bottom">
          <SliceViewer
            volume={volume}
            orientation="sagittal"
            windowLevel={windowLevel}
            crosshair={crosshair}
            onSliceChange={handleSliceChange}
            onCrosshairMove={handleCrosshairMove}
          />
          <div className="mpr-label">Sagittal</div>
        </div>
      </div>
    </div>
  );
}

// ─── Single Viewer ───────────────────────────────────────────────────────────

interface SingleViewerProps {
  volume: NiftiVolume;
  crosshair: CrosshairPosition;
  windowLevel: WindowLevelState;
  onCrosshairChange: (ijk: CrosshairPosition) => void;
}

function SingleViewer({ volume, crosshair, windowLevel, onCrosshairChange }: SingleViewerProps) {
  const handleSliceChange = useCallback((ijk: CrosshairPosition) => {
    onCrosshairChange(ijk);
  }, [onCrosshairChange]);

  const handleCrosshairMove = useCallback((ijk: CrosshairPosition) => {
    onCrosshairChange(ijk);
  }, [onCrosshairChange]);

  return (
    <SliceViewer
      volume={volume}
      orientation="axial"
      windowLevel={windowLevel}
      crosshair={crosshair}
      onSliceChange={handleSliceChange}
      onCrosshairMove={handleCrosshairMove}
      enableCrosshair={false}
    />
  );
}

// ─── Header ─────────────────────────────────────────────────────────────────

function Header({ viewMode, mprEnabled, crosshair, onViewModeChange }: {
  viewMode: 'single' | 'mpr' | 'oblique';
  mprEnabled: boolean;
  crosshair: CrosshairPosition | null;
  onViewModeChange: (mode: 'single' | 'mpr' | 'oblique') => void;
}) {
  return (
    <header className="header">
      <span className="header__title">jsMed (WebGL)</span>
      <div className="header__controls">
        {crosshair && viewMode !== 'oblique' && (
          <span className="header__coords">
            I:{crosshair.i} J:{crosshair.j} K:{crosshair.k}
          </span>
        )}
        <button
          className={`mpr-btn${viewMode === 'mpr' ? ' active' : ''}`}
          disabled={!mprEnabled}
          onClick={() => onViewModeChange(viewMode === 'mpr' ? 'single' : 'mpr')}
        >
          {viewMode === 'mpr' ? 'Exit MPR' : 'MPR Mode'}
        </button>
        <button
          className={`mpr-btn oblique-btn${viewMode === 'oblique' ? ' active' : ''}`}
          disabled={!mprEnabled}
          onClick={() => onViewModeChange(viewMode === 'oblique' ? 'single' : 'oblique')}
        >
          {viewMode === 'oblique' ? 'Exit Oblique' : 'Oblique'}
        </button>
        <span className="header__version">v0.1.0</span>
      </div>
    </header>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function FileSection({ error, onFileSelect }: { error: string | null; onFileSelect: (file: File) => void }) {
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFileSelect(file);
  }, [onFileSelect]);

  return (
    <div className="sidebar__section">
      <div className="sidebar__section-title">File</div>
      <label className="file-btn">
        Open NIfTI File
        <input type="file" accept=".nii,.nii.gz" onChange={handleChange} style={{ display: 'none' }} />
      </label>
      {error && <div className="sidebar__error">{error}</div>}
    </div>
  );
}

function VolumeInfo({ volume }: { volume: NiftiVolume }) {
  const dims = volume.dimensions.join(' × ');
  const spacing = volume.spacing.map((s: number) => s.toFixed(3)).join(' × ');
  const typeName = DATATYPE_NAMES[volume.header.datatype] ?? String(volume.header.datatype);

  return (
    <div className="sidebar__section">
      <div className="sidebar__section-title">Volume</div>
      <div className="info-row">
        <span className="info-row__label">Dimensions</span>
        <span>{dims}</span>
      </div>
      <div className="info-row">
        <span className="info-row__label">Spacing</span>
        <span>{spacing}</span>
      </div>
      <div className="info-row">
        <span className="info-row__label">Type</span>
        <span>{typeName}</span>
      </div>
    </div>
  );
}

function ViewControls({ windowLevel, onWindowLevelChange }: {
  windowLevel: WindowLevelState;
  onWindowLevelChange: (wl: WindowLevelState) => void;
}) {
  const handleWindow = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onWindowLevelChange({ window: Number(e.target.value), level: windowLevel.level });
  }, [windowLevel.level, onWindowLevelChange]);

  const handleLevel = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onWindowLevelChange({ window: windowLevel.window, level: Number(e.target.value) });
  }, [windowLevel.window, onWindowLevelChange]);

  const handlePreset = useCallback((wl: WindowLevelState) => {
    onWindowLevelChange(wl);
  }, [onWindowLevelChange]);

  return (
    <div className="sidebar__section">
      <div className="sidebar__section-title">Window / Level</div>

      <div className="control-row">
        <label className="control-row__label">
          W: <span className="control-row__value">{windowLevel.window}</span>
        </label>
        <input type="range" min={1} max={500} value={windowLevel.window} onChange={handleWindow} />
      </div>

      <div className="control-row">
        <label className="control-row__label">
          L: <span className="control-row__value">{windowLevel.level}</span>
        </label>
        <input type="range" min={0} max={255} value={windowLevel.level} onChange={handleLevel} />
      </div>

      <div className="presets">
        {WL_PRESETS.map((p) => (
          <button key={p.label} className="preset-btn" onClick={() => handlePreset({ window: p.window, level: p.level })}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Drop Overlay ─────────────────────────────────────────────────────────────

function DropOverlay({ isDragOver }: { isDragOver: boolean }) {
  return (
    <div className={`drop-overlay${isDragOver ? ' active' : ''}`}>
      <div>Drop .nii or .nii.gz file here</div>
      <div className="drop-overlay__hint">or use the Open button in the sidebar</div>
    </div>
  );
}

// ─── Loading Spinner ─────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="loading-spinner">
      <div className="loading-spinner__ring" />
      <div className="loading-spinner__text">Loading...</div>
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [volume, setVolume] = useState<NiftiVolume | null>(null);
  const [viewMode, setViewMode] = useState<'single' | 'mpr' | 'oblique'>('single');
  const [isDragOver, setIsDragOver] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // Guard against React StrictMode double-invocation in development
  const autoLoadRan = useRef(false);
  const [windowLevel, setWindowLevel] = useState<WindowLevelState>({ window: 255, level: 128 });
  const [crosshair, setCrosshair] = useState<CrosshairPosition | null>(null);

  // Derive initial crosshair from volume dimensions
  const initialCrosshair = useMemo<CrosshairPosition | null>(() => {
    if (!volume) return null;
    const [d0, d1, d2] = volume.dimensions;
    return {
      i: Math.floor(d0 / 2),
      j: Math.floor(d1 / 2),
      k: Math.floor(d2 / 2),
    };
  }, [volume]);

  useEffect(() => {
    setCrosshair(initialCrosshair);
  }, [initialCrosshair]);

  // ── File loading ──────────────────────────────────────────────────────────
  const loadVolume = useCallback(async (file: File) => {
    try {
      setIsLoading(true);
      setLoadError(null);
      const buffer = await file.arrayBuffer();
      const vol = await parseNifti(buffer);
      setVolume(vol);
      setViewMode('single');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ── Drag & drop ─────────────────────────────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer?.files[0];
    if (file && (file.name.endsWith('.nii') || file.name.endsWith('.nii.gz'))) {
      loadVolume(file);
    }
  }, [loadVolume]);

  // ── Auto-load demo file ──────────────────────────────────────────────────
  useEffect(() => {
    if (autoLoadRan.current) return;
    autoLoadRan.current = true;

    setIsLoading(true);
    fetch('/fixtures/img-3d.nii.gz')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return res.arrayBuffer();
      })
      .then((buf) => parseNifti(buf))
      .then((vol) => {
        setVolume(vol);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load demo file:', err);
        setLoadError('Failed to load demo file. Please try loading a file manually.');
        setIsLoading(false);
      });
  }, []);

  return (
    <div className="app">
      <Header
        viewMode={viewMode}
        mprEnabled={volume !== null}
        crosshair={crosshair}
        onViewModeChange={setViewMode}
      />
      <div className="body">
        <aside className="sidebar">
          <FileSection error={loadError} onFileSelect={loadVolume} />
          {volume && <VolumeInfo volume={volume} />}
          {volume && (
            <ViewControls windowLevel={windowLevel} onWindowLevelChange={setWindowLevel} />
          )}
        </aside>
        {isLoading ? (
          <div className="viewer-area">
            <LoadingSpinner />
          </div>
        ) : volume ? (
          viewMode === 'oblique' ? (
            <ObliqueMPRViewer volume={volume} windowLevel={windowLevel} />
          ) : viewMode === 'mpr' && crosshair ? (
            <MPRViewer
              volume={volume}
              crosshair={crosshair}
              windowLevel={windowLevel}
              onCrosshairChange={setCrosshair}
            />
          ) : crosshair ? (
            <SingleViewer
              volume={volume}
              crosshair={crosshair}
              windowLevel={windowLevel}
              onCrosshairChange={setCrosshair}
            />
          ) : null
        ) : (
          <div
            className="viewer-area"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <DropOverlay isDragOver={isDragOver} />
          </div>
        )}
      </div>
    </div>
  );
}
