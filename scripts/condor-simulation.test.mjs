import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation,runSimulationFlight} from './condor-simulation.mjs';
import {serializeLearning,CONFIG_VERSION} from '../ai/learning.js';

const answer=p=>({action:p>.5?'flap':'wait',confidence:Math.max(p,1-p),probabilities:[{choice:'flap',probability:p},{choice:'wait',probability:1-p}],model:'test',mock:true});
const options={seed:101,strategyId:'balanced-v1',experimentId:'simulation-test',phase:'training',context:{model:'test',mock:true}};

test('actual game steps replay deterministically and birds have isolated state',()=>{
 const a=createSimulation({seed:101}),b=createSimulation({seed:101});
 assert.deepEqual(a.snapshot().playfield,{width:384,height:216,ground:192});
 for(let i=0;i<180 && a.snapshot().state==='play';i++){
  if(i%28===0){a.game.resume();a.game.flap();b.game.resume();b.game.flap()}
  a.advance(1);b.advance(1);assert.deepEqual(a.snapshot(),b.snapshot());
 }
 const before=a.snapshot();b.game.start({seed:102});b.advance(15);assert.deepEqual(a.snapshot(),before);
 assert.ok(a.snapshot().frame>25);
 assert.equal(a.snapshot().activeFlightSeconds,a.snapshot().frame/60);
});

test('cohort waits for all three answers, averages every valid choice and steps only after action',async()=>{
 const releases=[],payloads=[],events=[];
 let finished=false;
 const flight=runSimulationFlight({...options,maxFrames:12,maxRequests:3,onEvent:e=>events.push(e),decide:payload=>{
  payloads.push(payload);return new Promise(resolve=>releases.push(resolve));
 }}).then(r=>{finished=true;return r});
 assert.equal(releases.length,3);assert.deepEqual(payloads.map(p=>p.assessment),['immediate','approach','recovery']);
 assert.ok(payloads.every(p=>p.observation.frame===0 && p.observation.paused && p.simulation.stepFrames===12));
 assert.ok(payloads.every(p=>!Object.hasOwn(p.observation,'courseRandomState') && !JSON.stringify(p.observation).includes('"next"')));
 releases[0](answer(.6));releases[1](answer(.6));await new Promise(r=>setImmediate(r));
 assert.equal(finished,false);assert.equal(events.filter(e=>e.type==='decision').length,0);
 releases[2](answer(0));const r=await flight;
 const d=r.events.find(e=>e.type==='decision');assert.equal(d.action,'wait');assert.equal(d.assessments.length,3);
 assert.ok(Math.abs(d.probabilities[0].probability-.4)<1e-12);assert.equal(d.appliedFrame,0);assert.equal(r.activeFlightSeconds,12/60);
 assert.equal(r.requests,3);assert.equal(r.cohorts,1);assert.equal(r.reason,'duration');
 assert.equal(r.configVersion,`${CONFIG_VERSION}/decision-step-v1/12`);assert.doesNotThrow(()=>serializeLearning([r]));
});

test('cancelled cohorts settle every call and never apply a flap',async()=>{
 const abort=new AbortController(),releases=[];
 const flight=runSimulationFlight({...options,signal:abort.signal,decide:()=>new Promise(resolve=>releases.push(resolve))});
 abort.abort();releases[0](answer(1));releases[1](answer(1));
 let done=false;flight.then(()=>done=true);await new Promise(r=>setImmediate(r));assert.equal(done,false);
 releases[2](answer(1));const r=await flight;
 assert.equal(r.reason,'cancel');assert.equal(r.reward,null);assert.equal(r.activeFlightSeconds,0);
 assert.equal(r.gameState.lastFlapFrame,null);assert.equal(r.events.filter(e=>e.type==='decision').length,0);
});

test('flight wait-only terminal outcome equals independent actual game stepping',async()=>{
 const oracle=createSimulation({seed:101});oracle.advance(900);
 const r=await runSimulationFlight({...options,decide:async()=>answer(0)});
 assert.equal(r.reason,'game-over');assert.equal(r.cause,oracle.snapshot().deathCause);
 assert.equal(r.activeFlightSeconds,oracle.snapshot().frame/60);assert.equal(r.obstaclesPassed,oracle.snapshot().obstaclesPassed);
 assert.equal(r.coinsCollected,oracle.snapshot().coinsCollected);
});

test('failed request interrupts without reward and still settles other calls',async()=>{
 const releases=[];let calls=0;
 const flight=runSimulationFlight({...options,decide:()=>++calls===1?Promise.reject(Object.assign(Error('network'),{code:'network'})):new Promise(resolve=>releases.push(resolve))});
 let done=false;flight.then(()=>done=true);await new Promise(r=>setImmediate(r));assert.equal(done,false);
 releases.forEach(resolve=>resolve(answer(1)));const r=await flight;
 assert.equal(r.reason,'api-error');assert.equal(r.reward,null);assert.equal(r.requests,3);assert.equal(r.activeFlightSeconds,0);
});

test('two remaining requests form a final quorum and ties wait',async()=>{
 const r=await runSimulationFlight({...options,maxRequests:2,decide:async()=>answer(.5)});
 assert.equal(r.requests,2);assert.equal(r.reason,'budget');assert.equal(r.reward,null);
 assert.equal(r.events.find(e=>e.type==='decision').action,'wait');
});

test('flap action is applied once and matches the actual game at the decision step',async()=>{
 const oracle=createSimulation({seed:101});oracle.game.resume();oracle.game.flap();oracle.advance(12);
 const r=await runSimulationFlight({...options,maxFrames:12,decide:async()=>answer(1)});
 assert.deepEqual(r.gameState,oracle.snapshot());assert.equal(r.gameState.lastFlapFrame,0);
});

test('expired wall deadline prevents input even when all pending answers choose flap',async()=>{
 const releases=[];
 const flight=runSimulationFlight({...options,deadlineAt:Date.now()+15,decide:()=>new Promise(resolve=>releases.push(resolve))});
 await new Promise(resolve=>setTimeout(resolve,25));releases.forEach(resolve=>resolve(answer(1)));
 const r=await flight;assert.equal(r.reason,'wall-limit');assert.equal(r.reward,null);assert.equal(r.gameState.lastFlapFrame,null);
 assert.equal(r.activeFlightSeconds,0);
});

test('spend rejection settles its cohort and records a budget interruption',async()=>{
 const r=await runSimulationFlight({...options,decide:async()=>{throw Object.assign(Error('cap'),{code:'budget-exhausted'})}});
 assert.equal(r.reason,'budget');assert.equal(r.reward,null);assert.equal(r.activeFlightSeconds,0);
});

test('rejects out of bounds runs before requesting decisions',async()=>{
 for(const override of [{seed:-1},{stepFrames:0},{stepFrames:31},{maxFrames:901},{maxRequests:301},{strategyId:'unknown'}]){
  await assert.rejects(runSimulationFlight({...options,...override,decide:()=>{throw Error('must not call')}}),/Invalid simulation/);
 }
});

test('a response from another model does not contribute to the frozen-context decision',async()=>{
 const r=await runSimulationFlight({...options,maxFrames:12,decide:async p=>p.assessment==='recovery'?{...answer(1),model:'other'}:answer(.4)});
 const d=r.events.find(e=>e.type==='decision');assert.equal(d.action,'wait');assert.equal(d.assessments.length,2);
 assert.equal(r.events.find(e=>e.type==='assessment' && e.assessment==='recovery').valid,false);
});
