import {STRATEGIES,scoreEpisode} from '../ai/learning.js';
import {createDecider,MODEL} from '../ai/decisions.mjs';
import {createController} from '../ai/controller.js';
import {createBudgetFetch} from './decision-budget.mjs';
import {createSimulation,runSimulationFlight} from './condor-simulation.mjs';
import {mkdirSync,existsSync,writeFileSync,renameSync,appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
export const CANDIDATES=STRATEGIES.flatMap(strategyId=>[9,12,18].map(stepFrames=>({id:`${strategyId}@${stepFrames}`,strategyId,stepFrames})));
export function rankTraining(records){
 const ids=new Set(),groups=new Map(CANDIDATES.map(c=>[c.id,new Map()]));
 for(const r of records){if(r.phase!=='training'||!groups.has(r.candidateId)||ids.has(r.episodeId)||r.reward===null||!Number.isFinite(r.reward)||scoreEpisode(r)===null||Math.abs(scoreEpisode(r)-r.reward)>1e-8||!['game-over','duration'].includes(r.reason))continue;ids.add(r.episodeId);if(!groups.get(r.candidateId).has(r.courseSeed))groups.get(r.candidateId).set(r.courseSeed,r)}
 const seeds=[...groups.values()][0].keys();const shared=[...seeds].filter(seed=>[...groups.values()].every(group=>group.has(seed))).sort((a,b)=>a-b);
 if(!shared.length)return [];
 return CANDIDATES.map(candidate=>{const rows=shared.map(seed=>groups.get(candidate.id).get(seed));return {candidate,n:rows.length,seeds:shared,meanReward:rows.reduce((s,r)=>s+r.reward,0)/rows.length,meanObstacles:rows.reduce((s,r)=>s+r.obstaclesPassed,0)/rows.length,meanSeconds:rows.reduce((s,r)=>s+r.activeFlightSeconds,0)/rows.length}}).sort((a,b)=>b.meanReward-a.meanReward||a.candidate.id.localeCompare(b.candidate.id));
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function runSearch({output,mock=false,targetUsd=1,maxUsd=1.25,parallel=4,maxTrainingFlights=2000,maxEvaluationPairs=500,maxCalls=25000,maxWallMs=2700000,fetchImpl=fetch}={}){
 if(typeof output!=='string'||!output||targetUsd<0||!Number.isFinite(targetUsd)||targetUsd>maxUsd||maxUsd<=0||maxUsd>1.25||!Number.isInteger(parallel)||parallel<1||parallel>4||!Number.isInteger(maxTrainingFlights)||maxTrainingFlights<9||maxTrainingFlights>9000||!Number.isInteger(maxEvaluationPairs)||maxEvaluationPairs<6||maxEvaluationPairs>500||!Number.isInteger(maxCalls)||maxCalls<3||maxCalls>25000||!Number.isFinite(maxWallMs)||maxWallMs<=0||maxWallMs>2700000)throw Error('Invalid bounded search options');
 if(!mock&&!process.env.OPENAI_API_KEY)throw Error('Configure the existing local API key before running');
 output=resolve(output);if(existsSync(output))throw Error('Search output already exists; refusing to reset an existing spend ledger');mkdirSync(output,{recursive:true});
 const startedAt=Date.now(),deadlineAt=startedAt+maxWallMs,experimentId=randomUUID(),context={model:MODEL,mock},records=[];
 const abort=new AbortController();let fatal=null,stage='training',nextNetworkAt=0,ranked=[],selected=null,liveAt=0,running=true,flightInvocations=0;const birds=new Map();let publishLive=()=>{};
 const persist=(name,data)=>{const path=resolve(output,name);writeFileSync(path+'.tmp',JSON.stringify(data,null,2));renameSync(path+'.tmp',path)};
 const guard=createBudgetFetch({maxUsd,onUpdate:state=>{persist('budget.json',{experimentId,approvedMaxUsd:maxUsd,targetUsd,pricingSource:'https://developers.openai.com/api/docs/guides/decisions#pricing-and-availability',...state});publishLive()},onCall:call=>appendFileSync(resolve(output,'api-usage.jsonl'),JSON.stringify(call)+'\n'),fetchImpl:async(url,options)=>{
  const dispatchAt=Math.max(performance.now(),nextNetworkAt);nextNetworkAt=dispatchAt+50;await sleep(Math.max(0,dispatchAt-performance.now()));return fetchImpl(url,options);
 }});
 persist('budget.json',{experimentId,approvedMaxUsd:maxUsd,targetUsd,...guard.state});
 const provider=createDecider({apiKey:process.env.OPENAI_API_KEY,mock,fetchImpl:guard});
 const trainLimit=Math.min(.75,maxUsd*.6),evaluationLimit=Math.min(1.15,maxUsd*.92);
 const remainingRequests=()=>{const n=Number(guard.state.rateLimits['x-ratelimit-remaining-requests']);return Number.isFinite(n)&&n>=0?n:Infinity};
 const trainingAllowed=()=>guard.state.committedCeilingUsd<trainLimit&&remainingRequests()>1500;
 const stop=reason=>{fatal??=reason;abort.abort()};
 const onSignal=()=>stop('cancelled');process.once('SIGINT',onSignal);process.once('SIGTERM',onSignal);
 const deadline=setTimeout(()=>stop('wall-limit'),maxWallMs);
 const decide=async(payload,options={})=>{
  if(fatal||Date.now()>=deadlineAt)throw Object.assign(Error('Search stopped'),{code:'budget-stop'});
  if(!mock&&((stage==='training'&&remainingRequests()<=1500)||(stage==='evaluation'&&remainingRequests()<=350)||guard.state.calls>=maxCalls||guard.state.committedCeilingUsd>=(stage==='training'?trainLimit:stage==='evaluation'?evaluationLimit:maxUsd)))throw Object.assign(Error('Phase allowance reached'),{code:'phase-budget'});
  try{return await provider(payload,options)}catch(error){if(guard.state.stopReason){const code=guard.state.stopReason;stop(code);throw Object.assign(Error('Spend guard stopped'),{code})}stop(error.code||'api-error');throw error}
 };
 publishLive=(force=false)=>{if(!force&&performance.now()-liveAt<200)return;liveAt=performance.now();persist('live.json',{experimentId,mock,phase:stage,running,startedAt:new Date(startedAt).toISOString(),updatedAt:new Date().toISOString(),spend:guard.state,approvedMaxUsd:maxUsd,targetUsd,completedFlights:records.length,flightInvocations,validFlights:records.filter(r=>r.reward!==null).length,interruptedFlights:records.filter(r=>r.reward===null).length,candidates:CANDIDATES,trainingRanking:ranked,selected,birds:[...birds.values()],recent:records.slice(-8),stopReason:fatal||guard.state.stopReason})};publishLive(true);
 const compact=r=>{const {events,gameState,...rest}=r;return {...rest,eventsOmitted:true}};
 const checkpoint=()=>persist('results.json',{schemaVersion:1,experimentId,model:MODEL,mock,startedAt:new Date(startedAt).toISOString(),updatedAt:new Date().toISOString(),simulation:'Actual game code; world frozen during API calls; all-settled consensus; fixed real frames between actions',candidates:CANDIDATES,rawTraceFile:'episodes.jsonl',spend:guard.state,targetUsd,selected,trainingRanking:ranked,stopReason:fatal,records});
 const save=r=>{appendFileSync(resolve(output,'episodes.jsonl'),JSON.stringify(r)+'\n');records.push(compact(r));ranked=rankTraining(records);checkpoint();publishLive(true);if(records.length%10===0)console.log(JSON.stringify({phase:stage,flights:records.length,calls:guard.state.calls,estimatedUsd:guard.state.confirmedUsd,ceilingUsd:guard.state.committedCeilingUsd,bestReward:Math.max(0,...records.filter(r=>r.reward!==null).map(r=>r.reward)),stop:fatal}))};
 const flight=async(candidate,seed,phase,slot)=>{flightInvocations++;birds.set(slot,{slot,candidateId:candidate.id,strategyId:candidate.strategyId,stepFrames:candidate.stepFrames,seed,phase,status:'Preparing'});publishLive(true);const onEvent=e=>{const bird=birds.get(slot);Object.assign(bird,{flightId:e.runId,status:e.type==='stop'?e.reason:e.type==='decision'?'Flying':'Assessing',snapshot:e.gameState||e.appliedState||e.observation||bird.snapshot,...(e.type==='decision'?{lastAction:e.action,probabilities:e.probabilities,cohortId:e.cohortId}:{})});try{publishLive(e.type==='stop')}catch{stop('dashboard-write-error')}};const record=await runSimulationFlight({seed,strategyId:candidate.strategyId,stepFrames:candidate.stepFrames,decide,maxFrames:900,maxRequests:300,experimentId,phase,context,onEvent,signal:abort.signal,deadlineAt:Math.min(deadlineAt,Date.now()+180000)});save({...record,candidateId:candidate.id});return record};
 try{
  let task=0;
  const workers=Array.from({length:parallel},async(_,slot)=>{while(!fatal&&task<maxTrainingFlights&&(mock||trainingAllowed())){
   const index=task++,round=Math.floor(index/9),candidate=CANDIDATES[(index%9+round)%9];await flight(candidate,101+round,'training',slot);
  }});await Promise.allSettled(workers.map(worker=>worker.catch(()=>stop('run-error'))));ranked=rankTraining(records);selected=ranked[0]?.candidate||null;persist('selected.json',{experimentId,mock,selected,trainingRanking:ranked,frozenAt:new Date().toISOString(),selectionRule:'Highest mean training reward over course seeds completed by all nine candidates. Evaluation cannot alter selection.'});checkpoint();
  if(selected&&!fatal){stage='evaluation';const baseline=CANDIDATES.find(c=>c.strategyId==='balanced-v1'&&c.stepFrames===12);let pair=0;
   await Promise.allSettled(Array.from({length:Math.min(parallel,2)},async(_,slot)=>{try{while(!fatal&&pair<maxEvaluationPairs){
    const index=pair++;if(index>=6&&(mock||guard.state.confirmedUsd>=targetUsd))break;if(!mock&&(guard.state.committedCeilingUsd>=evaluationLimit||remainingRequests()<=350))break;
    const baselineTask={candidate:baseline,phase:'baseline'},evaluationTask={candidate:selected,phase:'evaluation'},order=index%2?[evaluationTask,baselineTask]:[baselineTask,evaluationTask];for(const {candidate,phase} of order){if(fatal)break;await flight(candidate,10001+index,phase,slot)}
   }}catch{stop('run-error')}}));
  }
  // This sanity check transfers guidance only: simulation cadence/all-three voting do not equal live quorum timing.
  if(selected&&!mock&&!fatal&&guard.state.committedCeilingUsd<maxUsd-.025){stage='normal-speed-check';publishLive(true);
   for(const strategyId of [...new Set(['balanced-v1',selected.strategyId])]){
    if(fatal)break;flightInvocations++;const sim=createSimulation({seed:200001}),events=[];let finished;const done=new Promise(r=>finished=r),started=performance.now();
    const controller=createController({game:sim.game,decide:payload=>decide(payload),onEvent:e=>{events.push(e);birds.set(0,{slot:0,candidateId:`${strategyId}@live-v5`,strategyId,seed:200001,phase:stage,status:e.type==='stop'?e.reason:'Flying',lastAction:e.action,snapshot:e.gameState||e.appliedState||e.observation||birds.get(0)?.snapshot});try{publishLive()}catch{stop('dashboard-write-error')}if(e.type==='stop')finished(e)}});
    let last=performance.now(),acc=0;const timer=setInterval(()=>{const now=performance.now();if(sim.snapshot().paused){acc=0;last=now;return}acc+=Math.min(100,now-last);last=now;const frames=Math.floor(acc/(1000/60));acc-=frames*1000/60;if(frames){sim.advance(frames);sim.game.resume()}},16);
    const cancelled=()=>controller.stop('cancelled');abort.signal.addEventListener('abort',cancelled,{once:true});
    try{controller.start({seed:200001,strategyId,durationMs:15000,maxRequests:300});const end=await done;await controller.waitForIdle();const s=sim.snapshot();const record={model:MODEL,mock:false,episodeId:end.runId,experimentId,phase:'normal-speed-check',strategyId,candidateId:`${strategyId}@live-v5`,courseSeed:200001,configVersion:'flight-guidance-v5/normal-speed-check',dimensions:{width:384,height:216},obstaclesPassed:s.obstaclesPassed,coinsCollected:s.coinsCollected,activeFlightSeconds:s.activeFlightSeconds,requests:end.sequence,reason:end.reason,cause:s.deathCause,events,wallSeconds:(performance.now()-started)/1000};save({...record,reward:scoreEpisode(record)})}finally{clearInterval(timer);abort.signal.removeEventListener('abort',cancelled);controller.stop()}
   }
  }
 }finally{clearTimeout(deadline);process.removeListener('SIGINT',onSignal);process.removeListener('SIGTERM',onSignal);ranked=rankTraining(records);running=false;checkpoint();publishLive(true);}
 const evaluation=records.filter(r=>['baseline','evaluation'].includes(r.phase)&&r.reward!==null),paired=[];
 for(const seed of new Set(evaluation.map(r=>r.courseSeed))){const baseline=evaluation.find(r=>r.courseSeed===seed&&r.phase==='baseline'),learned=evaluation.find(r=>r.courseSeed===seed&&r.phase==='evaluation');if(baseline&&learned)paired.push({seed,baselineReward:baseline.reward,selectedReward:learned.reward,delta:learned.reward-baseline.reward})}
 const summary={experimentId,mock,flights:records.length,validFlights:records.filter(r=>r.reward!==null).length,interruptedFlights:records.filter(r=>r.reward===null).length,selected,completeTrainingCourses:ranked[0]?.n||0,heldOutPairs:paired,meanHeldOutDelta:paired.length?paired.reduce((s,p)=>s+p.delta,0)/paired.length:null,spend:guard.state,targetReached:!mock&&guard.state.confirmedUsd>=targetUsd,stopReason:fatal||guard.state.stopReason||'complete',normalSpeedChecks:records.filter(r=>r.phase==='normal-speed-check')};persist('summary.json',summary);console.log(JSON.stringify(summary));return summary;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const mock=process.argv.includes('--mock'),output=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9);
 runSearch({output,mock,...(mock?{targetUsd:0,maxTrainingFlights:18,maxEvaluationPairs:6}: {})}).catch(error=>{console.error(error.code||error.message);process.exitCode=1});
}
