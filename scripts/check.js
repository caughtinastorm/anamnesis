import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
async function files(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', 'test-results', 'playwright-report'].includes(entry.name)) continue;
    const name = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await files(name)); else if (name.endsWith('.js')) found.push(name);
  }
  return found;
}
let failed = false;
for (const name of await files('.')) {
  const syntax = spawnSync(process.execPath, ['--check', name], { encoding: 'utf8' });
  if (syntax.status) { console.error(syntax.stderr); failed = true; }
  const source = await readFile(name, 'utf8');
  for (const match of source.matchAll(/(?:from\s*|import\s*\()(['"])(\.[^'"]+)\1/g)) {
    try { await readFile(path.resolve(path.dirname(name), match[2])); }
    catch { console.error(`Missing import in ${name}: ${match[2]}`); failed = true; }
  }
}
if (failed) process.exitCode = 1; else console.log('Syntax and local imports verified.');
