import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

/**
 * MV3 build (task 3.1). @crxjs/vite-plugin wires the manifest, the service
 * worker, the popup HTML entry and the content script into a single Chrome
 * extension bundle under dist/. `npm run build` typechecks first, then emits.
 */
export default defineConfig({
  plugins: [crx({ manifest })],
  server: {
    // CRXJS HMR for MV3 needs a stable port + strictPort during dev.
    port: 5174,
    strictPort: true,
    hmr: { port: 5174 },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        popup: 'src/popup/index.html',
      },
    },
  },
  // Force ASCII output so non-ASCII string literals are emitted as \uXXXX escapes
  // rather than raw bytes. rrweb embeds the U+FFFE noncharacter (a CSS BOM check)
  // as a literal; Chrome's content-script loader (IsStringUTF8) rejects Unicode
  // noncharacters and refuses the whole extension ("file is not UTF-8 encoded").
  // charset:'ascii' escapes them, keeping every emitted chunk loadable.
  esbuild: {
    charset: 'ascii',
  },
});
