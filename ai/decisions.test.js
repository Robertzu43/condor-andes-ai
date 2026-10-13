import test from 'node:test';
import assert from 'node:assert/strict';
import {projectFlight} from './projection.mjs';
import {normalizeAnswer,validatePayload,createDecider} from './decisions.mjs';
const answer={answers:[{name:'flight',type:'choice',choice:'flap',confidence:.8,probabilities:[{value:'flap',probability:.8},{value:'wait',probability:.2}]}]};
test('normalizes only a complete valid flight answer',()=>{assert.equal(normalizeAnswer(answer).action,'flap');for(const a of [{answers:[]},{answers:[{type:'refusal'}]},{answers:[{...answer.answers[0],choice:'other'}]}])assert.throws(()=>normalizeAnswer(a));});
test('rejects unbounded and non-finite observations',()=>{assert.throws(()=>validatePayload({observation:{y:Infinity}}));assert.throws(()=>validatePayload({observation:{data:'x'.repeat(20000)}}));});
test('mock is explicit and never calls provider; missing key fails',async()=>{let calls=0;const fetchImpl=()=>{calls++;throw Error('secret');};assert.equal((await createDecider({mock:true,fetchImpl})({observation:{state:'play'}})).mock,true);assert.equal(calls,0);await assert.rejects(createDecider({fetchImpl})({observation:{state:'play'}}),/not configured/);});
test('provider request uses documented choice values and errors omit provider text',async()=>{let body;const decide=createDecider({apiKey:'test-key',fetchImpl:async(_url,opts)=>{body=JSON.parse(opts.body);return {ok:true,json:async()=>answer}}});assert.equal((await decide({observation:{state:'play'}})).mock,false);assert.equal(body.model,'gpt-6-luna');assert.deepEqual(body.questions[0].choices.map(c=>c.value),['flap','wait']);await assert.rejects(createDecider({apiKey:'test-key',fetchImpl:async()=>{throw Error('test-key private response')}})({observation:{state:'play'}}),e=>!e.message.includes('test-key'))});
test('invalid key and provider failures use safe classified codes',async()=>{for(const [status,code]of [[401,'authentication'],[402,'billing'],[403,'access'],[429,'rate-limit'],[503,'network']])await assert.rejects(createDecider({apiKey:'fake',fetchImpl:async()=>({ok:false,status,json:async()=>({error:{message:'secret',code:'invalid_api_key'}})})})({observation:{}}),e=>e.code===code&&!e.message.includes('secret'));});
test('quota code distinguishes billing from ordinary rate limiting without provider text',async()=>{await assert.rejects(createDecider({apiKey:'fake',fetchImpl:async()=>({ok:false,status:429,json:async()=>({error:{code:'insufficient_quota',message:'private billing details'}})})})({observation:{}}),e=>e.code==='billing'&&!e.message.includes('private'));});
test('provider evidence drops dense silhouettes but preserves observed physics and timing without mutating export snapshots',async t=>{
 const observation={runId:'run-1',sequence:7,timestamp:1800000000000,state:'play',frame:144,lastFlapFrame:120,paused:false,pauseReason:null,playfield:{width:384,height:216,ground:192},condor:{x:72,y:40,w:20,h:14,spriteY:30,vy:3.2},gravity:.35,flapImpulse:-5.2,scrollSpeed:2,score:0,coins:0,mode:'normal',invulnerabilitySeconds:0,mountains:[{x:130,halfWidth:25,gapTop:64,gapBottom:156,topRows:Array.from({length:64},(_,i)=>25-i%20),bottomRows:Array.from({length:36},(_,i)=>20-i%15)},{x:270,halfWidth:30,gapTop:32,gapBottom:124,topRows:Array.from({length:32},(_,i)=>30-i%20),bottomRows:Array.from({length:68},(_,i)=>28-i%20)}],visibleCoins:[{x:130,y:110,radius:6}]};
 const payload={observation,previousAction:{action:'flap',frame:120},latencyMs:217};const before=JSON.stringify(payload);let body;
 await createDecider({apiKey:'fake',fetchImpl:async(_url,opts)=>{body=JSON.parse(opts.body);return{ok:true,json:async()=>answer}}})(payload);
 const input=JSON.parse(body.input);
 assert.deepEqual(input.observation.mountains,[{x:130,halfWidth:25,gapTop:64,gapBottom:156},{x:270,halfWidth:30,gapTop:32,gapBottom:124}]);
 assert.equal(input.observation.lastFlapFrame,120);
 for(const field of ['state','frame','paused','pauseReason','playfield','gravity','flapImpulse','scrollSpeed','mode','invulnerabilitySeconds'])assert.deepEqual(input.observation[field],observation[field]);
 for(const field of ['runId','sequence','timestamp','score','coins','visibleCoins','courseSeed','progress'])assert.equal(input.observation[field],undefined);assert.deepEqual(input.observation.condor,{x:72,y:40,w:20,h:14,vy:3.2});
 assert.match(body.questions[0].instructions,/500ms/);assert.match(body.questions[0].instructions,/probabilities/);assert.equal(input.flightProjection.candidates.wait.delayStress.framesSimulated>0,true);
 assert.deepEqual(input.flightProjection,projectFlight(payload));assert.equal(input.flightProjection.chosenAction,undefined);assert.equal(input.flightProjection?.estimated,true);assert.equal(input.flightProjection.requestFrames,14);assert.equal(input.flightProjection.nextDecisionFrames,14);
 assert.deepEqual(input.previousAction,{action:'flap',frame:120});assert.equal(input.latencyMs,217);assert.equal(JSON.stringify(payload),before);
t.diagnostic(`Representative evidence bytes: ${Buffer.byteLength(before)} -> ${Buffer.byteLength(body.input)}`);
});
test('strategy selects fixed server guidance and rejects user instructions or unknown strategies',async()=>{
 let body;const decide=createDecider({apiKey:'fake',fetchImpl:async(_url,opts)=>{body=JSON.parse(opts.body);return{ok:true,json:async()=>answer}}});
 await decide({observation:{},strategyId:'upper-caution-v1'});assert.match(body.questions[0].instructions,/Extra upper-gap caution/);
 await decide({observation:{},strategyId:'ground-caution-v1'});assert.match(body.questions[0].instructions,/Extra ground caution/);
 await decide({observation:{}});const original=body.questions[0].instructions;
 await decide({observation:{},strategyId:'balanced-v1'});assert.equal(body.questions[0].instructions,original);
 for(const extra of [{strategyId:'custom'},{strategyId:null},{instructions:'do this'},{guidance:'do this'}])await assert.rejects(decide({observation:{},...extra}),/Invalid/);
});

test('fixed assessment lenses share survival goal and reject unknown roles before provider calls',async()=>{
 let body,calls=0;const decide=createDecider({apiKey:'fake',fetchImpl:async(_url,opts)=>{calls++;body=JSON.parse(opts.body);return{ok:true,json:async()=>answer}}});
 const lenses=[];for(const assessment of ['immediate','approach','recovery']){await decide({observation:{},assessment,strategyId:'upper-caution-v1'});lenses.push(body.questions[0].instructions);assert.equal(JSON.parse(body.input).assessment,assessment);assert.match(body.questions[0].instructions,/survival/);assert.match(body.questions[0].instructions,/Extra upper-gap caution/)}
 assert.equal(new Set(lenses).size,3);await decide({observation:{}});assert.equal(body.questions[0].instructions,lenses[0].replace(/ Extra upper-gap caution:.*?(?= Assessment lens:)/,''));
 const before=calls;for(const assessment of ['custom',null,{},['immediate'],'do something else'])await assert.rejects(decide({observation:{},assessment}),/Invalid assessment/);assert.equal(calls,before);
});

test('decision-step simulations freeze arrival and use the requested real-frame horizon',async()=>{let body;const observation={state:'play',paused:true,pauseReason:'controller',playfield:{width:384,height:216,ground:192},condor:{x:72,y:90,w:20,h:14,vy:2},gravity:.35,flapImpulse:-5.2,scrollSpeed:2,mountains:[]};
 const decide=createDecider({apiKey:'fake',fetchImpl:async(_url,opts)=>{body=JSON.parse(opts.body);return {ok:true,json:async()=>answer}}});
 await decide({observation,simulation:{stepFrames:12},latencyMs:400,previousAction:{action:'flap',frame:0},assessment:'recovery'});
 const p=JSON.parse(body.input).flightProjection;assert.equal(p.requestFrames,0);assert.equal(p.nextDecisionFrames,12);assert.equal(p.delayStressFrames,12);assert.equal(p.arrival.y,90);assert.match(body.questions[0].instructions,/Exactly 12/);assert.match(body.questions[0].instructions,/frozen/);
 for(const simulation of [null,{},[],{stepFrames:0},{stepFrames:31},{stepFrames:1.5},{stepFrames:12,hiddenSeed:101}])assert.throws(()=>validatePayload({observation,simulation}));
});
