export const LIMITS = Object.freeze({intervalMs:200,staleMs:250,maxStale:3,durationMs:150000,maxRequests:750});
export function createController({game,decide,onEvent=()=>{},now=()=>performance.now()}) {
  let generation=0,timer,watchdog,abort,busy=false,nextAllowedAt=-Infinity;
  let state={running:false,runId:null,sequence:0,reason:null};
  const emit = (type, fields={})=>onEvent({type,runId:state.runId,sequence:state.sequence,timestamp:Date.now(),timeMs:now(),...fields});
  function stop(reason='stopped') {
    if (!state.running) return;
    state.running=false;state.reason=reason;generation++;clearTimeout(timer);clearInterval(watchdog);abort?.abort();game.pause();emit('stop',{reason});
  }
  async function tick(token,runId) {
    if (!state.running || generation!==token) return;
    if (busy || now()<nextAllowedAt) { timer=setTimeout(()=>tick(token,runId),10); return; }
    const observation=game.snapshot();
    if (observation.state!=='play' || observation.paused) return stop(observation.paused?'game-paused':'game-over');
    if (now()-state.startedAt>=LIMITS.durationMs || state.sequence>=LIMITS.maxRequests) return stop('limit');
    const sequence=++state.sequence, requestedAt=now();
    Object.assign(observation,{runId,sequence,timestamp:Date.now()});
    busy=true;
    abort=new AbortController();emit('request',{observation,requestedAt});
    try {
      const result=await decide({observation,previousAction:state.previousAction,latencyMs:state.latencyMs},{signal:abort.signal});
      const receivedAt=now(),latencyMs=receivedAt-requestedAt;
      let outcome='applied',reason;
      if (generation!==token || !state.running) {outcome='discarded';reason='run-ended'}
      else if (receivedAt-state.startedAt>=LIMITS.durationMs) {outcome='discarded';reason='limit'}
      else if (game.snapshot().state!=='play' || game.snapshot().paused) {outcome='discarded';reason='game-ended'}
      else if (latencyMs>LIMITS.staleMs) {outcome='discarded';reason='stale'}
      if (!['flap','wait'].includes(result?.action) || result.probabilities?.length !== 2 || !['flap','wait'].every(c=>result.probabilities.filter(p=>p.choice===c && Number.isFinite(p.probability) && p.probability>=0 && p.probability<=1).length===1) || Math.abs(result.probabilities.reduce((sum,p)=>sum+p.probability,0)-1)>.01 || !Number.isFinite(result.confidence) || result.confidence<0 || result.confidence>1) throw Error('Malformed decision');
      if (outcome==='applied' && result.action==='flap') game.flap();
      onEvent({type:'decision',runId,sequence,timestamp:Date.now(),timeMs:receivedAt,observation,...result,requestedAt,receivedAt,latencyMs,outcome,reason,appliedFrame:outcome==='applied'?game.snapshot().frame:null});
      if (generation!==token || !state.running) return;
      state.latencyMs=latencyMs;
      state.staleCount=reason==='stale'?state.staleCount+1:0;
      if (reason==='limit') return stop('limit');
      if (reason==='game-ended') return stop('game-over');
      if (state.staleCount>=LIMITS.maxStale) return stop('stale-responses');
      if (outcome==='applied') state.previousAction={action:result.action,frame:game.snapshot().frame};
    } catch {
      if (generation!==token || !state.running) return;
      emit('error',{observation,message:'Decision request failed or malformed answer'});stop('api-error');return;
    }
    finally { busy=false; nextAllowedAt=now()+LIMITS.intervalMs; }
    if (state.running && generation===token) timer=setTimeout(()=>tick(token,runId),LIMITS.intervalMs);
  }
  function start() {
    stop('restart');game.start();const token=++generation;
    state={running:true,runId:globalThis.crypto.randomUUID(),sequence:0,reason:null,startedAt:now(),previousAction:null,latencyMs:0,staleCount:0};
    emit('start');watchdog=setInterval(()=>{if(now()-state.startedAt>=LIMITS.durationMs)stop('limit');else {const s=game.snapshot();if(s.paused||s.state!=='play')stop(s.paused?'game-paused':'game-over')}},25);
    tick(token,state.runId);return state.runId;
  }
  return {start,stop,get state(){return {...state}}};
}
