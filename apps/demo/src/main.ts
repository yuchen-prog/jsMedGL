import { createVolumeViewer, type VolumeViewer } from '@jsmedgl/core';

// Initialize app
function initApp() {
  const root = document.getElementById('root');
  if (!root) {
    console.error('Root element not found');
    return;
  }

  // Create viewer container
  const container = document.createElement('div');
  container.id = 'viewer';
  container.style.cssText = 'width: 100%; height: 100%;';

  root.appendChild(container);

  const viewer = createVolumeViewer({
    container,
    crosshair: true,
    colorbar: true,
  });

  console.log('jsMedgl initialized');
}

// Global error handler
window.addEventListener('error', (e) => {
  console.error('Global error:', e.error);
});

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
