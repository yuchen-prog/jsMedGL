# jsMedgl

Browser-based medical imaging rendering library for NIfTI volumes. Zero-install, diagnostic-grade visualization built on WebGL2.

## Status

**v0.1 MVP** - In Development

## Features

- NIfTI-1/NIfTI-2 file parsing with gzip decompression and sform/qform coordinate handling
- 2D multi-planar reconstruction (MPR) with axial / coronal / sagittal views
- Oblique MPR with quaternion-based plane rotation
- 3D volume rendering via GPU raycasting
- MIP / MinIP / Average compositing modes
- Transfer function control (window/level, colormap, gradient lighting)
- Interactive orbit camera with 360-degree rotation
- Orientation cube with axis labels (L/R/A/P/S/I)
- Framework-agnostic core — works with React, Vue, Angular, or vanilla JS

## Quick Start

```bash
pnpm install
pnpm dev          # Run demo app (Vite + React)
pnpm test         # Run unit & integration tests
pnpm build        # Build all packages
pnpm typecheck    # TypeScript check
```

Open the demo, drop a `.nii` or `.nii.gz` file, and start viewing.

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| `@jsmedgl/parser-nifti` | 0.1.0 | NIfTI file parser and coordinate utilities |
| `@jsmedgl/renderer-2d` | 0.1.0 | 2D slice renderer with WebGL2 + MPR |
| `@jsmedgl/renderer-3d` | 0.1.0 | 3D volume renderer (raycasting, MIP, lighting) |
| `@jsmedgl/core` | 0.1.0 | Core engine (placeholder) |
| `@jsmedgl/react` | 0.1.0 | React adapter (placeholder) |

### Dependency Graph

```
core → renderer-2d → parser-nifti
      → renderer-3d → parser-nifti
```

## Usage

### Parse a NIfTI file

```typescript
import { parseNifti } from '@jsmedgl/parser-nifti';

const response = await fetch('/brain.nii.gz');
const buffer = await response.arrayBuffer();
const volume = await parseNifti(buffer);

console.log(volume.dimensions); // [256, 256, 128]
console.log(volume.spacing);    // [1.0, 1.0, 1.5]
console.log(volume.header.datatype); // NiftiDataType
```

### 2D Slice View (MPR)

```typescript
import { createWebGLSliceView } from '@jsmedgl/renderer-2d';

const view = createWebGLSliceView(volume, {
  container: document.getElementById('viewer'),
  orientation: 'axial',
  initialWindowLevel: { window: 80, level: 40 },
  initialSliceIndex: 64,
});

// Change slice
view.setSliceIndex(80);

// Adjust window/level
view.setWindowLevel(200, 100);

// Pixel → IJK coordinate conversion (for crosshair interaction)
const ijk = view.mouseToIJK(localX, localY);

// Cleanup
view.dispose();
```

### 3D Volume Rendering

```typescript
import {
  createVolumeRenderView,
  DEFAULT_CAMERA_STATE,
} from '@jsmedgl/renderer-3d';

const view = createVolumeRenderView(container, {
  orientationCube: { size: 80, position: 'bottom-right' },
});

view.setVolume(volume);
view.setCompositingMode('mip');
view.setColormap('hot');
view.setWindowLevel(0.5, 0.3);
view.setGradientLighting(true);

// Reset camera to default oblique view
view.setCamera({
  rotation: DEFAULT_CAMERA_STATE.rotation,
  distance: 2.5,
  target: [0.5, 0.5, 0.5],
});

// Listen for camera changes
view.on('cameraChange', (data) => {
  console.log((data as { state: unknown }).state);
});

view.dispose();
```

### Coordinate Utilities

```typescript
import {
  extractAffineMatrix,
  ijkToRas,
  rasToLps,
} from '@jsmedgl/parser-nifti';

const affine = extractAffineMatrix(volume.header);
const ras = ijkToRas([128, 128, 64], affine);
const lps = rasToLps(ras);
```

## Project Structure

```
packages/
  parser-nifti/    # NIfTI parser (standalone, no upward deps)
  renderer-2d/     # 2D slice renderer with WebGL2 + oblique MPR
  renderer-3d/     # 3D volume renderer (raycasting, transfer functions)
  core/            # Core engine (placeholder)
  react/           # React adapter (placeholder)
apps/
  demo/            # Vite + React demo app
  website/         # Astro promotional website
tests/
  unit/            # Unit tests (vitest)
  integration/     # Integration tests with real NIfTI files
```

## Architecture

- **Factory pattern** — `createXxx()` functions return internal `XxxImpl` classes. Public surface only exposes the factory and interface.
- **Event emitter** — `on(event, cb) / off(event, cb)` for slice changes, crosshair updates, camera changes.
- **Coordinate system** — Strict LPS (DICOM) / RAS (NIfTI) / IJK (voxel) conversion throughout.
- **WebGL resource disposal** — All WebGL resources (textures, buffers, programs) have `dispose()` methods. Always call on cleanup.
- **Quaternion camera** — 3D orbit camera uses quaternion rotation for unlimited 360-degree rotation without gimbal lock.

## Roadmap

### v0.2 — Volume Rendering (current)
- [x] 3D raycasting renderer with WebGL2
- [x] MIP / MinIP / Average compositing modes
- [x] Transfer function (colormap, window/level, gradient lighting)
- [x] Interactive orbit camera with quaternion rotation
- [x] Orientation cube with L/R/A/P/S/I labels
- [x] Demo integration (compositing mode, colormap, lighting controls)

### v0.3 — Measurement & Annotation
- [ ] Distance / angle measurement tools
- [ ] Region of interest (ROI) drawing
- [ ] Text annotations on slices
- [ ] DICOM overlay rendering (patient info, study metadata)

### v0.4 — Multi-Volume & DICOM
- [ ] DICOM file support (DICOMweb, local directory)
- [ ] Multiple volume overlay / fusion
- [ ] Volume registration helpers
- [ ] Segmentation mask rendering

### v1.0 — Production Release
- [ ] React adapter (`@jsmedgl/react`)
- [ ] Vue adapter
- [ ] WebGPU rendering backend
- [ ] Comprehensive documentation site
- [ ] Accessibility and keyboard navigation
- [ ] Performance benchmarking and optimization

## Documentation

- [PRD](./.spec/PRD.md)
- [Technical Design](./.spec/v0.1-mvp-tech-design.md)
- [Coordinate System](./.spec/research.md)
- [CI/CD Guide](./docs/cicd-guide.md)

## License

Apache-2.0
