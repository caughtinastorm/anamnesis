import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createStaticServer } from '../server.js';
const server = createStaticServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  await test('static server serves the app with security headers, HEAD and conditional requests', async () => {
    const response = await fetch(origin);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(response.headers.get('content-security-policy').includes("object-src 'none'"));
    assert.ok((await response.text()).includes('anamnesis'));
    const head = await fetch(origin, { method: 'HEAD' });
    assert.equal(await head.text(), '');
    const unchanged = await fetch(origin, { headers: { 'If-None-Match': response.headers.get('etag') } });
    assert.equal(unchanged.status, 304);
    assert.equal((await fetch(origin + '/vendor/sql-wasm-browser.wasm')).headers.get('content-type'), 'application/wasm');
  });
  await test('private files and unsupported methods are denied', async () => {
    for (const name of ['/.git/config', '/package.json', '/test/run-tests.js', '/node_modules/sql.js/package.json', '/%2e%2e/.env']) {
      assert.equal((await fetch(origin + name)).status, 404, name);
    }
    assert.equal((await fetch(origin, { method: 'POST' })).status, 405);
  });
  await test('malformed percent-encoded URLs return 400 without crashing the server', async () => {
    const status = await new Promise((resolve, reject) => {
      request(origin + '/%ZZ', response => { response.resume(); resolve(response.statusCode); }).on('error', reject).end();
    });
    assert.equal(status, 400);
    assert.equal((await fetch(origin)).status, 200);
  });
} finally { await new Promise(resolve => server.close(resolve)); }
