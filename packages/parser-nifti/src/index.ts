// NIfTI Parser - Main Entry Point

export interface NiftiParserOptions {
  strictMode?: boolean;
}

export function createNiftiParser(_options?: NiftiParserOptions) {
  return {
    parse: (buffer: ArrayBuffer) => {
      console.log('Parsing NIfTI buffer, size:', buffer.byteLength);
      return null;
    },
    parseHeader: (_buffer: ArrayBuffer) => {
      console.log('Parsing NIfTI header');
      return null;
    },
  };
}

export function parseNifti(buffer: ArrayBuffer) {
  console.log('parseNifti called, size:', buffer.byteLength);
  return null;
}

export function parseNiftiHeader(_buffer: ArrayBuffer) {
  console.log('parseNiftiHeader called');
  return null;
}
