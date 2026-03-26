// NIfTI Parser - Main Entry Point

export type {
  NiftiHeader,
  NiftiVolume,
  OrientationReport,
  NiftiParserOptions
} from './types';

export {
  NiftiDataType,
  NiftiXform
} from './types';

export {
  parseNifti,
  parseNiftiHeader,
  createNiftiParser
} from './parser';

export {
  extractAffineMatrix,
  ijkToRas,
  rasToIjk,
  rasToLps,
  lpsToRas,
  validateOrientation
} from './coordinate';

export {
  getDataTypeSize,
  readVoxel
} from './utils';
