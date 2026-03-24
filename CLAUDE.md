# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**jsMedgl** is a browser-based medical imaging rendering library for NIfTI volumes (v0.1 MVP). It provides zero-install, diagnostic-grade medical imaging visualization in the browser.

## Build Commands

```bash
pnpm dev          # Run demo app (Vite + React)
pnpm build        # Build all packages (-r recursive)
pnpm test         # Run vitest unit tests
pnpm test:watch   # Watch mode
pnpm test:coverage # With coverage report
pnpm lint         # ESLint
pnpm typecheck    # TypeScript check all packages
```

## Architecture

### Monorepo Structure

```
packages/
  parser-nifti/    # NIfTI file parser (standalone, no upward deps)
  renderer-2d/     # 2D slice renderer with WebGL2 + MPR support
  core/            # Core engine (placeholder, uses three.js)
  react/           # React adapter (placeholder)
apps/demo/         # Vite + React demo app
tests/             # Unit + integration tests
```

### Package Dependencies (Top-Down)

```
core → renderer-2d → parser-nifti
      → parser-nifti
```

### Key Patterns

1. **Factory pattern** — `createXxx()` functions return internal `XxxImpl` classes. Public surface only exposes the factory and interface.
2. **Event emitter** — `on(event, cb) / off(event, cb)` pattern for slice changes, crosshair updates, etc.
3. **Coordinate system** — Strict LPS (DICOM) vs RAS (NIfTI) vs IJK (voxel indices) conversion throughout. Use the coordinate utilities from `parser-nifti`.
4. **WebGL resource disposal** — All WebGL resources (textures, buffers, programs) have `dispose()` methods. Always dispose on cleanup.

### WebGL Rendering Pipeline (`renderer-2d`)

1. Parse NIfTI → extract header/data/dimensions
2. Normalize voxel data to `Uint8Array` (0-255)
3. Upload as WebGL `R8` texture
4. Extract 2D slice in IJK space
5. Render textured quad with window/level applied in fragment shader

### NIfTI Parser (`parser-nifti`)

Key utilities: `parseNifti()`, `parseNiftiHeader()`, `extractAffineMatrix()`, `ijkToRas()`, `rasToLps()`, `lpsToRas()`, `validateOrientation()`. Handles gzip decompression via `pako`.

### Entry Points

- Library packages: `packages/*/src/index.ts`
- Demo: `apps/demo/src/main.tsx`
- Tests: `tests/unit/*.test.ts`, `tests/integration/*.test.ts`

### Path Aliases

Configured in `tsconfig.json` and `vitest.config.ts`:
- `@jsmedgl/parser-nifti` → `packages/parser-nifti/src`
- `@jsmedgl/renderer-2d` → `packages/renderer-2d/src`
- `@jsmedgl/core` → `packages/core/src`
- `@jsmedgl/react` → `packages/react/src`
