// jsMedgl Demo - DICOM Viewer with WebGL Rendering and MPR Support
import { memo, useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { DicomVolume } from '@jsmedgl/parser-dicom';
import type { NiftiVolume } from '@jsmedgl/parser-nifti';
import { createWebGLSliceView, type WebGLSliceView } from '@jsmedgl/renderer-2d';
import { createVolumeRenderView, type VolumeRenderView } from '@jsmedgl/renderer-3d';
import { DEFAULT_CAMERA_STATE, TISSUE_PRESETS } from '@jsmedgl/renderer-3d';
import type { CompositingMode, ColormapName } from '@jsmedgl/renderer-3d';
import {
  createObliquePlane,
  createObliqueExtractor,
  quaternionFromAxisAngle,
  type ObliquePlane,
  type ObliqueExtractor as ObliqueExtractorType,
} from '@jsmedgl/renderer-2d';
import type { SliceOrientation, CrosshairPosition } from '@jsmedgl/renderer-2d';
import type { Line3D } from '@jsmedgl/renderer-2d';
import { loadDicomFolder } from './dicom-loader';
import './styles.css';

// ─── Types ────────────────────────────────────────────────────────────────────

// DicomVolume and NiftiVolume are structurally compatible — renderer functions
// accept either via TypeScript structural typing.
type MedVolume = NiftiVolume | DicomVolume;

/**
 * Cast MedVolume to NiftiVolume for renderer APIs.
 * DicomVolume has the same rendering-relevant fields (data, dimensions, spacing,
 * affine, inverseAffine, header.datatype), so this is safe at runtime.
 */
function asNiftiVolume(volume: MedVolume): NiftiVolume {
  return volume as unknown as NiftiVolume;
}

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
  { label: 'Bone', window: 200, level: 200 },
  { label: 'Lung', window: 180, level: 50 },
  { label: 'Soft Tissue', window: 120, level: 100 },
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
  volume: MedVolume;
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

    const view = createWebGLSliceView(asNiftiVolume(volume), {
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
  volume: MedVolume;
  orientation: SliceOrientation;
  windowLevel: WindowLevelState;
  /** Shared extractor (with pre-normalized data) */
  extractor?: ObliqueExtractorType;
  /** Live plane instance — managed by parent */
  plane: ObliquePlane;
  /** Intersection of this view's plane with the other two */
  intersectionH: Line3D | null;
  intersectionV: Line3D | null;
  /** Callback to rotate the OTHER two planes — child sends deltaQ, parent applies to correct planes */
  onRotateOtherPlanes?: (deltaQ: [number, number, number, number]) => void;
  /** Callback when focal point changes via scroll wheel — parent should sync other planes */
  onFocalPointChange?: (ijk: CrosshairPosition) => void;
}

/**
 * Single oblique slice viewer.
 * Renders an oblique slice using ObliquePlane + ObliqueExtractor + WebGLSliceView.
 * - Scroll wheel: move focal point along plane normal
 * - Rotation handles at 1/4 & 3/4 of crosshair lines: rotate the plane
 */
const ObliqueSliceViewer = memo(function ObliqueSliceViewer({
  volume,
  orientation,
  windowLevel,
  extractor,
  plane,
  intersectionH,
  intersectionV,
  onRotateOtherPlanes,
  onFocalPointChange,
}: ObliqueSliceViewerProps & { extractor: ObliqueExtractorType }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<WebGLSliceView | null>(null);

  // Crosshair DOM refs
  const hLineRef = useRef<HTMLDivElement>(null);
  const vLineRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);

  // 4 rotation handle refs: [hLeft, hRight, vTop, vBottom]
  const handleRefs = [
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
  ];

  // Rotation drag state
  const lastAngle = useRef(0); // last mouse angle relative to crosshair center

  // ── Create view ────────────────────────────────────────────────────
  useEffect(() => {
    const wrapper = canvasWrapperRef.current;
    if (!wrapper) return;

    const view = createWebGLSliceView(asNiftiVolume(volume), {
      container: wrapper,
      orientation,
      initialWindowLevel: { window: windowLevel.window, level: windowLevel.level },
    });
    viewRef.current = view;

    view.setObliquePlane(plane.getComputed(), extractor);

    return () => {
      view.dispose();
      viewRef.current = null;
    };
  }, [volume, orientation]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Apply window/level ────────────────────────────────────────────────
  useEffect(() => {
    viewRef.current?.setWindowLevel(windowLevel.window, windowLevel.level);
  }, [windowLevel.window, windowLevel.level]);

  // ── Sync intersection lines, handles, and slice image to DOM ──────────
  // This runs every render — when the parent's renderTick changes, intersectionH/V
  // are recomputed, and we must also re-render the slice image if the plane rotated.
  useEffect(() => {
    if (!viewRef.current) return;
    const view = viewRef.current;
    const displayRect = view.getDisplayRect();

    // Re-render the slice image (plane may have rotated if this is one of the "other" planes)
    const computed = plane.getComputed();
    view.setObliquePlane(computed, extractor);

    const { width: fullW, height: fullH, center } = computed;

    // Helper: UV (plane-local) → screen px
    const uvToScreen = (u: number, v: number): { x: number; y: number } => ({
      x: displayRect.x + (u / fullW + 0.5) * displayRect.width,
      y: displayRect.y + (v / fullH + 0.5) * displayRect.height,
    });

    // Helper: clip line segment to UV box [-w/2, w/2] × [-h/2, h/2], returning endpoints in screen space
    const clipLineToView = (
      line: Line3D | null
    ): { p1: { x: number; y: number }; p2: { x: number; y: number } } | null => {
      if (!line) return null;

      // Direction of the 3D line in RAS space
      const dx = line.end[0] - line.start[0];
      const dy = line.end[1] - line.start[1];
      const dz = line.end[2] - line.start[2];
      const len3d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len3d < 1e-10) return null;

      // Normalize direction
      const dir: [number, number, number] = [dx / len3d, dy / len3d, dz / len3d];

      // Project direction to plane UV space
      const focal = plane.rasToPlane(center);
      if (!focal) return null;

      // Direction projection: sample a point slightly along dir and compare to focal
      const sampleRas: [number, number, number] = [
        center[0] + dir[0],
        center[1] + dir[1],
        center[2] + dir[2],
      ];
      const sampleUv = plane.rasToPlane(sampleRas);
      if (!sampleUv) return null;

      // UV direction from focal toward sample
      const dirU = sampleUv.u - focal.u;
      const dirV = sampleUv.v - focal.v;

      const halfW = fullW / 2;
      const halfH = fullH / 2;

      // Compute distances to UV boundary planes
      let tMinU = -Infinity, tMaxU = Infinity;
      let tMinV = -Infinity, tMaxV = Infinity;

      if (Math.abs(dirU) > 1e-10) {
        tMinU = (-halfW - focal.u) / dirU;
        tMaxU = (halfW - focal.u) / dirU;
        if (tMinU > tMaxU) { const tmp = tMinU; tMinU = tMaxU; tMaxU = tmp; }
      }
      if (Math.abs(dirV) > 1e-10) {
        tMinV = (-halfH - focal.v) / dirV;
        tMaxV = (halfH - focal.v) / dirV;
        if (tMinV > tMaxV) { const tmp = tMinV; tMinV = tMaxV; tMaxV = tmp; }
      }

      const tMin = Math.max(tMinU, tMinV);
      const tMax = Math.min(tMaxU, tMaxV);

      if (tMin >= tMax) return null;

      // RAS endpoints on plane boundary
      const ras1: [number, number, number] = [
        center[0] + dir[0] * tMin,
        center[1] + dir[1] * tMin,
        center[2] + dir[2] * tMin,
      ];
      const ras2: [number, number, number] = [
        center[0] + dir[0] * tMax,
        center[1] + dir[1] * tMax,
        center[2] + dir[2] * tMax,
      ];

      // RAS → UV → screen
      const uv1 = plane.rasToPlane(ras1);
      const uv2 = plane.rasToPlane(ras2);
      if (!uv1 || !uv2) return null;

      return {
        p1: uvToScreen(uv1.u, uv1.v),
        p2: uvToScreen(uv2.u, uv2.v),
      };
    };

    const renderLine = (
      ref: React.RefObject<HTMLDivElement | null>,
      line: Line3D | null,
      color: string
    ) => {
      if (!line || !ref.current) return;
      const pts = clipLineToView(line);
      if (!pts) return;
      const { p1, p2 } = pts;
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      const el = ref.current;
      el.style.left = `${p1.x}px`;
      el.style.top = `${p1.y}px`;
      el.style.width = `${len}px`;
      el.style.height = '1px';
      el.style.transformOrigin = '0 50%';
      el.style.transform = `rotate(${angle}deg)`;
      el.style.background = color;
    };

    renderLine(hLineRef, intersectionH, CROSSHAIR_COLORS[orientation].h);
    renderLine(vLineRef, intersectionV, CROSSHAIR_COLORS[orientation].v);

    // Center dot at focal point
    if (dotRef.current) {
      const focalUv = plane.rasToPlane(center);
      if (focalUv) {
        const fp = uvToScreen(focalUv.u, focalUv.v);
        dotRef.current.style.left = `${fp.x}px`;
        dotRef.current.style.top = `${fp.y}px`;
      }
    }

    // Rotation handles at 1/4 and 3/4 of clipped line
    const setHandle = (
      ref: React.RefObject<HTMLDivElement | null>,
      line: Line3D | null,
      t: number
    ) => {
      if (!line || !ref?.current) return;
      const pts = clipLineToView(line);
      if (!pts) return;
      const { p1, p2 } = pts;
      ref.current.style.left = `${p1.x + t * (p2.x - p1.x)}px`;
      ref.current.style.top = `${p1.y + t * (p2.y - p1.y)}px`;
    };

    setHandle(handleRefs[0], intersectionH, 0.25);
    setHandle(handleRefs[1], intersectionH, 0.75);
    setHandle(handleRefs[2], intersectionV, 0.25);
    setHandle(handleRefs[3], intersectionV, 0.75);
  });

  // ── Rotation handle drag ────────────────────────────────────────────
  // All handles rotate around the current plane's normal (which is the
  // crosshair center axis). The rotation is applied to the OTHER two planes,
  // not this one. H and V lines naturally stay perpendicular because both
  // other planes rotate by the same delta.
  const handleRotateStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Compute initial angle of mouse relative to crosshair center (screen coords)
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx);

    const onMove = (ev: MouseEvent) => {
      const r = container.getBoundingClientRect();
      const centerX = r.left + r.width / 2;
      const centerY = r.top + r.height / 2;
      const currentAngle = Math.atan2(ev.clientY - centerY, ev.clientX - centerX);
      let delta = currentAngle - lastAngle.current;
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      lastAngle.current = currentAngle;

      const normal = plane.getBasis().normal;
      const deltaQ = quaternionFromAxisAngle(normal, delta);
      onRotateOtherPlanes?.([deltaQ[0], deltaQ[1], deltaQ[2], deltaQ[3]]);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    lastAngle.current = startAngle;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [plane, onRotateOtherPlanes]);

  // ── Scroll wheel: move focal point along normal ───────────────────────
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (!viewRef.current) return;

    const ijk = plane.getFocalPointIjk();
    const step = e.deltaY > 0 ? 1 : -1;
    const newIjk = { ...ijk };
    switch (orientation) {
      case 'axial':    newIjk.k += step; break;
      case 'coronal':  newIjk.j += step; break;
      case 'sagittal': newIjk.i += step; break;
    }
    const dims = volume.dimensions as [number, number, number];
    newIjk.i = Math.max(0, Math.min(dims[0] - 1, newIjk.i));
    newIjk.j = Math.max(0, Math.min(dims[1] - 1, newIjk.j));
    newIjk.k = Math.max(0, Math.min(dims[2] - 1, newIjk.k));
    plane.setFocalPointIjk(newIjk);
    viewRef.current.setObliquePlane(plane.getComputed(), extractor);
    // Notify parent to sync focal point across all planes
    onFocalPointChange?.(newIjk);
  }, [orientation, volume.dimensions, plane, extractor, onFocalPointChange]);

  const colors = CROSSHAIR_COLORS[orientation];

  return (
    <div
      ref={containerRef}
      className="slice-viewer"
      style={{ border: `1px solid ${ORIENTATION_COLORS[orientation]}` }}
    >
      <div ref={canvasWrapperRef} className="canvas-wrapper" />
      <OrientationLabels orientation={orientation} />
      <div className="crosshair-overlay">
        <div ref={hLineRef} className="crosshair-line" />
        <div ref={vLineRef} className="crosshair-line" />
        <div ref={dotRef} className="crosshair-dot" style={{ background: ORIENTATION_COLORS[orientation] }} />
        {/* H handles */}
        <div ref={handleRefs[0]} className="rotation-handle" style={{ background: colors.h }}
          onMouseDown={handleRotateStart} />
        <div ref={handleRefs[1]} className="rotation-handle" style={{ background: colors.h }}
          onMouseDown={handleRotateStart} />
        {/* V handles */}
        <div ref={handleRefs[2]} className="rotation-handle" style={{ background: colors.v }}
          onMouseDown={handleRotateStart} />
        <div ref={handleRefs[3]} className="rotation-handle" style={{ background: colors.v }}
          onMouseDown={handleRotateStart} />
      </div>
      {/* Mouse capture layer for scroll wheel only */}
      <div
        style={{ position: 'absolute', inset: 0, cursor: 'crosshair', zIndex: 5 }}
        onWheel={handleWheel}
      />
    </div>
  );
});

// ─── Oblique MPR Viewer ────────────────────────────────────────────────────

interface ObliqueMPRViewerProps {
  volume: MedVolume;
  windowLevel: WindowLevelState;
}

function ObliqueMPRViewer({ volume, windowLevel }: ObliqueMPRViewerProps) {
  // Extractor state (shared across all three views)
  const [extractor, setExtractor] = useState<ObliqueExtractorType | null>(null);
  // Force re-render trigger when planes rotate
  const [renderTick, setRenderTick] = useState(0);
  // Keep a ref for cleanup
  const sharedViewRef = useRef<WebGLSliceView | null>(null);

  // Three plane instances (one per view) - created once and persisted
  const planesRef = useRef<{
    axial: ObliquePlane | null;
    coronal: ObliquePlane | null;
    sagittal: ObliquePlane | null;
  }>({ axial: null, coronal: null, sagittal: null });

  // Initialize planes once when volume changes
  useEffect(() => {
    const dims = volume.dimensions as [number, number, number];
    const centerIjk: CrosshairPosition = {
      i: Math.floor(dims[0] / 2),
      j: Math.floor(dims[1] / 2),
      k: Math.floor(dims[2] / 2),
    };

    // Create three planes with shared focal point at volume center
    const axialPlane = createObliquePlane({ volume, baseOrientation: 'axial' });
    const coronalPlane = createObliquePlane({ volume, baseOrientation: 'coronal' });
    const sagittalPlane = createObliquePlane({ volume, baseOrientation: 'sagittal' });

    // Set shared focal point
    axialPlane.setFocalPointIjk(centerIjk);
    coronalPlane.setFocalPointIjk(centerIjk);
    sagittalPlane.setFocalPointIjk(centerIjk);

    planesRef.current = { axial: axialPlane, coronal: coronalPlane, sagittal: sagittalPlane };

    // Trigger re-render so useMemo recomputes intersections with the new planes
    setRenderTick(t => t + 1);

    return () => {
      planesRef.current = { axial: null, coronal: null, sagittal: null };
    };
  }, [volume]);

  // Create extractor (same as before)
  useEffect(() => {
    const container = document.createElement('div');
    container.style.display = 'none';
    document.body.appendChild(container);

    const view = createWebGLSliceView(asNiftiVolume(volume), {
      container,
      orientation: 'axial',
      initialWindowLevel: { window: 255, level: 128 },
    });
    sharedViewRef.current = view;

    const normalizedData = view.getNormalizedData();
    const ext = createObliqueExtractor({ volume: asNiftiVolume(volume), normalizedData });
    setExtractor(ext);

    return () => {
      view.dispose();
      container.remove();
      sharedViewRef.current = null;
      setExtractor(null);
    };
  }, [volume]);

  // Compute intersection lines between planes
  const intersections = useMemo(() => {
    const { axial, coronal, sagittal } = planesRef.current;
    if (!axial || !coronal || !sagittal) {
      return {
        axial: { h: null as Line3D | null, v: null as Line3D | null },
        coronal: { h: null as Line3D | null, v: null as Line3D | null },
        sagittal: { h: null as Line3D | null, v: null as Line3D | null },
      };
    }

    return {
      // Axial view: H-line = intersection with Coronal, V-line = intersection with Sagittal
      axial: {
        h: axial.getIntersectionWith(coronal.getComputed()),
        v: axial.getIntersectionWith(sagittal.getComputed()),
      },
      // Coronal view: H-line = intersection with Axial, V-line = intersection with Sagittal
      coronal: {
        h: coronal.getIntersectionWith(axial.getComputed()),
        v: coronal.getIntersectionWith(sagittal.getComputed()),
      },
      // Sagittal view: H-line = intersection with Axial, V-line = intersection with Coronal
      sagittal: {
        h: sagittal.getIntersectionWith(axial.getComputed()),
        v: sagittal.getIntersectionWith(coronal.getComputed()),
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume, renderTick]); // recompute when planes rotate

  // Handle rotation from child views — apply deltaQ to the OTHER two planes
  // When dragging handles on view X, rotate planes Y and Z (not X).
  const handleRotateOtherPlanes = useCallback(
    (sourceOrientation: SliceOrientation, deltaQ: [number, number, number, number]) => {
      const { axial, coronal, sagittal } = planesRef.current;
      // Rotate the two planes that are NOT the source
      if (sourceOrientation !== 'axial' && axial) {
        axial.applyRotationDelta(deltaQ);
      }
      if (sourceOrientation !== 'coronal' && coronal) {
        coronal.applyRotationDelta(deltaQ);
      }
      if (sourceOrientation !== 'sagittal' && sagittal) {
        sagittal.applyRotationDelta(deltaQ);
      }
      // Clear extractor cache to avoid stale slice data after rotation
      extractor?.clearCache();
      setRenderTick(t => t + 1);
    }, [extractor]);

  // Handle focal point change from scroll wheel - sync all planes
  const handleFocalPointChange = useCallback((ijk: CrosshairPosition) => {
    const { axial, coronal, sagittal } = planesRef.current;
    axial?.setFocalPointIjk(ijk);
    coronal?.setFocalPointIjk(ijk);
    sagittal?.setFocalPointIjk(ijk);
    extractor?.clearCache();
    setRenderTick(t => t + 1);
  }, [extractor]);

  const { axial, coronal, sagittal } = planesRef.current;
  const ready = extractor && axial && coronal && sagittal;

  return (
    <div className="viewer-mpr">
      <div className="mpr-left">
        {ready ? (
          <ObliqueSliceViewer
            volume={volume}
            orientation="axial"
            windowLevel={windowLevel}
            extractor={extractor}
            plane={axial}
            intersectionH={intersections.axial.h}
            intersectionV={intersections.axial.v}
            onRotateOtherPlanes={(deltaQ) => handleRotateOtherPlanes('axial', deltaQ)}
            onFocalPointChange={handleFocalPointChange}
          />
        ) : <LoadingSpinner />}
        <div className="mpr-label">Axial (Oblique)</div>
      </div>
      <div className="mpr-right">
        <div className="mpr-right-top">
          {ready ? (
            <ObliqueSliceViewer
              volume={volume}
              orientation="coronal"
              windowLevel={windowLevel}
              extractor={extractor}
              plane={coronal}
              intersectionH={intersections.coronal.h}
              intersectionV={intersections.coronal.v}
              onRotateOtherPlanes={(deltaQ) => handleRotateOtherPlanes('coronal', deltaQ)}
              onFocalPointChange={handleFocalPointChange}
            />
          ) : <LoadingSpinner />}
          <div className="mpr-label">Coronal (Oblique)</div>
        </div>
        <div className="mpr-right-bottom">
          {ready ? (
            <ObliqueSliceViewer
              volume={volume}
              orientation="sagittal"
              windowLevel={windowLevel}
              extractor={extractor}
              plane={sagittal}
              intersectionH={intersections.sagittal.h}
              intersectionV={intersections.sagittal.v}
              onRotateOtherPlanes={(deltaQ) => handleRotateOtherPlanes('sagittal', deltaQ)}
              onFocalPointChange={handleFocalPointChange}
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
  volume: MedVolume;
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
  volume: MedVolume;
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

// ─── Volume Viewer (3D Raycasting) ─────────────────────────────────────────

const COLORMAP_OPTIONS: Array<{ value: ColormapName; label: string }> = [
  { value: 'grayscale', label: 'Grayscale' },
  { value: 'hot', label: 'Hot' },
  { value: 'bone', label: 'Bone' },
  { value: 'airways', label: 'Airways' },
  { value: 'angiography', label: 'Angio' },
  { value: 'pet', label: 'PET' },
  { value: 'soft_tissue', label: 'Soft Tissue' },
  { value: 'lung', label: 'Lung' },
  { value: 'iron', label: 'Iron' },
  { value: 'viridis', label: 'Viridis' },
];

const COMPOSITING_OPTIONS: Array<{ value: CompositingMode; label: string }> = [
  { value: 'standard', label: 'Standard' },
  { value: 'mip', label: 'MIP' },
  { value: 'minip', label: 'MinIP' },
  { value: 'average', label: 'Average' },
];

// Normalize 2D W/L (0-255) to 3D W/L (0-1)
function normalizeWL(w: number, l: number): { window: number; level: number } {
  return { window: w / 255, level: l / 255 };
}

interface VolumeViewerProps {
  volume: MedVolume;
  windowLevel: WindowLevelState;
  compositingMode: CompositingMode;
  colormap: ColormapName;
  gradientLighting: boolean;
  resetTrigger?: number;
  onWindowLevelChange?: (wl: WindowLevelState) => void;
}

function VolumeViewer({ volume, windowLevel, compositingMode, colormap, gradientLighting, resetTrigger, onWindowLevelChange }: VolumeViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<VolumeRenderView | null>(null);

  // Create/destroy VolumeRenderView
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const view = createVolumeRenderView(container, {
      orientationCube: { size: 80, position: 'bottom-right' },
    });
    viewRef.current = view;
    view.setVolume(asNiftiVolume(volume));

    return () => {
      view.dispose();
      viewRef.current = null;
    };
  }, [volume]);

  // Reset camera when trigger changes
  useEffect(() => {
    if (resetTrigger && viewRef.current) {
      viewRef.current.setCamera({
        rotation: DEFAULT_CAMERA_STATE.rotation,
        distance: 2.5,
        target: [0.5, 0.5, 0.5],
      });
    }
  }, [resetTrigger]);

  // Sync compositing mode
  useEffect(() => {
    viewRef.current?.setCompositingMode(compositingMode);
  }, [compositingMode]);

  // Sync colormap
  useEffect(() => {
    viewRef.current?.setColormap(colormap);
  }, [colormap]);

  // Sync gradient lighting
  useEffect(() => {
    viewRef.current?.setGradientLighting(gradientLighting);
  }, [gradientLighting]);

  // Sync window/level from 2D to 3D
  useEffect(() => {
    const nl = normalizeWL(windowLevel.window, windowLevel.level);
    viewRef.current?.setWindowLevel(nl.window, nl.level);
  }, [windowLevel]);

  // Sync window/level from 3D back to 2D (middle-button drag)
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !onWindowLevelChange) return;

    const handler = (data: unknown) => {
      const { window: w, level: l } = data as { window: number; level: number };
      const ww = Math.round(w * 255);
      const wl = Math.round(l * 255);
      if (windowLevel.window !== ww || windowLevel.level !== wl) {
        onWindowLevelChange({ window: ww, level: wl });
      }
    };
    view.on('windowLevelChange', handler);
    return () => { view.off('windowLevelChange', handler); };
  }, [onWindowLevelChange, windowLevel.window, windowLevel.level]);

  return (
    <div className="viewer-volume3d">
      <div ref={containerRef} className="viewer-volume3d__canvas" />
    </div>
  );
}

// ─── 3D Volume Render Controls ─────────────────────────────────────────────

interface Volume3DControlsProps {
  compositingMode: CompositingMode;
  colormap: ColormapName;
  gradientLighting: boolean;
  onCompositingModeChange: (mode: CompositingMode) => void;
  onColormapChange: (cm: ColormapName) => void;
  onGradientLightingChange: (enabled: boolean) => void;
  onWindowLevelChange: (wl: WindowLevelState) => void;
  onResetCamera: () => void;
}

function Volume3DControls({
  compositingMode,
  colormap,
  gradientLighting,
  onCompositingModeChange,
  onColormapChange,
  onGradientLightingChange,
  onWindowLevelChange,
  onResetCamera,
}: Volume3DControlsProps) {
  return (
    <div className="sidebar__section">
      <div className="sidebar__section-title">3D Render</div>

      <div className="control-row">
        <label className="control-row__label">Presets</label>
        <div className="preset-grid">
          {TISSUE_PRESETS.map(p => (
            <button
              key={p.label}
              className="preset-btn"
              onClick={() => {
                onWindowLevelChange({ window: p.window, level: p.level });
                onColormapChange(p.colormap);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="control-row">
        <label className="control-row__label">Projection</label>
        <select
          className="select-control"
          value={compositingMode}
          onChange={e => onCompositingModeChange(e.target.value as CompositingMode)}
        >
          {COMPOSITING_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div className="control-row">
        <label className="control-row__label">Colormap</label>
        <select
          className="select-control"
          value={colormap}
          onChange={e => onColormapChange(e.target.value as ColormapName)}
        >
          {COLORMAP_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div className="control-row">
        <label className="control-row__label">
          <input
            type="checkbox"
            checked={gradientLighting}
            onChange={e => onGradientLightingChange(e.target.checked)}
          />
          {' '}Lighting
        </label>
      </div>

      <button className="preset-btn" onClick={onResetCamera}>
        Reset Camera
      </button>
    </div>
  );
}

// ─── Header ─────────────────────────────────────────────────────────────────

function Header({ viewMode, mprEnabled, crosshair, onViewModeChange }: {
  viewMode: 'single' | 'mpr' | 'oblique' | 'volume3d';
  mprEnabled: boolean;
  crosshair: CrosshairPosition | null;
  onViewModeChange: (mode: 'single' | 'mpr' | 'oblique' | 'volume3d') => void;
}) {
  return (
    <header className="header">
      <span className="header__title">jsMed (WebGL)</span>
      <div className="header__controls">
        {crosshair && viewMode !== 'oblique' && viewMode !== 'volume3d' && (
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
        <button
          className={`mpr-btn volume3d-btn${viewMode === 'volume3d' ? ' active' : ''}`}
          onClick={() => onViewModeChange(viewMode === 'volume3d' ? 'single' : 'volume3d')}
        >
          {viewMode === 'volume3d' ? 'Exit 3D' : '3D Volume'}
        </button>
        <span className="header__version">v0.1.0</span>
      </div>
    </header>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function FileSection({ error, onFolderSelect }: { error: string | null; onFolderSelect: (files: File[]) => void }) {
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onFolderSelect(Array.from(files));
    }
  }, [onFolderSelect]);

  return (
    <div className="sidebar__section">
      <div className="sidebar__section-title">File</div>
      <label className="file-btn">
        Open DICOM Folder
        <input type="file" onChange={handleChange} style={{ display: 'none' }}
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} />
      </label>
      {error && <div className="sidebar__error">{error}</div>}
    </div>
  );
}

function VolumeInfo({ volume }: { volume: MedVolume }) {
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
      <div>Use "Open DICOM Folder" to load a series</div>
      <div className="drop-overlay__hint">Select a folder containing .dcm files from the sidebar</div>
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
  const [volume, setVolume] = useState<DicomVolume | null>(null);
  const [viewMode, setViewMode] = useState<'single' | 'mpr' | 'oblique' | 'volume3d'>('single');
  const [isDragOver, setIsDragOver] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [windowLevel, setWindowLevel] = useState<WindowLevelState>({ window: 255, level: 128 });
  const [crosshair, setCrosshair] = useState<CrosshairPosition | null>(null);
  // 3D volume rendering state
  const [compositingMode, setCompositingMode] = useState<CompositingMode>('standard');
  const [colormap, setColormap] = useState<ColormapName>('grayscale');
  const [gradientLighting, setGradientLighting] = useState(true);
  const [resetTrigger, setResetTrigger] = useState(0);

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

  // ── DICOM folder loading ──────────────────────────────────────────────────
  const loadVolume = useCallback(async (files: File[]) => {
    try {
      setIsLoading(true);
      setLoadError(null);
      const vol = await loadDicomFolder(files);
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
    // Accept dropped files — try to parse them as DICOM
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) {
      loadVolume(files);
    }
  }, [loadVolume]);

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
          <FileSection error={loadError} onFolderSelect={loadVolume} />
          {volume && <VolumeInfo volume={volume} />}
          {volume && (
            <ViewControls windowLevel={windowLevel} onWindowLevelChange={setWindowLevel} />
          )}
          {viewMode === 'volume3d' && volume && (
            <Volume3DControls
              compositingMode={compositingMode}
              colormap={colormap}
              gradientLighting={gradientLighting}
              onCompositingModeChange={setCompositingMode}
              onColormapChange={setColormap}
              onGradientLightingChange={setGradientLighting}
              onWindowLevelChange={setWindowLevel}
              onResetCamera={() => setResetTrigger(t => t + 1)}
            />
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
            viewMode === 'volume3d' ? (
              <VolumeViewer
                volume={volume}
                windowLevel={windowLevel}
                compositingMode={compositingMode}
                colormap={colormap}
                gradientLighting={gradientLighting}
                resetTrigger={resetTrigger}
                onWindowLevelChange={setWindowLevel}
              />
            ) : (
              <SingleViewer
                volume={volume}
                crosshair={crosshair}
                windowLevel={windowLevel}
                onCrosshairChange={setCrosshair}
              />
            )
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
