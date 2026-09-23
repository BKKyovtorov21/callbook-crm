// Packages the app for Vercel using the Build Output API (v3):
//   .vercel/output/static            ← the Vite build (dist/)
//   .vercel/output/functions/api.func ← the Express API bundled into one file
// Run after `vite build`. See https://vercel.com/docs/build-output-api/v3
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve('.vercel/output');
const fn = path.join(out, 'functions/api.func');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(fn, { recursive: true });
fs.cpSync(path.resolve('dist'), path.join(out, 'static'), { recursive: true });

await build({
  entryPoints: ['server/vercel.ts'],
  outfile: path.join(fn, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Express and friends are CommonJS; give the ESM bundle a `require`.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});

fs.writeFileSync(
  path.join(fn, '.vc-config.json'),
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 30 }, null, 2),
);

fs.writeFileSync(
  path.join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/api/(.*)$', dest: '/api?__path=$1' },
        { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
        { handle: 'filesystem' },
        { src: '^/.*$', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);
console.log('Vercel output written to .vercel/output');
