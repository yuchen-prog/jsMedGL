export const comparisonData = {
  headers: ['Feature', 'jsMedgl', 'NiiVue', 'MRIcroWeb', 'vtk-js'],
  rows: [
    {
      feature: 'Zero-install',
      values: ['✓', '✓', '✓', '✗'],
    },
    {
      feature: 'Coordinate accuracy (sform/qform)',
      values: ['✓', '~', '✗', '✓'],
    },
    {
      feature: 'MPR (multi-planar reconstruction)',
      values: ['✓', '✓', '~', '✓'],
    },
    {
      feature: 'Oblique MPR',
      values: ['✓', '✗', '✗', '~'],
    },
    {
      feature: 'Framework-agnostic',
      values: ['✓', '~', '✓', '✓'],
    },
    {
      feature: 'Bundle size',
      values: ['~45KB', '~250KB', '~300KB', '~2MB'],
    },
    {
      feature: 'License',
      values: ['Apache-2.0', 'BSD-3', 'GPL-3.0', 'BSD-3'],
    },
  ],
  notes: {
    jsMedgl: 'TypeScript, tree-shakeable, ~45KB gzipped',
    NiiVue: 'Mature, React wrapper, larger bundle',
    MRIcroWeb: 'Full clinical tool, coordinate handling bugs',
    'vtk-js': 'Powerful but heavy, steep learning curve',
  },
};
