const http = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const files = new Map([
  ['/results.html', ['results.html', 'text/html; charset=utf-8']],
  ['/calculator.mjs', ['calculator.mjs', 'text/javascript; charset=utf-8']],
  ['/flow.mjs', ['flow.mjs', 'text/javascript; charset=utf-8']],
  ['/results.mjs', ['results.mjs', 'text/javascript; charset=utf-8']],
  ['/optimizer-worker.mjs', ['optimizer-worker.mjs', 'text/javascript; charset=utf-8']],
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/stats.js', ['stats.js', 'text/javascript; charset=utf-8']],
  ['/anvil.png', ['anvil.png', 'image/png']],
  ['/pretendard.woff2', ['pretendard.woff2', 'font/woff2']],
  ['/FONT-LICENSE.txt', ['FONT-LICENSE.txt', 'text/plain; charset=utf-8']],
]);

function createServer() {
  return http.createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      return response.end();
    }
    const file = files.get(request.url.split('?')[0]);
    if (!file) {
      response.writeHead(404);
      return response.end('Not found');
    }
    try {
      const content = await readFile(path.join(__dirname, 'public', file[0]));
      response.writeHead(200, { 'Content-Type': file[1] });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch (error) {
      console.error(error);
      response.writeHead(500);
      response.end('Unable to load page');
    }
  });
}

if (require.main === module) {
  createServer().listen(5173, '0.0.0.0', () => {
    console.log('Stat Master: http://localhost:5173');
  });
}

module.exports = { createServer };



