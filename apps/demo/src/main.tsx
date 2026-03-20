import { createVolumeViewer, type VolumeViewer } from '@jsmedgl/core';

// Create viewer container
const container = document.createElement('div');
container.id = 'viewer';
container.style.cssText = 'width: 100%; height: 100%;';
document.getElementById('root')!.appendChild(container);

const viewer = createVolumeViewer({
  container,
  crosshair: true,
  colorbar: true,
});

// Global error handler
window.addEventListener('error', (e) => {
  console.error('Global error:', e.error);
});

console.log('jsMedgl initialized');
