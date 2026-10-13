import test from 'node:test';
import assert from 'node:assert/strict';
import {createBudgetFetch} from './decision-budget.mjs';
const url='https://api.openai.com/v1/decisions';
const request=()=>({method:'POST',headers:{Authorization:'Bearer private-key'},body:JSON.stringify({model:'gpt-6-luna',input:'private-prompt',questions:[{name:'flight',type:'choice',instructions:'choose',choices:[{value:'wait',description:'no impulse'}]}]})});
const usage=(input=100,cached=0,write=0)=>({input_tokens:input,input_tokens_details:{cached_tokens:cached,cache_write_tokens:write},output_tokens:0,total_tokens:input});
const response=(u=usage(),status=200)=>new Response(JSON.stringify({usage:u,answers:[]}),{status,headers:{'x-ratelimit-remaining-requests':'7','x-private':'private-value'}});
test('accounts uncached inputs before returning original response, preserving body',async()=>{
 const records=[];const updates=[];const r=response(usage(100,30,20));const fetcher=createBudgetFetch({fetchImpl:async()=>r,onCall:r=>records.push(r),onUpdate:s=>updates.push(s)});
 assert.equal(await fetcher(url,request()),r);assert.deepEqual((await r.json()).usage,usage(100,30,20));
 assert.equal(fetcher.state.confirmedUsd,.000005);assert.equal(fetcher.state.reservedUsd,0);assert.equal(fetcher.state.knownUsageCount,1);assert.ok(updates[0].reservedUsd>0);assert.equal(records[0].rateLimits['x-ratelimit-remaining-requests'],'7');assert.ok(!JSON.stringify({records,updates}).includes('private'));
});
test('concurrent dispatch atomically reserves the cap',async()=>{
 const deferred=[];const fetcher=createBudgetFetch({maxUsd:.002,fetchImpl:()=>new Promise(resolve=>deferred.push(resolve))});
 const jobs=Array.from({length:20},()=>fetcher(url,request()).catch(e=>e.code));
 assert.ok(deferred.length>0&&deferred.length<20);assert.ok(fetcher.state.committedCeilingUsd<=.002);deferred.forEach(resolve=>resolve(response()));
 const settled=await Promise.all(jobs);assert.ok(settled.includes('budget-exhausted'));assert.equal(fetcher.state.reservedUsd,0);
});
test('missing, inconsistent and unsupported usage stops calls and retains the reserve',async()=>{
 for(const u of [null,{...usage(),input_tokens_details:{cached_tokens:90,cache_write_tokens:20}},{...usage(),output_tokens:1}, {...usage(),input_tokens:-1}, {...usage(),total_tokens:101}]){
  let count=0;const fetcher=createBudgetFetch({fetchImpl:async()=>{count++;return response(u)}});
  await assert.rejects(fetcher(url,request()),e=>e.code==='spend-unknown');assert.ok(fetcher.state.uncertainUsd>0);assert.equal(fetcher.state.reservedUsd,0);
  await assert.rejects(fetcher(url,request()),e=>e.code==='spend-unknown');assert.equal(count,1);
 }
});
test('provider errors, malformed response and dispatched aborts retain uncertain spend without retries',async()=>{
 for(const impl of [async()=>response(usage(),429),async()=>new Response('bad json'),async()=>{throw new DOMException('private error','AbortError')}]){
  const fetcher=createBudgetFetch({fetchImpl:impl});await assert.rejects(fetcher(url,request()),e=>e.code==='spend-unknown'&&!e.message.includes('private'));assert.ok(fetcher.state.uncertainUsd>0);assert.equal(fetcher.state.calls,1);
 }
});
test('pre-dispatch aborted signal and callback failure cannot dispatch',async()=>{
 let calls=0;const impl=async()=>{calls++;return response()};const controller=new AbortController();controller.abort();const fetcher=createBudgetFetch({fetchImpl:impl});
 await assert.rejects(fetcher(url,{...request(),signal:controller.signal}),e=>e.code==='budget-stop');assert.equal(fetcher.state.committedCeilingUsd,0);
 const callback=createBudgetFetch({fetchImpl:impl,onUpdate:()=>{throw Error('private ledger error')}});await assert.rejects(callback(url,request()),e=>e.code==='budget-stop');assert.equal(callback.state.committedCeilingUsd,0);assert.equal(calls,0);
});
test('validates hard cap, endpoint, model, text input and bounded JSON before dispatch',async()=>{
 for(const maxUsd of [0,-1,1.250000001,Infinity,NaN])assert.throws(()=>createBudgetFetch({maxUsd}));
 let count=0;const fetcher=createBudgetFetch({fetchImpl:async()=>{count++;return response()}});
 for(const [target,options] of [['https://evil.test/v1/decisions',request()],[url,{...request(),body:JSON.stringify({model:'other',input:'x',questions:[]})}],[url,{...request(),body:JSON.stringify({model:'gpt-6-luna',input:[{type:'image'}],questions:[]})}],[url,{...request(),body:' '.repeat(131073)}],[url,{...request(),body:JSON.stringify({model:'gpt-6-luna',input:'x',questions:[],service_tier:'priority'})}]])await assert.rejects(fetcher(target,options),e=>e.code==='budget-stop');
 assert.equal(count,0);
});
test('usage above reservation stops and records known cost; close prevents dispatch',async()=>{
 const fetcher=createBudgetFetch({fetchImpl:async()=>response(usage(10000))});await assert.rejects(fetcher(url,request()),e=>e.code==='spend-unknown');assert.equal(fetcher.state.confirmedUsd,.001);assert.equal(fetcher.state.knownUsageCount,1);
 let calls=0;const closed=createBudgetFetch({fetchImpl:async()=>{calls++;return response()}});closed.close();await assert.rejects(closed(url,request()),e=>e.code==='budget-stop');assert.equal(calls,0);
});
test('callbacks cannot alter the priced request after reservation',async()=>{
 const options=request();let dispatched;
 const fetcher=createBudgetFetch({onUpdate:()=>{options.body=JSON.stringify({model:'other'})},fetchImpl:async(_url,init)=>{dispatched=JSON.parse(init.body);return response()}});
 await fetcher(url,options);assert.equal(dispatched.model,'gpt-6-luna');
});
test('closing from the reservation callback prevents dispatch and refunds it',async()=>{
 let closed=false,calls=0,fetcher;
 fetcher=createBudgetFetch({onUpdate:()=>{if(!closed){closed=true;fetcher.close()}},fetchImpl:async()=>{calls++;return response()}});
 await assert.rejects(fetcher(url,request()),e=>e.code==='budget-stop');assert.equal(calls,0);assert.equal(fetcher.state.committedCeilingUsd,0);
});
