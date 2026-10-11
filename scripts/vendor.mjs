import { cp, mkdir } from 'node:fs/promises';

// Keep the checked-in static site usable without a build or external CDN.
const files = [
  ['pdfjs-dist/build/pdf.mjs', 'pdfjs/pdf.mjs'],
  ['pdfjs-dist/build/pdf.worker.mjs', 'pdfjs/pdf.worker.mjs'],
  ['pdfjs-dist/cmaps', 'pdfjs/cmaps'],
  ['pdfjs-dist/standard_fonts', 'pdfjs/standard_fonts'],
  ['pdfjs-dist/wasm', 'pdfjs/wasm'],
  ['pdfjs-dist/LICENSE', 'pdfjs/LICENSE'],
  ['mammoth/mammoth.browser.min.js', 'mammoth/mammoth.browser.min.js'],
  ['mammoth/LICENSE', 'mammoth/LICENSE']
];

for (const target of ['vendor', 'dist/vendor']) {
  await mkdir(target, { recursive: true });
  for (const [source, destination] of files) {
    await cp(`node_modules/${source}`, `${target}/${destination}`, { recursive: true });
  }
}
