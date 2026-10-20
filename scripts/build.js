import { readdir, readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { META_CSP, SECURITY_HEADERS } from '../security-policy.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
// Static hosts that support _headers receive the same controls as server.js.
await writeFile(path.join(root, '_headers'), '/*\n' + Object.entries(SECURITY_HEADERS).map(([name, value]) => `  ${name}: ${value}`).join('\n') + '\n  Strict-Transport-Security: max-age=31536000\n\n/sw.js\n  Cache-Control: no-cache, no-store, must-revalidate\n');
const sourceHTML = (await readFile(path.join(root, 'index.html'), 'utf8'))
  .replace(/(<meta http-equiv="Content-Security-Policy" content=")[^"]+/, '$1' + META_CSP);
await writeFile(path.join(root, 'index.html'), sourceHTML);
async function walk(dir) {
  const entries = await readdir(path.join(root, dir), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const name = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(name)); else files.push(name);
  }
  return files;
}
const modules = ['app.js', 'db.js', 'fsrs.js', 'sync.js', 'anki.js', 'style.css',
  ...await walk('js'), ...await walk('css'), ...await walk('vendor')].sort();
const stable = ['favicon.svg', 'favicon.ico', 'manifest.json', '_headers', ...await walk('icons')];
const hash = createHash('sha256');
for (const name of [...modules, ...stable, 'index.html', 'sw.js', 'scripts/build.js'].sort()) hash.update(name).update(await readFile(path.join(root, name)));
const release = hash.digest('hex').slice(0, 16);
await rm(dist, { recursive: true, force: true });
const assetRoot = `assets/${release}`;
const productionModules = modules.filter(name => !name.startsWith('css/'));
for (const name of productionModules) {
  const dest = path.join(dist, assetRoot, name);
  await mkdir(path.dirname(dest), { recursive: true });
  if (name === 'style.css') {
    // Preserve cascade order in one stylesheet, avoiding the CSS import waterfall.
    const source = await readFile(path.join(root, name), 'utf8');
    const matches = [...source.matchAll(/@import url\("\.\/(css\/[^\"]+)"\);/g)];
    const styles = await Promise.all(matches.map(match => readFile(path.join(root, match[1]), 'utf8')));
    await writeFile(dest, styles.join('\n'));
  } else await cp(path.join(root, name), dest);
}
for (const name of stable) {
  const dest = path.join(dist, name);
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(path.join(root, name), dest);
}
const html = (await readFile(path.join(root, 'index.html'), 'utf8'))
  .replace('href="style.css"', `href="${assetRoot}/style.css"`)
  .replace('src="app.js"', `src="${assetRoot}/app.js"`);
await writeFile(path.join(dist, 'index.html'), html);
await cp(path.join(root, 'sw.js'), path.join(dist, 'sw.js'));
const precache = ['./', './index.html', ...stable.filter(name => name !== '_headers').map(name => './' + name), ...productionModules.filter(name => !name.endsWith('.txt')).map(name => `./${assetRoot}/${name}`)];
await writeFile(path.join(dist, 'precache-manifest.js'), `self.APP_RELEASE = ${JSON.stringify(release)};\nself.APP_ASSETS = ${JSON.stringify(precache, null, 2)};\n`);
// Keep the direct development server usable without a build.
const devAssets = ['./', './index.html', ...stable.filter(name => name !== '_headers').map(name => './' + name), ...modules.filter(name => !name.endsWith('.txt')).map(name => './' + name)];
await writeFile(path.join(root, 'precache-manifest.js'), `self.APP_RELEASE = ${JSON.stringify('dev-' + release)};\nself.APP_ASSETS = ${JSON.stringify(devAssets, null, 2)};\n`);
console.log(`Built ${release}: ${precache.length} offline assets in dist/`);
