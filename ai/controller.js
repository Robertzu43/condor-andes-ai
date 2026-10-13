export const ERROR_MESSAGES=Object.freeze({'local-capacity':'The local server has reached its concurrent request capacity. Wait for pending requests to settle before restarting.',authentication:'OpenAI rejected the API key. Replace the local key and restart the server.',billing:'OpenAI quota or billing blocked this request. Check API credits and billing, then restart.',access:'This key does not have access to the Decisions API or configured model. Check project permissions.', 'rate-limit':'OpenAI rate limited this request. Wait before restarting the run.',network:'The provider could not be reached or timed out. Check the connection and try again.','invalid-answer':'The provider returned a malformed or refused answer. The run has paused.','not-configured':'Configure a local OpenAI API key and restart the server.'});
import {STRATEGIES} from './learning.js';
export const LIMITS = Object.freeze({intervalMs:150,maxInFlight:6,assessments:3,quorum:2,staleMs:500,maxStale:3,durationMs:150000,maxRequests:750});
export function createController({game,decide,onEvent=()=>{},now=()=>performance.now()}) {
  const pending=new Set(),cohorts=new Set(),idleWaiters=[];
  let generation=0,timer,watchdog,nextAllowedAt=-Infinity,pathEpoch=0,cohortSequence=0;
  let state={running:false,runId:null,sequence:0,reason:null};
  const emit=(type,fields={})=>onEvent({type,runId:state.runId,sequence:state.sequence,timestamp:Date.now(),timeMs:now(),...fields});
  const externalPause=s=>s.paused && (!state.warmup || ['hidden','resize'].includes(s.pauseReason));
  function close(cohort,reason) {
    cohort.closed=true;cohort.reason=reason;cohorts.delete(cohort);
    for(const call of pending)if(call.cohort===cohort)call.abort.abort();
  }
  function stop(reason='stopped') {
    if(!state.running)return;
    state.running=false;state.reason=reason;generation++;clearTimeout(timer);clearInterval(watchdog);
    for(const cohort of cohorts)close(cohort,'run-ended');
    game.pause();emit('stop',{reason,gameState:game.snapshot()});
  }
  function budget() {
    if(state.running && state.maxRequests-state.sequence<LIMITS.quorum && !cohorts.size)stop('budget');
  }
  function discardReason(cohort,receivedAt) {
    if(cohort.token!==generation || !state.running)return 'run-ended';
    if(receivedAt-state.startedAt>=state.durationMs)return state.durationReason;
    const snapshot=game.snapshot();
    if(snapshot.state!=='play' || externalPause(snapshot))return 'game-ended';
    if(cohort.epoch!==pathEpoch)return 'path-changed';
    if(cohort.closed)return cohort.reason;
    if(!cohort.warmup && receivedAt-cohort.requestedAt>LIMITS.staleMs)return 'stale';
  }
  function valid(result) {
    return ['flap','wait'].includes(result?.action) && Array.isArray(result.probabilities) && result.probabilities.length===2 &&
      ['flap','wait'].every(choice=>result.probabilities.filter(p=>p?.choice===choice && Number.isFinite(p.probability) && p.probability>=0 && p.probability<=1).length===1) &&
      Math.abs(result.probabilities.reduce((sum,p)=>sum+p.probability,0)-1)<=.01 && Number.isFinite(result.confidence) && result.confidence>=0 && result.confidence<=1;
  }
  function finish(cohort,receivedAt) {
    if(cohort.closed || cohort.token!==generation || !state.running)return;
    const fresh=cohort.answers.filter(answer=>cohort.warmup || receivedAt-answer.requestedAt<=LIMITS.staleMs);
    if(fresh.length>=LIMITS.quorum) {
      const assessments=fresh.slice(0,LIMITS.quorum);
      const probabilities=['flap','wait'].map(choice=>({choice,probability:assessments.reduce((sum,a)=>sum+a.probabilities.find(p=>p?.choice===choice).probability,0)/assessments.length}));
      const action=probabilities[0].probability>probabilities[1].probability?'flap':'wait';
      if(cohort.warmup && !game.resume()){close(cohort,'game-ended');stop('game-over');return}
      state.warmup=false;close(cohort,'cohort-closed');
      if(action==='flap') {game.flap();pathEpoch++;for(const other of cohorts)close(other,'path-changed')}
      const appliedState=game.snapshot(),latencyMs=receivedAt-cohort.requestedAt;
      emit('decision',{runId:cohort.runId,sequence:assessments.at(-1).sequence,cohortId:cohort.id,observation:cohort.observation,warmup:cohort.warmup,action,confidence:Math.max(...probabilities.map(p=>p.probability)),probabilities,model:assessments[0].model,mock:assessments.every(a=>a.mock),assessments,aggregation:'mean-choice-probabilities',requestedAt:cohort.requestedAt,receivedAt,latencyMs,outcome:'applied',appliedFrame:appliedState.frame,appliedState});
      state.previousAction={action,frame:appliedState.frame};state.latencyMs=cohort.warmup?250:latencyMs;state.staleCount=0;
    } else if(cohort.settled===cohort.size) {
      close(cohort,'stale');state.staleCount++;
      if(state.staleCount>=LIMITS.maxStale)stop('stale-responses');
    }
    budget();
  }
  async function assess(call) {
    const {cohort,sequence,assessment,abort,payload}=call;
    let result,error,reason,receivedAt;
    try {result=await decide(payload,{signal:abort.signal})}catch(e){error=e}
    receivedAt=now();reason=discardReason(cohort,receivedAt);const answerValid=valid(result);
    if(!reason && (error || !answerValid)) {
      reason='api-error';const code=Object.hasOwn(ERROR_MESSAGES,error?.code)?error.code:'invalid-answer';
      emit('error',{observation:cohort.observation,code,message:ERROR_MESSAGES[code]});stop('api-error');
    }
    const answer={sequence,assessment,action:result?.action,confidence:result?.confidence,probabilities:result?.probabilities,model:result?.model,mock:result?.mock,requestedAt:cohort.requestedAt,receivedAt,latencyMs:receivedAt-cohort.requestedAt};
    onEvent({type:'assessment',runId:cohort.runId,cohortId:cohort.id,timestamp:Date.now(),timeMs:receivedAt,observation:cohort.observation,warmup:cohort.warmup,...answer,valid:answerValid,outcome:reason?'discarded':'included',reason});
    pending.delete(call);cohort.settled++;
    if(!reason)cohort.answers.push(answer);
    if(cohort.token===generation && state.running) {
      if(reason===state.durationReason)stop(reason);
      else if(reason==='game-ended')stop('game-over');
      else finish(cohort,receivedAt);
    }
    if(!pending.size)for(const resolve of idleWaiters.splice(0))resolve();
  }
  function tick(token) {
    if(!state.running || token!==generation)return;
    const observation=game.snapshot();
    if(observation.state!=='play' || externalPause(observation))return stop(observation.state!=='play'?'game-over':'game-paused');
    if(now()-state.startedAt>=state.durationMs)return stop(state.durationReason);
    budget();if(!state.running)return;
    const size=Math.min(LIMITS.assessments,LIMITS.maxInFlight-pending.size,state.maxRequests-state.sequence);
    if(now()>=nextAllowedAt && size>=LIMITS.quorum && (!state.warmup || !cohorts.size)) {
      const cohort={id:++cohortSequence,token,runId:state.runId,epoch:pathEpoch,observation:{...observation,runId:state.runId,timestamp:Date.now()},requestedAt:now(),warmup:state.warmup,size,settled:0,answers:[],closed:false};
      cohorts.add(cohort);nextAllowedAt=cohort.requestedAt+LIMITS.intervalMs;
      const previousAction=state.previousAction,latencyMs=state.latencyMs;
      for(const assessment of ['immediate','approach','recovery'].slice(0,size)) {
        const sequence=++state.sequence,payload={observation:{...cohort.observation,sequence},assessment,previousAction,latencyMs,...(state.strategyId?{strategyId:state.strategyId}:{})};
        const call={cohort,sequence,assessment,payload,abort:new AbortController()};pending.add(call);
        emit('request',{cohortId:cohort.id,assessment,observation:payload.observation,requestedAt:cohort.requestedAt,warmup:cohort.warmup});assess(call);
      }
    }
    timer=setTimeout(()=>tick(token),10);
  }
  function start(options={}) {
    const {seed,strategyId,durationMs=LIMITS.durationMs,maxRequests=LIMITS.maxRequests}=options;
    if(!Number.isFinite(durationMs)||durationMs<=0||durationMs>LIMITS.durationMs||!Number.isSafeInteger(maxRequests)||maxRequests<LIMITS.quorum||maxRequests>LIMITS.maxRequests||(seed!==undefined&&(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff))||(strategyId!==undefined&&!STRATEGIES.includes(strategyId)))throw Error('Invalid start bounds or strategy');
    stop('restart');game.start(seed===undefined?undefined:{seed});const token=++generation;pathEpoch=0;nextAllowedAt=-Infinity;
    state={durationMs,maxRequests,strategyId,durationReason:Object.hasOwn(options,'durationMs')?'duration':'limit',running:true,runId:globalThis.crypto.randomUUID(),sequence:0,reason:null,startedAt:now(),previousAction:null,latencyMs:0,staleCount:0,warmup:true};
    game.pause();emit('start',{warmup:true,strategyId});watchdog=setInterval(()=>{if(now()-state.startedAt>=state.durationMs)stop(state.durationReason);else {const s=game.snapshot();if(externalPause(s)||s.state!=='play')stop(s.state!=='play'?'game-over':'game-paused')}},25);
    tick(token);return state.runId;
  }
  return {start,stop,waitForIdle:()=>pending.size?new Promise(resolve=>idleWaiters.push(resolve)):Promise.resolve(),get state(){return {...state,inFlight:pending.size}}};
}
