import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from './server.mjs';
test('server serves explicit assets, rejects origins and hides files',async t=>{const s=createServer({mock:true});await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>s.close());const base=`http://127.0.0.1:${s.address().port}`;assert.equal((await fetch(base+'/api/status').then(r=>r.json())).mock,true);for(const path of ['/.env','/package.json','/ai/server.mjs','/../README.md'])assert.equal((await fetch(base+path)).status,404);assert.equal((await fetch(base+'/api/decision',{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:'{}'})).status,403);assert.equal((await fetch(base+'/api/decision',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({observation:{state:'play'}})})).status,200)});
test('missing key is reported safely and paid endpoint requires Origin',async t=>{const s=createServer({apiKey:''});await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>s.close());const base=`http://127.0.0.1:${s.address().port}`;assert.deepEqual(await fetch(base+'/api/status').then(r=>r.json()),{configured:false,model:'gpt-6-luna',mock:false});assert.equal((await fetch(base+'/api/decision',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,403);const r=await fetch(base+'/api/decision',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({observation:{state:'play'}})});assert.equal(r.status,400);assert.match((await r.json()).error,/not configured/)});
test('provider authentication failure returns only an allowlisted code',async t=>{const s=createServer({apiKey:'fake-secret',fetchImpl:async()=>({ok:false,status:401})});await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>s.close());const base=`http://127.0.0.1:${s.address().port}`;const r=await fetch(base+'/api/decision',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({observation:{state:'play'}})});const body=await r.json();assert.equal(body.code,'authentication');assert.ok(!JSON.stringify(body).includes('fake-secret'));});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const providerAnswer={answers:[{name:'flight',type:'choice',choice:'wait',confidence:1,probabilities:[{value:'flap',probability:0},{value:'wait',probability:1}]}]};
const startServer=async(t,options)=>{const s=createServer(options);await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));t.after(()=>s.close());const base=`http://127.0.0.1:${s.address().port}`;return {base,post:(payload={observation:{state:'play'}},options={})=>fetch(base+'/api/decision',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify(payload),...options})}};
test('six upstream requests remain admitted concurrently and release capacity only when settled',async t=>{
 const releases=[];const {post}=await startServer(t,{apiKey:'fake',fetchImpl:()=>new Promise(resolve=>releases.push(()=>resolve({ok:true,json:async()=>providerAnswer})))});
 t.after(()=>releases.forEach(release=>release()));
 const pending=Array.from({length:6},()=>post());await sleep(80);
 const seventh=await post();assert.equal(seventh.status,429);assert.equal((await seventh.json()).code,'local-capacity');
 releases.forEach(release=>release());assert.deepEqual((await Promise.all(pending)).map(r=>r.status),[200,200,200,200,200,200]);
 const next=post();await sleep(30);releases.at(-1)();assert.equal((await next).status,200);
});
test('client abort retains capacity until upstream settles',async t=>{
 const releases=[];const {post}=await startServer(t,{apiKey:'fake',fetchImpl:()=>new Promise(resolve=>releases.push(()=>resolve({ok:true,json:async()=>providerAnswer})))});t.after(()=>releases.forEach(release=>release()));
 const abort=new AbortController(),first=post(undefined,{signal:abort.signal}).catch(()=>null),pending=Array.from({length:5},()=>post());await sleep(80);abort.abort();await first;await sleep(20);
 const full=await post();assert.equal(full.status,429);assert.equal((await full.json()).code,'local-capacity');
 releases.forEach(release=>release());await Promise.all(pending);await sleep(20);const next=post();await sleep(20);releases.at(-1)();assert.equal((await next).status,200);
});
test('protected raw requests consume rolling capacity even when payload validation fails',async t=>{
 const {base,post}=await startServer(t,{mock:true});
 for(let i=0;i<30;i++){assert.equal((await fetch(base+'/api/decision',{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:'{}'})).status,403);assert.equal((await post({observation:[]})).status,400)}
 const limited=await post();assert.equal(limited.status,429);assert.equal((await limited.json()).code,'local-capacity');await sleep(1050);assert.equal((await post()).status,200);
});
test('upstream rate-limit stays distinct from local capacity and failed calls release slots',async t=>{
 const {post}=await startServer(t,{apiKey:'fake',fetchImpl:async()=>({ok:false,status:429,json:async()=>({error:{message:'fake-secret'}})})});
 for(let i=0;i<7;i++){const r=await post();assert.equal(r.status,400);const body=await r.json();assert.equal(body.code,'rate-limit');assert.ok(!JSON.stringify(body).includes('fake-secret'))}
});
test('controller sends concurrent role cohorts over local HTTP and applies only a shared quorum',async t=>{
 const {createController}=await import('./controller.js');const upstream=[],statuses=[],events=[];
 const {post}=await startServer(t,{apiKey:'fake',fetchImpl:(_url,options)=>new Promise(resolve=>upstream.push({body:JSON.parse(options.body),at:performance.now(),release:()=>resolve({ok:true,json:async()=>providerAnswer})}))});
 const game={paused:false,start(){this.paused=false},pause(){this.paused=true},resume(){this.paused=false;return true},snapshot(){return{state:'play',frame:1,paused:this.paused,pauseReason:this.paused?'controller':null}},flap(){throw Error('wait only')}};
 const c=createController({game,onEvent:e=>events.push(e),decide:async(payload,{signal})=>{const r=await post(payload,{signal});statuses.push(r.status);if(!r.ok)throw Object.assign(Error('HTTP decision rejected'),{code:(await r.json()).code});return r.json()}});
 t.after(()=>{c.stop();upstream.forEach(p=>p.release())});
 const until=async predicate=>{const end=Date.now()+1000;while(!predicate()&&Date.now()<end)await sleep(5);assert.ok(predicate(),'HTTP cohort completed before timeout')};
 c.start({maxRequests:6,strategyId:'upper-caution-v1'});await until(()=>upstream.length===3);assert.equal(game.paused,true);assert.equal(events.filter(e=>e.type==='decision').length,0);
 const inputs=upstream.map(p=>JSON.parse(p.body.input));assert.deepEqual(inputs.map(p=>p.assessment),['immediate','approach','recovery']);assert.ok(inputs.every(p=>p.strategyId==='upper-caution-v1'));assert.equal(new Set(inputs.map(p=>p.observation.frame)).size,1);
 upstream[0].release();upstream[1].release();await until(()=>events.some(e=>e.type==='decision'));assert.equal(game.paused,false);await until(()=>upstream.length===6);assert.ok(upstream[3].at-upstream[0].at>=140);
 upstream.forEach(p=>p.release());await c.waitForIdle();assert.ok(statuses.every(status=>status===200));assert.equal(c.state.reason,'budget');assert.equal(events.filter(e=>e.type==='decision').length,2);assert.ok(events.filter(e=>e.type==='decision').every(e=>e.assessments.length===2));
});
