import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, symlink, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import * as sprites from '../sprites.js';

test('dashboard serves only its assets and the live snapshot, with loopback and origin guards', async t => {
  const {createSearchDashboard} = await import('./search-dashboard.mjs');
  const dataDir = await mkdtemp(join(tmpdir(), 'condor-dashboard-'));
  const server = createSearchDashboard({dataDir});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {await new Promise(resolve => server.close(resolve)); await rm(dataDir, {recursive:true, force:true});});
  const port = server.address().port;
  const request = (path, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    http.request({hostname:'127.0.0.1', port, path, method, headers}, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', chunk => body += chunk);
      response.on('end', () => resolve({status:response.statusCode, headers:response.headers, body}));
    }).on('error', reject).end();
  });
  const waiting = await request('/live');
  assert.equal(waiting.status, 200);
  assert.equal(JSON.parse(waiting.body).phase, 'waiting');
  assert.equal(waiting.headers['cache-control'], 'no-store');
  assert.match((await request('/')).headers['content-security-policy'], /default-src 'self'/);
  for (const route of ['/dashboard.js','/dashboard.css','/sprites.js']) assert.equal((await request(route)).status, 200);
  for (const route of ['/.env','/../.env','/%2e%2e/.env','/live.json','/scripts/','/live?file=.env']) assert.equal((await request(route)).status, 404);
  assert.equal((await request('/live', {}, 'POST')).status, 405);
  assert.equal((await request('/live', {host:'attacker.example'})).status, 403);
  assert.equal((await request('/live', {origin:'https://attacker.example'})).status, 403);
  assert.equal((await request('/live', {'sec-fetch-site':'cross-site'})).status, 403);
  assert.equal((await request('/live', {origin:`http://localhost:${port}`})).status, 200);
  await writeFile(join(dataDir,'live.json'), JSON.stringify({phase:'training', birds:[], spend:{confirmedUsd:.2}}));
  assert.equal(JSON.parse((await request('/live')).body).spend.confirmedUsd, .2);
  await writeFile(join(dataDir,'live.json'), '{partial');
  assert.equal(JSON.parse((await request('/live')).body).phase, 'waiting');
  await rm(join(dataDir,'live.json'));
  await writeFile(join(dataDir,'secret'), 'private contents');
  await symlink(join(dataDir,'secret'),join(dataDir,'live.json'));
  assert.equal(JSON.parse((await request('/live')).body).phase, 'waiting');
});

test('dashboard uses snapshot geometry and text-only labels while reporting separate spend and call counts', async () => {
  const rectangles = [];
  class Element {
    constructor(tag) {this.tag = tag; this.children = []; this.attributes = {}; this.textContent = '';}
    append(...children) {this.children.push(...children);}
    replaceChildren(...children) {this.children = children;}
    setAttribute(key, value) {this.attributes[key] = value;}
    getContext() {return {scale(){}, createLinearGradient(){return {addColorStop(){}};}, fillText(){}, fillRect(...args){rectangles.push(args);}};}
  }
  const elements = new Map();
  const document = {getElementById(id){if (!elements.has(id)) elements.set(id,new Element('div')); return elements.get(id);}, createElement(tag){return new Element(tag);}};
  const context = vm.createContext({...sprites, document, setTimeout(){}, fetch:() => new Promise(() => {})});
  const source = (await readFile(new URL('./search-dashboard.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/, '');
  vm.runInContext(source, context);
  assert.equal(elements.get('birds').children.length,4);
  context.snapshot = {phase:'training',running:true,completedFlights:7,validFlights:6,interruptedFlights:1,flightInvocations:10,approvedMaxUsd:1.25,targetUsd:1,spend:{confirmedUsd:.123,reservedUsd:.4,uncertainUsd:.2,committedCeilingUsd:.723,calls:30},trainingRanking:[{candidate:{strategyId:'<img src=x onerror=alert(1)>',stepFrames:12},n:2,meanReward:4,meanObstacles:3,meanSeconds:2}],birds:[{slot:0,status:'deciding',strategyId:'balanced',stepFrames:12,snapshot:{playfield:{width:384,height:216,ground:196},condor:{x:26,spriteY:70},mountains:[{x:100,topRows:[8],bottomRows:[9]}],visibleCoins:[],obstaclesPassed:3,activeFlightSeconds:2,frame:120}}]};
  vm.runInContext('render(snapshot)',context);
  assert.equal(elements.get('spend').textContent,'$0.12');
  assert.equal(elements.get('reserved').textContent,'$0.40');
  assert.equal(elements.get('uncertain').textContent,'$0.20');
  assert.equal(elements.get('calls').textContent,'30');
  assert.equal(elements.get('invocations').textContent,10);
  assert.equal(elements.get('budget').max,1.25);
  assert.equal(elements.get('best').textContent,'<img src=x onerror=alert(1)> · 12 frames');
  assert.equal(elements.get('best').children.length,0);
  assert.ok(rectangles.some(([x,y,w,h]) => x===92 && y===0 && w===16 && h===1));
  assert.ok(rectangles.some(([x,y,w,h]) => x===91 && y===195 && w===18 && h===1));
  assert.match(elements.get('birds').children[0].children[1].attributes['aria-label'],/3 obstacles passed, frame 120/);
});
