// Copies the onnxruntime-web wasm runtime into the extension so the model runtime
// is served from the extension itself and never from a CDN.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const to = join(root, 'src', 'public', 'ort');
mkdirSync(to, { recursive: true });
const files = readdirSync(from).filter((f) => /^ort-wasm-simd-threaded.*\.(wasm|mjs)$/.test(f));
for (const f of files) copyFileSync(join(from, f), join(to, f));
console.log(`copied ${files.length} onnxruntime files to src/public/ort`);
