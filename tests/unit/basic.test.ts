// Basic unit tests for jsMedgl

import { describe, it, expect, beforeAll } from 'vitest';

describe('jsMedgl Core', () => {
  it('should export createVolumeViewer', async () => {
    const { createVolumeViewer } = await import('@jsmedgl/core');
    expect(createVolumeViewer).toBeDefined();
    expect(typeof createVolumeViewer).toBe('function');
  });

  it('should create a viewer instance', async () => {
    const { createVolumeViewer } = await import('@jsmedgl/core');

    // Create a mock container
    const container = document.createElement('div');
    container.id = 'test-viewer';

    const viewer = createVolumeViewer({
      container,
      crosshair: true,
      colorbar: true,
    });

    expect(viewer).toBeDefined();
    expect(viewer.loadNifti).toBeDefined();
    expect(viewer.setSlice).toBeDefined();
    expect(viewer.setWindowLevel).toBeDefined();
    expect(viewer.screenshot).toBeDefined();
    expect(viewer.dispose).toBeDefined();
  });

  it('should have correct default exports', async () => {
    const module = await import('@jsmedgl/core');
    expect(module.createVolumeViewer).toBeDefined();
  });
});

describe('NIfTI Parser', () => {
  it('should export parser functions', async () => {
    const { parseNifti, parseNiftiHeader } = await import('@jsmedgl/parser-nifti');
    expect(parseNifti).toBeDefined();
    expect(parseNiftiHeader).toBeDefined();
  });
});
