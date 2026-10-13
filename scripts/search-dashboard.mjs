import http from 'node:http';
import {readFile, open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const assets = new Map([
  ['/', [new URL('./search-dashboard.html', import.meta.url), 'text/html']],
  ['/dashboard.js', [new URL('./search-dashboard.js', import.meta.url), 'text/javascript']],
  ['/dashboard.css', [new URL('./search-dashboard.css', import.meta.url), 'text/css']],
  ['/sprites.js', [new URL('../sprites.js', import.meta.url), 'text/javascript']],
]);
const waiting = {phase:'waiting', running:false, birds:[], trainingRanking:[], recent:[], spend:{confirmedUsd:0, reservedUsd:0, uncertainUsd:0, calls:0}, approvedMaxUsd:1.25, targetUsd:1};

export function createSearchDashboard({dataDir}) {
  if (typeof dataDir !== 'string' || !isAbsolute(dataDir)) throw Error('Dashboard requires an absolute data directory');
  const liveFile = join(dataDir, 'live.json');
  return http.createServer(async (request, response) => {
    const port = response.socket.localPort;
    const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const end = (status, body, type = 'text/plain') => {response.writeHead(status, {'Content-Type':`${type}; charset=utf-8`}); response.end(request.method === 'HEAD' ? undefined : body);};
    if (!hosts.has(request.headers.host) || (request.headers.origin && ![...hosts].some(host => request.headers.origin === `http://${host}`)) || request.headers['sec-fetch-site'] === 'cross-site') return end(403, 'Forbidden');
    if (!['GET','HEAD'].includes(request.method)) return end(405, 'Read only');
    if (request.url === '/live') {
      let file;
      try {
        file = await open(liveFile, constants.O_RDONLY | constants.O_NOFOLLOW);
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw Error('Invalid snapshot');
        const state = JSON.parse(await file.readFile('utf8'));
        if (!state || typeof state !== 'object' || Array.isArray(state)) throw Error('Invalid snapshot');
        return end(200, JSON.stringify(state), 'application/json');
      } catch {return end(200, JSON.stringify(waiting), 'application/json');}
      finally {await file?.close();}
    }
    const asset = assets.get(request.url);
    if (!asset) return end(404, 'Not found');
    try {end(200, await readFile(asset[0]), asset[1]);} catch {end(500, 'Asset unavailable');}
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dataDir = process.argv.slice(2).find(value => value.startsWith('--data='))?.slice(7);
  const server = createSearchDashboard({dataDir});
  server.on('error', error => {console.error(`Dashboard unavailable: ${error.code || 'server error'}`); process.exitCode = 1;});
  server.listen(8790, '127.0.0.1', () => console.log('Condor dashboard: http://127.0.0.1:8790'));
}
