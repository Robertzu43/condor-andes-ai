// Fixed local pricing: global gpt-6-luna Decisions, small text input, $0.10 / million uncached tokens.
const NANOS_PER_TOKEN=100;
const NANOS_PER_USD=1e9;
const ENDPOINT='https://api.openai.com/v1/decisions';
const MODEL='gpt-6-luna';
const stopError=code=>Object.assign(new Error(code==='spend-unknown'?'Provider spend could not be safely bounded':'Decision budget stopped'),{code});
const keysOnly=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
function requestBytes(url,options){
 if(url!==ENDPOINT||options?.method!=='POST'||typeof options.body!=='string')throw stopError('budget-stop');
 const bytes=Buffer.byteLength(options.body,'utf8');
 if(bytes>128*1024)throw stopError('budget-stop');
 let body;try{body=JSON.parse(options.body)}catch{throw stopError('budget-stop')}
 if(!keysOnly(body,['model','input','questions'])||body.model!==MODEL||typeof body.input!=='string'||!Array.isArray(body.questions)||!body.questions.length)throw stopError('budget-stop');
 for(const question of body.questions){
  if(!keysOnly(question,['name','type','instructions','choices'])||typeof question.name!=='string'||question.type!=='choice'||typeof question.instructions!=='string'||!Array.isArray(question.choices)||!question.choices.length)throw stopError('budget-stop');
  for(const choice of question.choices)if(!keysOnly(choice,['value','description'])||typeof choice.value!=='string'||typeof choice.description!=='string')throw stopError('budget-stop');
 }
 return bytes;
}
function validateUsage(usage){
 const integer=n=>Number.isSafeInteger(n)&&n>=0;
 const input=usage?.input_tokens,cached=usage?.input_tokens_details?.cached_tokens,write=usage?.input_tokens_details?.cache_write_tokens,output=usage?.output_tokens,total=usage?.total_tokens;
 if(![input,cached,write,output,total].every(integer)||output!==0||cached+write>input||total!==input+output)throw stopError('spend-unknown');
 return {input_tokens:input,input_tokens_details:{cached_tokens:cached,cache_write_tokens:write},output_tokens:output,total_tokens:total};
}
function rateLimits(headers){
 const result={};
 for(const field of ['limit-requests','limit-tokens','remaining-requests','remaining-tokens','reset-requests','reset-tokens']){
  const name=`x-ratelimit-${field}`,value=headers?.get?.(name);
  if(typeof value==='string'&&value.length<=64&&/^[0-9.msuhd -]+$/.test(value))result[name]=value;
 }
 return result;
}
export function createBudgetFetch({maxUsd=1.25,fetchImpl=fetch,onUpdate,onCall}={}){
 const maxNanos=Math.floor(maxUsd*NANOS_PER_USD);
 if(!Number.isFinite(maxUsd)||maxUsd<=0||maxUsd>1.25||!Number.isSafeInteger(maxNanos)||maxNanos<1||typeof fetchImpl!=='function')throw stopError('budget-stop');
 let confirmed=0,uncertain=0,reserved=0,calls=0,knownUsageCount=0,stopReason=null,latestRateLimits={};
 const state=()=>Object.freeze({maxUsd:maxNanos/NANOS_PER_USD,confirmedUsd:confirmed/NANOS_PER_USD,uncertainUsd:uncertain/NANOS_PER_USD,reservedUsd:reserved/NANOS_PER_USD,committedCeilingUsd:(confirmed+uncertain+reserved)/NANOS_PER_USD,calls,knownUsageCount,stopReason,rateLimits:Object.freeze({...latestRateLimits})});
 const update=()=>{if(onUpdate){const result=onUpdate(state());if(result?.then)throw stopError('budget-stop')}};
 const fetcher=async(url,options)=>{
  if(stopReason)throw stopError(stopReason);
  options={...options};
  const bytes=requestBytes(url,options);
  // shortcut: byte count plus 4096 tokens bounds this small text contract; revalidate before supporting other models/modalities.
  const reservation=(bytes+4096)*NANOS_PER_TOKEN;
  if(confirmed+uncertain+reserved+reservation>maxNanos){stopReason='budget-exhausted';try{update()}catch{stopReason='budget-stop'}throw stopError(stopReason)}
  if(options.signal?.aborted)throw stopError('budget-stop');
  reserved+=reservation;
  try{update()}catch{reserved-=reservation;stopReason='budget-stop';throw stopError(stopReason)}
  if(stopReason||options.signal?.aborted){reserved-=reservation;try{update()}catch{stopReason='budget-stop'}throw stopError(stopReason||'budget-stop')}
  const sequence=++calls;
  let response,usage=null,cost=null,status=null,known=false;
  try{
   response=await fetchImpl(url,{...options,redirect:'error'});status=response.status;latestRateLimits=rateLimits(response.headers);
   if(!response.ok)throw stopError('spend-unknown');
   usage=validateUsage((await response.clone().json()).usage);
   cost=(usage.input_tokens-usage.input_tokens_details.cached_tokens-usage.input_tokens_details.cache_write_tokens)*NANOS_PER_TOKEN;
   if(!Number.isSafeInteger(cost))throw stopError('spend-unknown');
   known=true;confirmed+=cost;knownUsageCount++;
   if(cost>reservation)throw stopError('spend-unknown');
  }catch{
   if(!known)uncertain+=reservation;
   stopReason='spend-unknown';
  }finally{
   reserved-=reservation;
   try{
    update();
    if(onCall){const result=onCall(Object.freeze({sequence,requestBytes:bytes,model:MODEL,status,usage,costUsd:cost===null?null:cost/NANOS_PER_USD,reservationUsd:reservation/NANOS_PER_USD,rateLimits:Object.freeze({...latestRateLimits})}));if(result?.then)throw stopError('budget-stop')}
   }catch{stopReason=stopReason||'budget-stop'}
  }
  if(!known||cost>reservation)throw stopError('spend-unknown');
  if(stopReason==='budget-stop')throw stopError(stopReason);
  return response;
 };
 Object.defineProperty(fetcher,'state',{get:state});
 Object.defineProperty(fetcher,'status',{get:state});
 fetcher.close=()=>{stopReason=stopReason||'budget-stop';update();return state()};
 return fetcher;
}
