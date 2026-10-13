import test from 'node:test';
import assert from 'node:assert/strict';
import {CANDIDATES,rankTraining,runSearch} from './run-condor-search.mjs';
const record=(candidate,seed,reward=1,extra={})=>({candidateId:candidate.id,courseSeed:seed,phase:'training',episodeId:`${candidate.id}/${seed}`,reason:'game-over',reward,obstaclesPassed:0,coinsCollected:0,activeFlightSeconds:reward*10,...extra});
test('ranks only complete paired training courses and never evaluation or interrupted rewards',()=>{
 const rows=CANDIDATES.flatMap((c,i)=>[record(c,101,i/10),record(c,102,i/10)]);
 rows.push(record(CANDIDATES[0],10001,100,{phase:'evaluation'}));rows.push(record(CANDIDATES[0],103,100));rows.push(record(CANDIDATES[1],101,100,{reason:'api-error',reward:null}));rows.push(...CANDIDATES.map(c=>record(c,104,0,{activeFlightSeconds:-1})));
 const ranked=rankTraining(rows);assert.equal(ranked.length,9);assert.equal(ranked[0].candidate.id,CANDIDATES.at(-1).id);assert.equal(ranked[0].n,2);assert.deepEqual(ranked[0].seeds,[101,102]);assert.equal(ranked.at(-1).meanReward,0);
});
test('a duplicate episode cannot increase training weight',()=>{const rows=CANDIDATES.map(c=>record(c,101,1));assert.deepEqual(rankTraining([...rows,rows[0]]),rankTraining(rows));});

import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
test('mock CLI produces paired evaluation and durable zero-spend artifacts even when selected equals baseline',async t=>{
 const temp=await mkdtemp(join(tmpdir(),'condor-search-test-'));t.after(()=>rm(temp,{recursive:true,force:true}));const output=join(temp,'run');
 await promisify(execFile)(process.execPath,['scripts/run-condor-search.mjs','--mock',`--output=${output}`],{env:{PATH:process.env.PATH},timeout:30000});
 const summary=JSON.parse(await readFile(join(output,'summary.json'),'utf8'));assert.equal(summary.mock,true);assert.equal(summary.spend.confirmedUsd,0);assert.equal(summary.spend.calls,0);assert.equal(summary.completeTrainingCourses,2);assert.equal(summary.heldOutPairs.length,6);assert.equal(summary.targetReached,false);
 const traces=(await readFile(join(output,'episodes.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(traces.filter(r=>r.phase==='evaluation').length,6);assert.equal(traces.filter(r=>r.phase==='baseline').length,6);assert.ok(traces.every(r=>r.events.some(e=>e.type==='decision')));
 await assert.rejects(promisify(execFile)(process.execPath,['scripts/run-condor-search.mjs','--mock',`--output=${output}`],{env:{PATH:process.env.PATH}}));
});

test('trace-write failure stops all workers and awaits already dispatched calls',async t=>{
 const temp=await mkdtemp(join(tmpdir(),'condor-search-failure-'));t.after(()=>rm(temp,{recursive:true,force:true}));const output=join(temp,'run');const original=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fake-test-key';t.after(()=>{if(original===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=original});
 const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('Test must not use global network')};t.after(()=>globalThis.fetch=originalFetch);
 const pending=[];let settled=false;const running=runSearch({output,targetUsd:0,maxUsd:.02,parallel:2,maxTrainingFlights:9,maxEvaluationPairs:6,fetchImpl:async(_url,options)=>new Promise(resolve=>pending.push({resolve,step:JSON.parse(JSON.parse(options.body).input).simulation.stepFrames,settled:false}))}).then(r=>{settled=true;return r});
 const wait=async check=>{for(let i=0;i<200&&!check();i++)await new Promise(r=>setTimeout(r,5));assert.ok(check())};
 await wait(()=>pending.length===6);const {mkdir}=await import('node:fs/promises');await mkdir(join(output,'episodes.jsonl'));
 const response=()=>new Response(JSON.stringify({answers:[{name:'flight',type:'choice',choice:'wait',confidence:1,probabilities:[{value:'flap',probability:0},{value:'wait',probability:1}]}],usage:{input_tokens:100,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens:0,total_tokens:100}}),{status:200,headers:{'content-type':'application/json'}});
 for(let round=0;round<3;round++){await wait(()=>pending.filter(p=>p.step===9&&!p.settled).length===3);for(const p of pending.filter(p=>p.step===9&&!p.settled)){p.settled=true;p.resolve(response())}}
 await new Promise(r=>setTimeout(r,20));assert.equal(settled,false);const dispatched=pending.length;assert.equal(dispatched,12);for(const p of pending.filter(p=>!p.settled)){p.settled=true;p.resolve(response())}const summary=await running;assert.equal(summary.stopReason,'run-error');assert.equal(summary.spend.reservedUsd,0);assert.equal(pending.length,dispatched);
});

test('limited remaining API allowance reserves requests for evaluation instead of endless training',async t=>{
 const temp=await mkdtemp(join(tmpdir(),'condor-search-quota-'));t.after(()=>rm(temp,{recursive:true,force:true}));const output=join(temp,'run');const original=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fake-test-key';t.after(()=>{if(original===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=original});let calls=0;
 const summary=await runSearch({output,targetUsd:0,maxUsd:.02,parallel:2,maxTrainingFlights:9,maxEvaluationPairs:6,fetchImpl:async()=>{calls++;return new Response(JSON.stringify({answers:[{name:'flight',type:'choice',choice:'wait',confidence:1,probabilities:[{value:'flap',probability:0},{value:'wait',probability:1}]}],usage:{input_tokens:100,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens:0,total_tokens:100}}),{status:200,headers:{'content-type':'application/json','x-ratelimit-remaining-requests':'1500'}})}});
 assert.equal(calls,6);assert.equal(summary.spend.calls,6);assert.equal(summary.selected,null);const live=JSON.parse(await readFile(join(output,'live.json'),'utf8'));assert.equal(live.flightInvocations,2);assert.equal(live.running,false);
});
