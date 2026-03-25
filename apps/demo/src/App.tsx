// jsMedgl Demo - NIfTI Viewer with WebGL Rendering and MPR Support
import { memo, useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { parseNifti } from '@jsmedgl/parser-nifti';
import { createWebGLSliceView, type WebGLSliceView } from '@jsmedgl/renderer-2d';
import type { NiftiVolume } from '@jsmedgl/parser-nifti';
import type { SliceOrientation, CrosshairPosition } from '@jsmedgl/renderer-2d';
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
  axial: { top: 'A', bottom: 'P', left: 'L', right: 'R' },
  coronal: { top: 'S', bottom: 'I', left: 'L', right: 'R' },
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
          <div ref={dotRef} className="crosshair-dot" style={{ background: colors.v }} />
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

function Header({ isMPRMode, mprEnabled, crosshair, onToggleMPR }: {
  isMPRMode: boolean;
  mprEnabled: boolean;
  crosshair: CrosshairPosition | null;
  onToggleMPR: () => void;
}) {
  return (
    <header className="header">
      <span className="header__title">jsMed (WebGL)</span>
      <div className="header__controls">
        {crosshair && (
          <span className="header__coords">
            I:{crosshair.i} J:{crosshair.j} K:{crosshair.k}
          </span>
        )}
        <button
          className={`mpr-btn${isMPRMode ? ' active' : ''}`}
          disabled={!mprEnabled}
          onClick={onToggleMPR}
        >
          {isMPRMode ? 'Exit MPR' : 'MPR Mode'}
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

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [volume, setVolume] = useState<NiftiVolume | null>(null);
  const [isMPRMode, setIsMPRMode] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
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
      setLoadError(null);
      const buffer = await file.arrayBuffer();
      const vol = await parseNifti(buffer);
      setVolume(vol);
      setIsMPRMode(false);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
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
    fetch('/fixtures/img-3d.nii.gz')
      .then((res) => (!res.ok ? null : res.arrayBuffer()))
      .then((buf) => (!buf ? null : parseNifti(buf)))
      .then((vol) => { if (vol) setVolume(vol); })
      .catch(() => {});
  }, []);

  // ── Toggle MPR ───────────────────────────────────────────────────────────
  const toggleMPR = useCallback(() => {
    setIsMPRMode((prev) => !prev);
  }, []);

  return (
    <div className="app">
      <Header
        isMPRMode={isMPRMode}
        mprEnabled={volume !== null}
        crosshair={crosshair}
        onToggleMPR={toggleMPR}
      />
      <div className="body">
        <aside className="sidebar">
          <FileSection error={loadError} onFileSelect={loadVolume} />
          {volume && <VolumeInfo volume={volume} />}
          {volume && (
            <ViewControls windowLevel={windowLevel} onWindowLevelChange={setWindowLevel} />
          )}
        </aside>
        {volume && crosshair ? (
          isMPRMode ? (
            <MPRViewer
              volume={volume}
              crosshair={crosshair}
              windowLevel={windowLevel}
              onCrosshairChange={setCrosshair}
            />
          ) : (
            <SingleViewer
              volume={volume}
              crosshair={crosshair}
              windowLevel={windowLevel}
              onCrosshairChange={setCrosshair}
            />
          )
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
