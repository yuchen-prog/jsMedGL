// jsMedgl Demo - NIfTI Viewer
import { parseNifti } from '@jsmedgl/parser-nifti';
import { createMPRLayout, type MPRLayout } from '@jsmedgl/renderer-2d';

let mprLayout: MPRLayout | null = null;
let loadedVolume: any = null;

async function loadFile(file: File) {
  try {
    const buffer = await file.arrayBuffer();
    const volume = await parseNifti(buffer);
    loadedVolume = volume;
    initMPR(volume);
  } catch (err) {
    console.error('[main] Load error:', err);
    document.getElementById('error-msg')!.textContent = `Error: ${err}`;
  }
}

function initMPR(volume: any) {
  const container = document.getElementById('viewer')!;

  if (mprLayout) {
    mprLayout.dispose();
  }

  mprLayout = createMPRLayout({
    container,
    volume,
    layout: 'single',
    initialWindowLevel: { window: 255, level: 128 },
  });

  // Update sidebar info
  document.getElementById('info-dims')!.textContent = volume.dimensions.join(' × ');
  document.getElementById('info-spacing')!.textContent = volume.spacing.map((s: number) => s.toFixed(3)).join(' × ');
  document.getElementById('info-type')!.textContent = ['UINT8','INT16','INT32','FLOAT32','FLOAT64','','RGB24'][volume.header.datatype - 2] || String(volume.header.datatype);
}

function initApp() {
  const root = document.getElementById('root');
  if (!root) return;

  root.innerHTML = `
    <div class="app">
      <div class="header">
        <span class="title">jsMed</span>
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
    mprLayout?.setWindowLevel(+wSlider.value, +lSlider.value);
  });

  lSlider.addEventListener('input', () => {
    document.getElementById('l-val')!.textContent = lSlider.value;
    mprLayout?.setWindowLevel(+wSlider.value, +lSlider.value);
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
      mprLayout?.setWindowLevel(w, l);
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
      console.log('[main] vox_offset:', volume.header.vox_offset);
      console.log('[main] sizeof_hdr:', volume.header.sizeof_hdr);
      console.log('[main] datatype:', volume.header.datatype);
      console.log('[main] bitpix:', volume.header.bitpix);
      console.log('[main] dim:', volume.header.dim);
      console.log('[main] data byteLength:', volume.data.byteLength);
      console.log('[main] expected UINT8 bytes:', volume.header.dim[1] * volume.header.dim[2] * volume.header.dim[3]);
      console.log('[main] expected FLOAT64 bytes:', volume.header.dim[1] * volume.header.dim[2] * volume.header.dim[3] * 8);

      // Show first 10 float64 values
      const fd = new Float64Array(volume.data);
      console.log('[main] float64[0:10]:', Array.from(fd.slice(0, 10)).map(v => v.toFixed(1)));
      // Show first 10 uint8 values
      const ud = new Uint8Array(volume.data);
      console.log('[main] uint8[0:10]:', Array.from(ud.slice(0, 10)));
      document.getElementById('volume-info')!.style.display = 'block';
      document.getElementById('view-controls')!.style.display = 'block';
      document.getElementById('drop-overlay')!.style.display = 'none';
      initMPR(volume);
    })
    .catch(() => {});
}

window.addEventListener('error', (e) => console.error('[window]', e.error));

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
