import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { createStaticServer } from '../server.js';
const dist = new URL('../dist/', import.meta.url);
const server = createStaticServer({ rootDir: dist.pathname });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}/`;
let online = true;
const cacheStores = new Map();
const normalize = request => new URL(typeof request === 'string' || request instanceof URL ? request : request.url, origin).href;
const caches = {
  keys: async () => [...cacheStores.keys()],
  delete: async name => cacheStores.delete(name),
  open: async name => {
    if (!cacheStores.has(name)) cacheStores.set(name, new Map());
    const store = cacheStores.get(name);
    return {
      addAll: async names => {
        const loaded = [];
        for (const name of names) {
          const response = await fetch(normalize(name));
          if (!response.ok) throw new Error(`Precache failed: ${name}`);
          loaded.push([normalize(name), response]);
        }
        loaded.forEach(([url, response]) => store.set(url, response));
      },
      match: async request => store.get(normalize(request))?.clone()
    };
  }
};
const events = new Map();
const self = { registration: { scope: origin }, location: { origin: origin.slice(0,-1) },
  clients: { claim: async () => {} }, addEventListener: (name, callback) => events.set(name, callback) };
const context = vm.createContext({ self, URL, Response, caches, fetch: async request => {
  if (!online) throw new Error('Offline'); return fetch(request);
}, importScripts: file => vm.runInContext(readFileSync(new URL(file, dist), 'utf8'), context) });
vm.runInContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), context);
async function lifecycle(name) { let pending; events.get(name)({ waitUntil: promise => { pending = promise; } }); await pending; }
async function request(url, mode = 'cors') {
  let pending;
  events.get('fetch')({ request: { method: 'GET', url: new URL(url, origin).href, mode }, respondWith: promise => { pending = promise; } });
  return pending;
}
try {
  await test('every generated offline asset exists and installs successfully', async () => {
    for (const asset of self.APP_ASSETS) if (asset !== './') assert.ok(existsSync(new URL(asset, dist)), asset);
    await lifecycle('install');
    assert.ok(cacheStores.size > 0);
    const html = await (await fetch(origin)).text();
    assert.match(html, /assets\/[a-f0-9]{16}\/app\.js/);
  });
  await test('installed app shell and immutable modules remain available without network', async () => {
    online = false;
    const shell = await request('./some-view', 'navigate');
    assert.equal(shell.status, 200);
    assert.ok((await shell.text()).includes('btn-start-review'));
    const asset = self.APP_ASSETS.find(name => name.endsWith('/js/services/reviews.js'));
    const module = await request(asset);
    assert.ok((await module.text()).includes('commitReview'));
    assert.equal(await request('https://api.github.com/gists/test'), undefined);
  });
  await test('activation cleans only this app caches and never forces a mid-session upgrade', async () => {
    cacheStores.set('another-app-cache', new Map()); cacheStores.set('anamnesis-old', new Map());
    await lifecycle('activate');
    assert.ok(cacheStores.has('another-app-cache'));
    assert.ok(!cacheStores.has('anamnesis-old'));
    assert.ok(!readFileSync(new URL('../sw.js', import.meta.url), 'utf8').includes('skipWaiting'));
  });
} finally { await new Promise(resolve => server.close(resolve)); }
