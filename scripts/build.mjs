/**
 * Build: bundles the content script + service worker with esbuild and
 * assembles an unpacked extension in dist/ (load that folder in Chrome).
 *
 *   npm run build        production (minified)
 *   npm run build:dev    readable, with source maps
 *   npm run watch        dev build, rebuilds on change
 */
import { build, context } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const dev = process.argv.includes('--dev');
const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  target: 'chrome105',
  legalComments: 'none',
  // Raw UTF-8 instead of \uXXXX escapes: the ru/ar/zh-CN dictionaries are otherwise ~3x larger.
  charset: 'utf8',
  minify: !dev,
  sourcemap: dev ? 'linked' : false,
  logLevel: 'info',
};

const entries = [
  { entryPoints: [path.join(root, 'src/content/main.js')], outfile: path.join(dist, 'content.js'), format: 'iife', ...common },
  { entryPoints: [path.join(root, 'src/content/styles/theme.css')], outfile: path.join(dist, 'content.css'), ...common },
  { entryPoints: [path.join(root, 'src/background/index.js')], outfile: path.join(dist, 'background.js'), format: 'iife', ...common },
];

async function assembleStatic() {
  await cp(path.join(root, 'static'), dist, { recursive: true, filter: (src) => !src.endsWith('manifest.json') });
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(root, 'static/manifest.json'), 'utf8'));
  manifest.version = pkg.version;
  await writeFile(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await assembleStatic();

if (watch) {
  const ctxs = await Promise.all(entries.map((e) => context(e)));
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log('watching… (static files are copied once; re-run the build to refresh them)');
} else {
  await Promise.all(entries.map((e) => build(e)));
  for (const f of ['content.js', 'content.css', 'background.js']) {
    const { size } = await stat(path.join(dist, f));
    console.log(`  ${f.padEnd(14)} ${(size / 1024).toFixed(1)} KB`);
  }
}
