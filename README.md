# jsMedgl

Web-based medical imaging rendering library for NIfTI volumes.

## Status

**v0.1 MVP** - In Development

## Features

- NIfTI file parsing with proper sform/qform coordinate handling
- 2D multi-planar reconstruction (MPR)
- 3D volume rendering with raycasting
- Window/Level adjustment
- Crosshair navigation
- Framework-agnostic (works with React, Vue, Angular, or vanilla JS)

## Quick Start

```bash
# Install dependencies
pnpm install

# Run demo
pnpm dev

# Run tests
pnpm test

# Build packages
pnpm build
```

## Project Structure

```
jsmedgl/
├── packages/
│   ├── core/           # Core rendering engine
│   ├── parser-nifti/  # NIfTI file parser
│   └── react/         # React adapter
├── apps/
│   └── demo/          # Demo application
├── tests/
│   ├── unit/          # Unit tests
│   └── integration/   # Integration tests
└── .github/
    └── workflows/    # CI/CD pipeline
```

## Documentation

- [PRD](./.spec/PRD.md)
- [Technical Design](./.spec/v0.1-mvp-tech-design.md)
- [Coordinate System](./.spec/research.md)

## License

Apache-2.0
