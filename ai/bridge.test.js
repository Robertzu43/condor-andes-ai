import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {projectFlight} from './projection.mjs';
import {createController} from './controller.js';
import {readFile} from 'node:fs/promises';
const source=(await readFile(new URL('../game.js',import.meta.url),'utf8')).replace(/^import .*\n/,'');
function load(host='127.0.0.1',hash='#ai') {
 const listeners={};const cv={style:{},getContext:()=>({}),};const sandbox={window:{},location:{hostname:host,hash},document:{getElementById:()=>cv,documentElement:{}},innerWidth:768,innerHeight:432,matchMedia:()=>({matches:false}),getComputedStyle:()=>({getPropertyValue:()=>''}),localStorage:{getItem:()=>null,setItem:()=>{}},addEventListener:(n,f)=>listeners[n]=f,performance:{now:()=>0},requestAnimationFrame:()=>{},navigator:{},fetch:()=>{throw Error('AI must not submit')},GLIDE:[],FLAP:[],COIN:[],PAL:{},OUTLINE:{},THEME:{},drawSprite:()=>{}};
 vm.createContext(sandbox);vm.runInContext(source,sandbox);return {sandbox,listeners,bridge:sandbox.window.condorAI};
}
test('bridge is gated, starts active play and hides future random state',()=>{assert.equal(load('example.com').bridge,undefined);const {bridge}=load();bridge.start();const s=bridge.snapshot();assert.equal(s.state,'play');assert.equal(s.mountains.length,0);assert.equal(JSON.stringify(s).includes('next'),false);assert.equal(s.gravity,.35);bridge.flap();assert.equal(bridge.snapshot().condor.vy,-5.2);bridge.pause();assert.equal(bridge.snapshot().paused,true)});
test('resize and visibility freeze AI run instead of reset',()=>{const {bridge,listeners,sandbox}=load();bridge.start();const s=bridge.snapshot();sandbox.innerWidth=500;listeners.resize();assert.equal(bridge.snapshot().state,'play');assert.equal(bridge.snapshot().playfield.width,s.playfield.width);assert.equal(bridge.snapshot().paused,true)});
test('AI game over neither writes best score nor posts leaderboard',()=>{const {sandbox,bridge}=load();bridge.start();vm.runInContext('score=5; gameOver(); endScreen(); showTable({name:"AAA",score:5})',sandbox);assert.equal(bridge.snapshot().state,'gameover')});

// Removing seed reset or falling back to Math.random must break replay equality.
function replay(run,seed) {
 run.bridge.start({seed});const observations=[];
 for(let i=0;i<120;i++) {if(i%28===0)run.bridge.flap();vm.runInContext('step()',run.sandbox);if(i%20===19)observations.push(JSON.parse(JSON.stringify(run.bridge.snapshot().mountains)))}
 assert.ok(observations.some(m=>m.length));return observations;
}
test('same seed resets the AI course across identical frame and action replays',()=>{
 const run=load();const first=replay(run,101);assert.deepEqual(replay(run,101),first);assert.equal(run.bridge.snapshot().courseSeed,101);
 assert.notDeepEqual(replay(run,102),first);
});
test('seed validates unsigned 32-bit integers before changing a run',()=>{
 const {bridge}=load();bridge.start({seed:0});assert.equal(bridge.snapshot().courseSeed,0);
 for(const seed of [-1,2**32,1.5,NaN,Infinity,'101',null]){assert.throws(()=>bridge.start({seed}),/seed/i);assert.equal(bridge.snapshot().courseSeed,0)}
 bridge.start({seed:2**32-1});assert.equal(bridge.snapshot().courseSeed,2**32-1);
 bridge.start();assert.equal(bridge.snapshot().courseSeed,null);
});
test('unseeded human courses still consume Math.random',()=>{
 const {sandbox}=load('example.com','');vm.runInContext('Math.random=()=>0;tap(-1,-1);tap(-1,-1)',sandbox);
 assert.equal(vm.runInContext('pairs[0].gap',sandbox),92);
 vm.runInContext('state="title";Math.random=()=>0.999;tap(-1,-1);tap(-1,-1)',sandbox);
 assert.equal(vm.runInContext('pairs[0].gap',sandbox),98);
});
test('seeded AI courses are isolated from global random and unseeded start restores it',()=>{
 const run=load();vm.runInContext('Math.random=()=>{throw Error("global random used")}',run.sandbox);replay(run,0);
 vm.runInContext('Math.random=()=>0',run.sandbox);run.bridge.start();assert.equal(vm.runInContext('pairs[0].gap',run.sandbox),92);
});
test('ULTRA score counts one physical obstacle once and resets on restart',()=>{
 const {bridge,sandbox}=load();bridge.start({seed:101});
 vm.runInContext('mode="ultra";pairs=[{x:30,hw:20,gapY:20,gap:100,bot:[],top:[],next:120,coin:false,passed:false}];step()',sandbox);
 assert.equal(bridge.snapshot().score,2);assert.equal(bridge.snapshot().obstaclesPassed,1);
 vm.runInContext('step()',sandbox);assert.equal(bridge.snapshot().obstaclesPassed,1);
 bridge.start({seed:101});assert.equal(bridge.snapshot().obstaclesPassed,0);
});
test('fifth physical coin remains cumulative after ULTRA meter reset and rock hit',()=>{
 const {bridge,sandbox}=load();bridge.start();
 for(let i=0;i<5;i++)vm.runInContext('y=80;vy=0;pairs=[{x:84,hw:20,gapY:50,gap:92,bot:[],top:[],next:120,coin:true,passed:false}];step()',sandbox);
 assert.equal(bridge.snapshot().mode,'ultra');assert.equal(bridge.snapshot().coins,0);assert.equal(bridge.snapshot().coinsCollected,5);
 vm.runInContext('step();hitRock()',sandbox);assert.equal(bridge.snapshot().coinsCollected,5);
 bridge.start();assert.equal(bridge.snapshot().coinsCollected,0);
});
test('active flight seconds exclude frozen preparation and terminal animation',()=>{
 const {bridge,sandbox}=load();vm.runInContext('draw=()=>{}',sandbox);bridge.start();bridge.pause();
 vm.runInContext('loop(5000)',sandbox);assert.equal(bridge.snapshot().activeFlightSeconds,0);
 bridge.resume();vm.runInContext('step();step();step()',sandbox);assert.equal(bridge.snapshot().activeFlightSeconds,3/60);
 vm.runInContext('gameOver();step();step()',sandbox);assert.equal(bridge.snapshot().activeFlightSeconds,3/60);
 assert.equal(bridge.snapshot().activeFlightSeconds,bridge.snapshot().frame/60);
 bridge.start();assert.equal(bridge.snapshot().activeFlightSeconds,0);
});

// The oracle runs the game's actual step/hitRock code, not the projection's formulas.
test('silhouette forecasts match actual first rock contact across tap, wait and response delay',t=>{
 let checked=0,contacts=0,envelopeOnly=0;
 for(const seed of [101,102,103])for(const spriteY of [5,45,100,155])for(const action of ['flap','wait'])for(const latencyMs of [0,200]){
  const {bridge,sandbox}=load();bridge.start({seed});
  vm.runInContext(`y=${spriteY};vy=1;pairs[0].x=110;globalThis.firstRock=null;const originalHitRock=hitRock;hitRock=()=>{firstRock??=frame;originalHitRock()}`,sandbox);
  const observation=JSON.parse(JSON.stringify(bridge.snapshot()));
  const prediction=projectFlight({observation,latencyMs,previousAction:{action:'wait',frame:0}});
  for(let i=0;i<prediction.requestFrames && bridge.snapshot().state==='play';i++)vm.runInContext('step()',sandbox);
  const arrivalRock=vm.runInContext('firstRock',sandbox);
  assert.equal(prediction.arrivalRockContactFrame,arrivalRock,`arrival seed=${seed} y=${spriteY}`);
  if(bridge.snapshot().state!=='play')continue;
  vm.runInContext('firstRock=null',sandbox);if(action==='flap')bridge.flap();
  const appliedFrame=bridge.snapshot().frame;
  for(let i=0;i<30 && bridge.snapshot().state==='play';i++)vm.runInContext('step()',sandbox);
  const actualFrame=vm.runInContext('firstRock',sandbox);
  const actualContact=actualFrame===null?null:actualFrame-appliedFrame;
  assert.equal(prediction.candidates[action].delayStress.firstRockContactFrame,actualContact,`candidate seed=${seed} y=${spriteY} action=${action} delay=${latencyMs}`);
  if(actualContact!==null)contacts++;else if(prediction.candidates[action].delayStress.minimumCorridorTopMargin<0||prediction.candidates[action].delayStress.minimumCorridorBottomMargin<0)envelopeOnly++;
  else {assert.ok(Math.abs(prediction.candidates[action].delayStress.end.y-bridge.snapshot().condor.y)<.006);assert.ok(Math.abs(prediction.candidates[action].delayStress.end.vy-bridge.snapshot().condor.vy)<.006)}
  checked++;
 }
 assert.ok(checked>=20);assert.ok(contacts>=5);
 t.diagnostic(`${checked} candidate paths checked, ${contacts} actual rock contacts, ${envelopeOnly} rectangular-risk warnings without actual rock contact.`);
});
test('AI snapshots track actual taps and distinguish rock from ground death, resetting each flight',()=>{
 const {bridge,sandbox}=load();bridge.start({seed:101});assert.equal(bridge.snapshot().lastFlapFrame,null);assert.equal(bridge.snapshot().deathCause,null);
 bridge.flap();assert.equal(bridge.snapshot().lastFlapFrame,0);vm.runInContext('step();step()',sandbox);bridge.flap();assert.equal(bridge.snapshot().lastFlapFrame,2);
 vm.runInContext('pairs=[];y=GROUND-24;vy=8;step()',sandbox);assert.equal(bridge.snapshot().deathCause,'ground');
 bridge.start({seed:101});assert.equal(bridge.snapshot().lastFlapFrame,null);assert.equal(bridge.snapshot().deathCause,null);
 vm.runInContext('hitRock()',sandbox);assert.equal(bridge.snapshot().deathCause,'rock');
});

test('controller exports actual tap effect and terminal collision snapshot',async()=>{
 const {bridge,sandbox}=load();let applied;const events=[];
 const done=new Promise(resolve=>{applied=resolve});
 const c=createController({game:bridge,decide:async()=>({action:'flap',confidence:1,probabilities:[{choice:'flap',probability:1},{choice:'wait',probability:0}]}),onEvent:e=>{events.push(e);if(e.type==='decision')applied(e)}});
 try{c.start();const e=await done;assert.equal(e.appliedState.condor.vy,-5.2);assert.equal(e.appliedState.lastFlapFrame,e.appliedFrame);assert.equal(e.observation.condor.vy,0);
 vm.runInContext('pairs=[];y=GROUND-24;vy=8;step()',sandbox);c.stop('game-over');assert.equal(events.at(-1).gameState.deathCause,'ground');}finally{c.stop()}
});
