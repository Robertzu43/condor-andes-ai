import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {CONFIG_VERSION,STRATEGIES,scoreEpisode} from '../ai/learning.js';

const source=readFileSync(new URL('../game.js',import.meta.url),'utf8').replace(/^import .*\n/,'');
const step=new vm.Script('step()');
const roles=['immediate','approach','recovery'];
const budgetCodes=new Set(['budget','spend-cap','budget-exhausted','budget-stop','spend-unknown','phase-budget']);
const plain=value=>JSON.parse(JSON.stringify(value));

export function createSimulation({seed}={}) {
 const canvas={style:{},getContext:()=>({})};
 const sandbox={window:{},location:{hostname:'127.0.0.1',hash:'#ai'},document:{hidden:false,getElementById:()=>canvas,documentElement:{}},innerWidth:768,innerHeight:432,matchMedia:()=>({matches:false}),getComputedStyle:()=>({getPropertyValue:()=>''}),localStorage:{getItem:()=>null,setItem:()=>{}},addEventListener:()=>{},performance:{now:()=>0},requestAnimationFrame:()=>{},navigator:{},fetch:()=>{throw Error('Headless simulation cannot submit scores')},GLIDE:[],FLAP:[],COIN:[],PAL:{},OUTLINE:{},THEME:{},drawSprite:()=>{}};
 const realm=vm.createContext(sandbox);vm.runInContext(source,realm);
 const game=sandbox.window.condorAI;
 game.start(seed===undefined?undefined:{seed});game.pause();
 const snapshot=()=>plain(game.snapshot());
 return {game,bridge:game,snapshot,advance(frames){
  if(!Number.isSafeInteger(frames)||frames<0)throw Error('Invalid frame count');
  game.resume();
  for(let i=0;i<frames && game.snapshot().state==='play';i++)step.runInContext(realm);
  game.pause();return snapshot();
 }};
}

function valid(result,context) {
 return result?.model===context.model && result?.mock===context.mock && ['flap','wait'].includes(result?.action) && Number.isFinite(result.confidence) && result.confidence>=0 && result.confidence<=1 &&
  Array.isArray(result.probabilities) && result.probabilities.length===2 &&
  ['flap','wait'].every(choice=>result.probabilities.filter(p=>p?.choice===choice && Number.isFinite(p.probability) && p.probability>=0 && p.probability<=1).length===1) &&
  Math.abs(result.probabilities.reduce((sum,p)=>sum+p.probability,0)-1)<=.01;
}

export async function runSimulationFlight({seed,strategyId,stepFrames=12,decide,maxFrames=900,maxRequests=300,experimentId,phase='training',context,onEvent=()=>{},signal,deadlineAt=Date.now()+60000}) {
 if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff||!STRATEGIES.includes(strategyId)||!Number.isSafeInteger(stepFrames)||stepFrames<1||stepFrames>30||!Number.isSafeInteger(maxFrames)||maxFrames<1||maxFrames>900||!Number.isSafeInteger(maxRequests)||maxRequests<2||maxRequests>300||typeof decide!=='function'||typeof experimentId!=='string'||!experimentId||!['training','evaluation','baseline'].includes(phase)||typeof context?.model!=='string'||!context.model||typeof context.mock!=='boolean'||!Number.isFinite(deadlineAt))throw Error('Invalid simulation flight options');
 const simulation=createSimulation({seed}),game=simulation.game,runId=randomUUID(),events=[];
 const startedAt=performance.now();let requests=0,cohorts=0,latencyMs=0,previousAction=null,reason;
 const emit=(type,fields={})=>{const event={type,runId,timestamp:Date.now(),timeMs:performance.now(),sequence:requests,...fields};events.push(event);onEvent(event);return event};
 const interrupted=()=>signal?.aborted?'cancel':Date.now()>=deadlineAt?'wall-limit':null;
 emit('start',{strategyId,warmup:true,simulation:{stepFrames}});
 while(!reason){
  reason=interrupted();if(reason)break;
  const state=simulation.snapshot();
  if(state.state!=='play'){reason='game-over';break}
  if(state.frame>=maxFrames){reason='duration';break}
  if(maxRequests-requests<2){reason='budget';break}
  const cohortId=++cohorts,requestedAt=performance.now(),warmup=previousAction===null;
  const observation={...state,runId,timestamp:Date.now()},size=Math.min(3,maxRequests-requests);
  // All calls settle before a decision, so paid third assessments are neither lost nor cancelled at quorum.
  const results=await Promise.allSettled(roles.slice(0,size).map(async assessment=>{
   const sequence=++requests,payload={observation:{...plain(observation),sequence},assessment,previousAction,latencyMs,strategyId,simulation:{stepFrames}};
   emit('request',{sequence,cohortId,assessment,observation:payload.observation,requestedAt,warmup});
   try {const result=await decide(payload,{signal});return {result,sequence,assessment,receivedAt:performance.now()}}
   catch(error){throw {error,sequence,assessment,receivedAt:performance.now()}}
  }));
  const receivedAt=performance.now();latencyMs=receivedAt-requestedAt;
  const stop=interrupted();const errors=results.filter(r=>r.status==='rejected');
  reason=stop || (errors.length?(errors.some(r=>budgetCodes.has(r.reason.error?.code))?'budget':'api-error'):null);
  const assessments=[];
  for(const outcome of results){
   const item=outcome.status==='fulfilled'?outcome.value:outcome.reason,result=item.result,answerValid=valid(result,context);
   const answer={sequence:item.sequence,assessment:item.assessment,action:result?.action,confidence:result?.confidence,probabilities:result?.probabilities,model:result?.model,mock:result?.mock,requestedAt,receivedAt:item.receivedAt,latencyMs:item.receivedAt-requestedAt};
   emit('assessment',{cohortId,observation,warmup,...answer,valid:answerValid,outcome:!reason && answerValid?'included':'discarded',reason:reason || (!answerValid?'invalid-answer':null),...(item.error?.code?{code:item.error.code}:{})});
   if(answerValid)assessments.push(answer);
  }
  if(reason)break;
  if(assessments.length<2){reason='api-error';break}
  const probabilities=['flap','wait'].map(choice=>({choice,probability:assessments.reduce((sum,a)=>sum+a.probabilities.find(p=>p.choice===choice).probability/a.probabilities.reduce((total,p)=>total+p.probability,0),0)/assessments.length}));
  const action=probabilities[0].probability>probabilities[1].probability?'flap':'wait';
  reason=interrupted();if(reason)break;
  game.resume();if(action==='flap')game.flap();
  const appliedState=simulation.snapshot();game.pause();
  emit('decision',{cohortId,observation,warmup,action,confidence:Math.max(...probabilities.map(p=>p.probability)),probabilities,model:context.model,mock:context.mock,assessments,aggregation:'mean-choice-probabilities',quorumPolicy:'all-settled-valid-assessments',requestedAt,receivedAt,latencyMs,outcome:'applied',appliedFrame:appliedState.frame,appliedState});
  previousAction={action,frame:appliedState.frame};simulation.advance(Math.min(stepFrames,maxFrames-appliedState.frame));
 }
 game.pause();const gameState=simulation.snapshot();emit('stop',{reason,gameState});
 const latencies=events.filter(e=>e.type==='assessment').map(e=>e.latencyMs);
 const record={episodeId:runId,experimentId,phase,strategyId,courseSeed:seed,model:context.model,mock:context.mock,configVersion:`${CONFIG_VERSION}/decision-step-v1/${stepFrames}`,dimensions:{width:gameState.playfield.width,height:gameState.playfield.height},obstaclesPassed:gameState.obstaclesPassed,coinsCollected:gameState.coinsCollected,activeFlightSeconds:gameState.activeFlightSeconds,requests,meanLatencyMs:latencies.length?latencies.reduce((sum,n)=>sum+n,0)/latencies.length:0,reason,events,cohorts,apiRequestCount:requests,wallSeconds:(performance.now()-startedAt)/1000,cause:gameState.deathCause,gameState,simulation:{stepFrames,maxFrames}};
 return {...record,reward:scoreEpisode(record)};
}
