export const roadmap = [
  {
    version: 'v0.1',
    label: 'Current',
    title: 'Core Foundation',
    items: [
      'NIfTI file parsing & gzip support',
      '2D WebGL2 slice rendering',
      'Multi-planar reconstruction (axial/sagittal/coronal)',
      'Oblique MPR with rotation handles',
      'Window/level control',
      'Proper RAS ↔ LPS ↔ IJK coordinate conversion',
    ],
    status: 'current' as const,
  },
  {
    version: 'v1.0',
    label: 'Next',
    title: 'Clinical Ready',
    items: [
      'DICOM support (load & render)',
      '3D volume rendering',
      'Measurement & annotation tools',
      'React & Vue adapters',
      'Preset library (clinical protocols)',
      'Export screenshots & clips',
    ],
    status: 'next' as const,
  },
  {
    version: 'v2.0',
    label: 'Future',
    title: 'Next-Gen',
    items: [
      'WebGPU rendering backend',
      'VR/AR immersive viewing',
      'Real-time collaborative annotation',
      'Segmentation overlay',
      'AI-assisted feature detection',
      'Plugin/extension system',
    ],
    status: 'future' as const,
  },
];
