// jsMedgl Demo - NIfTI Viewer with WebGL Rendering and MPR Support
import { useState, useRef, useCallback, useEffect } from 'react';
import { parseNifti } from '@jsmedgl/parser-nifti';
import { createWebGLSliceView, type WebGLSliceView } from '@jsmedgl/renderer-2d';
import type { NiftiVolume } from '@jsmedgl/parser-nifti';
import './styles.css';

// ─── Derived types ──────────────────────────────────────────────────────────

const DATATYPE_NAMES: Record<number, string> = {
  2: 'UINT8', 4: 'INT16', 8: 'INT32', 16: 'FLOAT32', 64: 'FLOAT64', 128: 'RGB24',
};

interface WindowLevelState {
  window: number;
  level: number;
}

// ─── WINDOW / LEVEL PRESETS ─────────────────────────────────────────────────

const WL_PRESETS: Array<{ label: string; window: number; level: number }> = [
  { label: 'Default', window: 255, level: 128 },
  { label: 'Brain', window: 80, level: 40 },
  { label: 'Bone', window: 2000, level: 500 },
];

// ─── SLICE VIEW REFS (no re-renders on W/L change) ─────────────────────────

function useSliceViewRefs() {
  const axialRef = useRef<WebGLSliceView | null>(null);
  const coronalRef = useRef<WebGLSliceView | null>(null);
  const sagittalRef = useRef<WebGLSliceView | null>(null);
  const singleRef = useRef<WebGLSliceView | null>(null);

  const disposeAll = useCallback(() => {
    axialRef.current?.dispose();
    coronalRef.current?.dispose();
    sagittalRef.current?.dispose();
    singleRef.current?.dispose();
    axialRef.current = null;
    coronalRef.current = null;
    sagittalRef.current = null;
    singleRef.current = null;
  }, []);

  return { axialRef, coronalRef, sagittalRef, singleRef, disposeAll };
}

// ─── VIEW AREA ─────────────────────────────────────────────────────────────

interface ViewAreaProps {
  volume: NiftiVolume;
  isMPRMode: boolean;
  windowLevel: WindowLevelState;
}

function ViewArea({ volume, isMPRMode, windowLevel }: ViewAreaProps) {
  const { axialRef, coronalRef, sagittalRef, singleRef, disposeAll } = useSliceViewRefs();

  useEffect(() => {
    disposeAll();

    const wl = { window: windowLevel.window, level: windowLevel.level };

    if (isMPRMode) {
      const axialEl = document.getElementById('viewer-axial');
      const coronalEl = document.getElementById('viewer-coronal');
      const sagittalEl = document.getElementById('viewer-sagittal');
      if (axialEl) axialRef.current = createWebGLSliceView(volume, { container: axialEl, orientation: 'axial', initialWindowLevel: wl });
      if (coronalEl) coronalRef.current = createWebGLSliceView(volume, { container: coronalEl, orientation: 'coronal', initialWindowLevel: wl });
      if (sagittalEl) sagittalRef.current = createWebGLSliceView(volume, { container: sagittalEl, orientation: 'sagittal', initialWindowLevel: wl });
    } else {
      const singleEl = document.getElementById('viewer-single');
      if (singleEl) singleRef.current = createWebGLSliceView(volume, { container: singleEl, orientation: 'axial', initialWindowLevel: wl });
    }

    return () => { disposeAll(); };
  }, [volume, isMPRMode, disposeAll]);

  // Apply W/L to all active views (no re-creation needed)
  useEffect(() => {
    const wl = { window: windowLevel.window, level: windowLevel.level };
    axialRef.current?.setWindowLevel(wl.window, wl.level);
    coronalRef.current?.setWindowLevel(wl.window, wl.level);
    sagittalRef.current?.setWindowLevel(wl.window, wl.level);
    singleRef.current?.setWindowLevel(wl.window, wl.level);
  }, [windowLevel.window, windowLevel.level]);

  return (
    <div className="viewer-area">
      {isMPRMode ? <MPRViewer /> : <SingleViewer />}
    </div>
  );
}

function SingleViewer() {
  return <div id="viewer-single" className="viewer viewer--single" />;
}

function MPRViewer() {
  return (
    <div className="viewer-mpr">
      <div className="mpr-left">
        <div id="viewer-axial" className="mpr-view" />
        <div className="mpr-label">Axial</div>
      </div>
      <div className="mpr-right">
        <div className="mpr-right-top">
          <div id="viewer-coronal" className="mpr-view" />
          <div className="mpr-label">Coronal</div>
        </div>
        <div className="mpr-right-bottom">
          <div id="viewer-sagittal" className="mpr-view" />
          <div className="mpr-label">Sagittal</div>
        </div>
      </div>
    </div>
  );
}

// ─── HEADER ────────────────────────────────────────────────────────────────

interface HeaderProps {
  isMPRMode: boolean;
  mprEnabled: boolean;
  onToggleMPR: () => void;
}

function Header({ isMPRMode, mprEnabled, onToggleMPR }: HeaderProps) {
  return (
    <header className="header">
      <span className="header__title">jsMed (WebGL)</span>
      <div className="header__controls">
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

// ─── FILE SECTION ──────────────────────────────────────────────────────────

interface FileSectionProps {
  error: string | null;
  onFileSelect: (file: File) => void;
}

function FileSection({ error, onFileSelect }: FileSectionProps) {
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFileSelect(file);
  }, [onFileSelect]);

  return (
    <div className="sidebar__section">
      <div className="sidebar__section-title">File</div>
      <label className="file-btn">
        Open NIfTI File
        <input
          type="file"
          accept=".nii,.nii.gz"
          onChange={handleChange}
          style={{ display: 'none' }}
        />
      </label>
      {error && <div className="sidebar__error">{error}</div>}
    </div>
  );
}

// ─── VOLUME INFO ───────────────────────────────────────────────────────────

interface VolumeInfoProps {
  volume: NiftiVolume;
}

function VolumeInfo({ volume }: VolumeInfoProps) {
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

// ─── VIEW CONTROLS ─────────────────────────────────────────────────────────

interface ViewControlsProps {
  windowLevel: WindowLevelState;
  onWindowLevelChange: (wl: WindowLevelState) => void;
}

function ViewControls({ windowLevel, onWindowLevelChange }: ViewControlsProps) {
  const handleWindow = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onWindowLevelChange({ ...windowLevel, window: Number(e.target.value) });
  }, [windowLevel, onWindowLevelChange]);

  const handleLevel = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onWindowLevelChange({ ...windowLevel, level: Number(e.target.value) });
  }, [windowLevel, onWindowLevelChange]);

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
        <input
          type="range"
          min={1}
          max={500}
          value={windowLevel.window}
          onChange={handleWindow}
        />
      </div>

      <div className="control-row">
        <label className="control-row__label">
          L: <span className="control-row__value">{windowLevel.level}</span>
        </label>
        <input
          type="range"
          min={0}
          max={255}
          value={windowLevel.level}
          onChange={handleLevel}
        />
      </div>

      <div className="presets">
        {WL_PRESETS.map((p) => (
          <button
            key={p.label}
            className="preset-btn"
            onClick={() => handlePreset({ window: p.window, level: p.level })}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── SIDEBAR ───────────────────────────────────────────────────────────────

interface SidebarProps {
  volume: NiftiVolume | null;
  error: string | null;
  windowLevel: WindowLevelState;
  onFileSelect: (file: File) => void;
  onWindowLevelChange: (wl: WindowLevelState) => void;
}

function Sidebar({ volume, error, windowLevel, onFileSelect, onWindowLevelChange }: SidebarProps) {
  return (
    <aside className="sidebar">
      <FileSection error={error} onFileSelect={onFileSelect} />
      {volume && <VolumeInfo volume={volume} />}
      {volume && (
        <ViewControls
          windowLevel={windowLevel}
          onWindowLevelChange={onWindowLevelChange}
        />
      )}
    </aside>
  );
}

// ─── DROP OVERLAY ──────────────────────────────────────────────────────────

interface DropOverlayProps {
  isDragOver: boolean;
}

function DropOverlay({ isDragOver }: DropOverlayProps) {
  return (
    <div className={`drop-overlay${isDragOver ? ' active' : ''}`}>
      <div>Drop .nii or .nii.gz file here</div>
      <div className="drop-overlay__hint">or use the Open button in the sidebar</div>
    </div>
  );
}

// ─── BODY ──────────────────────────────────────────────────────────────────

interface BodyProps {
  volume: NiftiVolume | null;
  isMPRMode: boolean;
  isDragOver: boolean;
  error: string | null;
  windowLevel: WindowLevelState;
  onFileSelect: (file: File) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onWindowLevelChange: (wl: WindowLevelState) => void;
}

function Body({
  volume,
  isMPRMode,
  isDragOver,
  error,
  windowLevel,
  onFileSelect,
  onDragOver,
  onDragLeave,
  onDrop,
  onWindowLevelChange,
}: BodyProps) {
  return (
    <div className="body">
      <Sidebar
        volume={volume}
        error={error}
        windowLevel={windowLevel}
        onFileSelect={onFileSelect}
        onWindowLevelChange={onWindowLevelChange}
      />
      {volume ? (
        <ViewArea volume={volume} isMPRMode={isMPRMode} windowLevel={windowLevel} />
      ) : (
        <div
          className="viewer-area"
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <DropOverlay isDragOver={isDragOver} />
        </div>
      )}
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────

export default function App() {
  const [volume, setVolume] = useState<NiftiVolume | null>(null);
  const [isMPRMode, setIsMPRMode] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [windowLevel, setWindowLevel] = useState<WindowLevelState>({ window: 255, level: 128 });

  // ── File loading ─────────────────────────────────────────────────────────
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

  const handleFileSelect = useCallback((file: File) => {
    loadVolume(file);
  }, [loadVolume]);

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
      .then((res) => {
        if (!res.ok) return null;
        return res.arrayBuffer();
      })
      .then((buf) => {
        if (!buf) return;
        return parseNifti(buf);
      })
      .then((vol) => {
        if (vol) setVolume(vol);
      })
      .catch(() => {});
  }, []);

  // ── Toggle MPR ───────────────────────────────────────────────────────────
  const toggleMPR = useCallback(() => {
    setIsMPRMode((prev) => !prev);
  }, []);

  // ── Window / Level ──────────────────────────────────────────────────────
  const handleWindowLevelChange = useCallback((wl: WindowLevelState) => {
    setWindowLevel(wl);
  }, []);

  return (
    <div className="app">
      <Header
        isMPRMode={isMPRMode}
        mprEnabled={volume !== null}
        onToggleMPR={toggleMPR}
      />
      <Body
        volume={volume}
        isMPRMode={isMPRMode}
        isDragOver={isDragOver}
        error={loadError}
        windowLevel={windowLevel}
        onFileSelect={handleFileSelect}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onWindowLevelChange={handleWindowLevelChange}
      />
    </div>
  );
}
