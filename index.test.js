const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('./index');

test('serves assets and rejects private files and unsupported methods', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(await page.text(), /<title>Stat Master<\/title>/);
    const results = await fetch(base + '/results.html');
    assert.equal(results.status, 200);
    for (const route of ['/calculator.mjs', '/flow.mjs', '/results.mjs', '/optimizer-worker.mjs']) {
      const script = await fetch(base + route);
      assert.equal(script.status, 200);
      assert.match(script.headers.get('content-type'), /text\/javascript/);
    }
    const logo = await fetch(base + '/anvil.png', { method: 'HEAD' });
    assert.equal(logo.headers.get('content-type'), 'image/png');
    assert.equal(await logo.text(), '');
    const font = await fetch(base + '/pretendard.woff2');
    assert.equal(font.status, 200);
    assert.equal(font.headers.get('content-type'), 'font/woff2');
    assert.equal(Buffer.from(await font.arrayBuffer()).toString('ascii', 0, 4), 'wOF2');
    for (const route of ['/package.json', '/.git/config', '/%2e%2e/package.json', '/constructor']) {
      assert.equal((await fetch(base + route)).status, 404);
    }
    assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});


