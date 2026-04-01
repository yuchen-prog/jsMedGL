export const features = [
  {
    id: 'mpr',
    title: 'Multi-Planar Reconstruction',
    description:
      'Synchronized axial, sagittal, and coronal views with real-time crosshair navigation. Explore volumetric data from any angle.',
    icon: 'layers',
  },
  {
    id: 'oblique',
    title: 'Oblique MPR',
    description:
      'Rotate slices to arbitrary angles with interactive handles. Perfect for vessel analysis and oblique plane studies.',
    icon: 'rotate-3d',
  },
  {
    id: 'window',
    title: 'Window/Level Control',
    description:
      'Real-time window width and level adjustment with preset profiles for CT, MRI, and common clinical scenarios.',
    icon: 'sun',
  },
  {
    id: 'coord',
    title: 'Coordinate Accuracy',
    description:
      'Proper sform/qform matrix handling ensures correct spatial orientation — fixing the coordinate bugs that plague MRIcroWeb.',
    icon: 'target',
  },
];

export const featureIcons: Record<string, string> = {
  layers: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 12.5-8.58 3.91a2 2 0 0 1-1.66 0L2 12.5"/><path d="m22 17.5-8.58 3.91a2 2 0 0 1-1.66 0L2 17.5"/></svg>`,
  'rotate-3d': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16.466 7.5C15.643 4.237 13.952 2 12 2 9.239 2 7 6.477 7 12s2.239 10 5 10c.342 0 .677-.069 1-.2"/><path d="m15.194 12.794 4.5 4.5"/><path d="M19 16v6"/><path d="M22 19h-6"/></svg>`,
  sun: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`,
  target: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
};
