export const ERROR_MESSAGES=Object.freeze({authentication:'OpenAI rejected the API key. Replace the local key and restart the server.',billing:'OpenAI quota or billing blocked this request. Check API credits and billing, then restart.',access:'This key does not have access to the Decisions API or configured model. Check project permissions.', 'rate-limit':'OpenAI rate limited this request. Wait before restarting the run.',network:'The provider could not be reached or timed out. Check the connection and try again.','invalid-answer':'The provider returned a malformed or refused answer. The run has paused.','not-configured':'Configure a local OpenAI API key and restart the server.'});
import {STRATEGIES} from './learning.js';
export const LIMITS = Object.freeze({intervalMs:200,staleMs:500,maxStale:3,durationMs:150000,maxRequests:750});
export function createController({game,decide,onEvent=()=>{},now=()=>performance.now()}) {
  let idleWaiters=[];
  let generation=0,timer,watchdog,abort,busy=false,nextAllowedAt=-Infinity;
  let state={running:false,runId:null,sequence:0,reason:null};
  const emit = (type, fields={})=>onEvent({type,runId:state.runId,sequence:state.sequence,timestamp:Date.now(),timeMs:now(),...fields});
  function stop(reason='stopped') {
    if (!state.running) return;
    state.running=false;state.reason=reason;generation++;clearTimeout(timer);clearInterval(watchdog);abort?.abort();game.pause();emit('stop',{reason});
  }
  const isExternalPause = s => s.paused && (!state.warmup || ['hidden','resize'].includes(s.pauseReason));
  async function tick(token,runId) {
    if (!state.running || generation!==token) return;
    if (busy || now()<nextAllowedAt) { timer=setTimeout(()=>tick(token,runId),10); return; }
    const observation=game.snapshot();
    if (observation.state!=='play' || isExternalPause(observation)) return stop(observation.paused?'game-paused':'game-over');
    if(now()-state.startedAt>=state.durationMs)return stop(state.durationReason);
    if(state.sequence>=state.maxRequests)return stop('budget');
    const sequence=++state.sequence, requestedAt=now(), warmup=state.warmup;
    Object.assign(observation,{runId,sequence,timestamp:Date.now()});
    busy=true;
    let cooldownMs=LIMITS.intervalMs;
    abort=new AbortController();emit('request',{observation,requestedAt,warmup});
    try {
      const result=await decide({observation,previousAction:state.previousAction,latencyMs:state.latencyMs,...(state.strategyId?{strategyId:state.strategyId}:{})},{signal:abort.signal});
      const receivedAt=now(),latencyMs=receivedAt-requestedAt;
      let outcome='applied',reason;
      if (generation!==token || !state.running) {outcome='discarded';reason='run-ended'}
      else if (receivedAt-state.startedAt>=state.durationMs) {outcome='discarded';reason=state.durationReason}
      else if (game.snapshot().state!=='play' || isExternalPause(game.snapshot())) {outcome='discarded';reason='game-ended'}
      else if (!warmup && latencyMs>LIMITS.staleMs) {outcome='discarded';reason='stale'}
      if (!['flap','wait'].includes(result?.action) || result.probabilities?.length !== 2 || !['flap','wait'].every(c=>result.probabilities.filter(p=>p.choice===c && Number.isFinite(p.probability) && p.probability>=0 && p.probability<=1).length===1) || Math.abs(result.probabilities.reduce((sum,p)=>sum+p.probability,0)-1)>.01 || !Number.isFinite(result.confidence) || result.confidence<0 || result.confidence>1) throw Error('Malformed decision');
      if (generation===token && state.running && Number.isFinite(result.cooldownMs) && result.cooldownMs>=0 && result.cooldownMs<=LIMITS.intervalMs) cooldownMs=result.cooldownMs;
      if (outcome==='applied' && warmup) {
        if (!game.resume()) { outcome='discarded'; reason='game-ended'; }
        else state.warmup=false;
      }
      if (outcome==='applied' && result.action==='flap') game.flap();
      onEvent({type:'decision',runId,sequence,timestamp:Date.now(),timeMs:receivedAt,observation,warmup,...result,requestedAt,receivedAt,latencyMs,outcome,reason,appliedFrame:outcome==='applied'?game.snapshot().frame:null});
      if (generation!==token || !state.running) return;
      state.latencyMs=warmup?250:latencyMs;
      state.staleCount=reason==='stale'?state.staleCount+1:0;
      if (reason===state.durationReason) return stop(reason);
      if (reason==='game-ended') return stop('game-over');
      if (state.staleCount>=LIMITS.maxStale) return stop('stale-responses');
      if (outcome==='applied') state.previousAction={action:result.action,frame:game.snapshot().frame};
    } catch(e) {
      if (generation!==token || !state.running) return;
      emit('error',{observation,code:Object.hasOwn(ERROR_MESSAGES,e.code)?e.code:'invalid-answer',message:ERROR_MESSAGES[e.code]||'Decision request failed or malformed answer'});stop('api-error');return;
    }
    finally { busy=false;for(const resolve of idleWaiters.splice(0))resolve(); nextAllowedAt=now()+cooldownMs; }
    if (state.running && generation===token) timer=setTimeout(()=>tick(token,runId),cooldownMs);
  }
  function start(options={}) {
    const {seed,strategyId,durationMs=LIMITS.durationMs,maxRequests=LIMITS.maxRequests}=options;
    if(!Number.isFinite(durationMs)||durationMs<=0||durationMs>LIMITS.durationMs||!Number.isSafeInteger(maxRequests)||maxRequests<1||maxRequests>LIMITS.maxRequests||(seed!==undefined&&(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff))||(strategyId!==undefined&&!STRATEGIES.includes(strategyId)))throw Error('Invalid start bounds or strategy');
    stop('restart');game.start(seed===undefined?undefined:{seed});const token=++generation;
    state={durationMs,maxRequests,strategyId,durationReason:Object.hasOwn(options,'durationMs')?'duration':'limit',running:true,runId:globalThis.crypto.randomUUID(),sequence:0,reason:null,startedAt:now(),previousAction:null,latencyMs:0,staleCount:0,warmup:true};
    game.pause();emit('start',{warmup:true,strategyId});watchdog=setInterval(()=>{if(now()-state.startedAt>=state.durationMs)stop(state.durationReason);else {const s=game.snapshot();if(isExternalPause(s)||s.state!=='play')stop(s.paused?'game-paused':'game-over')}},25);
    tick(token,state.runId);return state.runId;
  }
  return {start,stop,waitForIdle:()=>busy?new Promise(resolve=>idleWaiters.push(resolve)):Promise.resolve(),get state(){return {...state}}};
}
