// jsMedgl Demo - NIfTI Viewer with WebGL Rendering
import { parseNifti } from '@jsmedgl/parser-nifti';
import { createWebGLSliceView, type WebGLSliceView } from '@jsmedgl/renderer-2d';

let sliceView: WebGLSliceView | null = null;
let loadedVolume: any = null;

async function loadFile(file: File) {
  try {
    const buffer = await file.arrayBuffer();
    const volume = await parseNifti(buffer);
    loadedVolume = volume;
    initViewer(volume);
  } catch (err) {
    console.error('[main] Load error:', err);
    document.getElementById('error-msg')!.textContent = `Error: ${err}`;
  }
}

function initViewer(volume: any) {
  const container = document.getElementById('viewer')!;

  if (sliceView) {
    sliceView.dispose();
  }

  sliceView = createWebGLSliceView(volume, {
    container,
    orientation: 'axial',
  });

  // Update sidebar info
  document.getElementById('info-dims')!.textContent = volume.dimensions.join(' × ');
  document.getElementById('info-spacing')!.textContent = volume.spacing.map((s: number) => s.toFixed(3)).join(' × ');
  const typeNames: Record<number, string> = {
    2: 'UINT8', 4: 'INT16', 8: 'INT32', 16: 'FLOAT32', 64: 'FLOAT64', 128: 'RGB24'
  };
  document.getElementById('info-type')!.textContent = typeNames[volume.header.datatype] || String(volume.header.datatype);
}

function initApp() {
  const root = document.getElementById('root');
  if (!root) return;

  root.innerHTML = `
    <div class="app">
      <div class="header">
        <span class="title">jsMed (WebGL)</span>
        <span class="version">v0.1.0</span>
      </div>
      <div class="body">
        <div class="sidebar">
          <div class="section">
            <div class="section-title">File</div>
            <label class="file-btn">
              Open NIfTI File
              <input type="file" accept=".nii,.nii.gz" id="file-input" style="display:none;">
            </label>
            <div id="error-msg" class="error"></div>
          </div>

          <div class="section" id="volume-info" style="display:none;">
            <div class="section-title">Volume</div>
            <div class="info-row"><span>Dimensions</span><span id="info-dims">-</span></div>
            <div class="info-row"><span>Spacing</span><span id="info-spacing">-</span></div>
            <div class="info-row"><span>Type</span><span id="info-type">-</span></div>
          </div>

          <div class="section" id="view-controls" style="display:none;">
            <div class="section-title">Window / Level</div>
            <div class="control-row">
              <label>W: <span id="w-val">255</span></label>
              <input type="range" id="w-slider" min="1" max="500" value="255">
            </div>
            <div class="control-row">
              <label>L: <span id="l-val">128</span></label>
              <input type="range" id="l-slider" min="0" max="255" value="128">
            </div>
            <div class="presets">
              <button class="preset-btn" data-w="255" data-l="128">Default</button>
              <button class="preset-btn" data-w="80" data-l="40">Brain</button>
              <button class="preset-btn" data-w="2000" data-l="500">Bone</button>
            </div>
          </div>
        </div>

        <div class="viewer-area">
          <div id="viewer" class="viewer"></div>
          <div id="drop-overlay">
            <div>Drop .nii or .nii.gz file here</div>
            <div class="drop-hint">or use the Open button in the sidebar</div>
          </div>
        </div>
      </div>
    </div>
  `;

  // File input
  document.getElementById('file-input')!.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      document.getElementById('volume-info')!.style.display = 'block';
      document.getElementById('view-controls')!.style.display = 'block';
      document.getElementById('drop-overlay')!.style.display = 'none';
      loadFile(file);
    }
  });

  // Drag & drop
  const overlay = document.getElementById('drop-overlay')!;
  document.addEventListener('dragover', (e) => { e.preventDefault(); overlay.classList.add('active'); });
  document.addEventListener('dragleave', () => overlay.classList.remove('active'));
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    overlay.classList.remove('active');
    const file = e.dataTransfer?.files[0];
    if (file && (file.name.endsWith('.nii') || file.name.endsWith('.nii.gz'))) {
      document.getElementById('volume-info')!.style.display = 'block';
      document.getElementById('view-controls')!.style.display = 'block';
      document.getElementById('drop-overlay')!.style.display = 'none';
      loadFile(file);
    }
  });

  // Window/Level sliders
  const wSlider = document.getElementById('w-slider') as HTMLInputElement;
  const lSlider = document.getElementById('l-slider') as HTMLInputElement;

  wSlider.addEventListener('input', () => {
    document.getElementById('w-val')!.textContent = wSlider.value;
    sliceView?.setWindowLevel(+wSlider.value, +lSlider.value);
  });

  lSlider.addEventListener('input', () => {
    document.getElementById('l-val')!.textContent = lSlider.value;
    sliceView?.setWindowLevel(+wSlider.value, +lSlider.value);
  });

  // Presets
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const w = +(btn as HTMLElement).dataset.w!;
      const l = +(btn as HTMLElement).dataset.l!;
      wSlider.value = String(w);
      lSlider.value = String(l);
      document.getElementById('w-val')!.textContent = String(w);
      document.getElementById('l-val')!.textContent = String(l);
      sliceView?.setWindowLevel(w, l);
    });
  });

  // Auto-load demo file
  fetch('/fixtures/img-3d.nii.gz')
    .then(res => {
      if (!res.ok) return;
      return res.arrayBuffer();
    })
    .then(buf => {
      if (!buf) return;
      return parseNifti(buf);
    })
    .then(volume => {
      if (!volume) return;
      document.getElementById('volume-info')!.style.display = 'block';
      document.getElementById('view-controls')!.style.display = 'block';
      document.getElementById('drop-overlay')!.style.display = 'none';
      initViewer(volume);
    })
    .catch(() => {});
}

window.addEventListener('error', (e) => console.error('[window]', e.error));

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
