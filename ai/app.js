import {createController,ERROR_MESSAGES} from './controller.js';
import {createExperiment} from './experiment.js';
import {renderLearning} from './learning-view.js';
document.addEventListener('learning-update',event=>renderLearning(event.detail));
import {CONFIG_VERSION,emptyStats,updateStats,serializeLearning,deserializeLearning,scoreEpisode,selectStrategy} from './learning.js';
import {createRecorder} from './recorder.js';
const $=id=>document.getElementById(id),set=(id,value)=>$(id).textContent=value;
let game,controller,connection,events=[],latest=null,observation=null,runStart=0,runId=null,ending=false,finishPromise=null,jsonUrl=null,elapsed=0;
let activeStrategy=null;
let experiment,episodeResolve,episodeOptions,episodeEvents=[],learningRecords=[],storageNotice='',experimentUrl=null,learningSaved=true;
const episodeLogs=new Map();
const STORAGE_KEY='condor-learning-v1';
try{const stored=deserializeLearning(localStorage.getItem(STORAGE_KEY));learningRecords=stored.records;storageNotice=stored.notice||''}catch{storageNotice='Local storage unavailable; records stay in memory.'}
function persistLearning(){try{localStorage.setItem(STORAGE_KEY,serializeLearning(learningRecords));learningSaved=true}catch{learningSaved=false;storageNotice='Could not save locally; export keeps the current records.';set('learning-notice',storageNotice)}}
function currentStats(){
 try{const stored=localStorage.getItem(STORAGE_KEY);if(learningSaved&&stored!==null){const latest=deserializeLearning(stored);storageNotice=latest.notice||'';set('learning-notice',storageNotice);const data=JSON.parse(stored);if(data?.schemaVersion===1&&Array.isArray(data.records))learningRecords=latest.records}}catch{}
 const snapshot=game.snapshot(),context={model:connection.model,configVersion:CONFIG_VERSION,mock:connection.mock,dimensions:{width:snapshot.playfield.width,height:snapshot.playfield.height}};
 let stats=emptyStats(context);for(const record of learningRecords)stats=updateStats(stats,record);return stats;
}
const canvas=$('capture'),ctx=canvas.getContext('2d');
const recorder=createRecorder({canvas,onError:e=>{set('record-status','Recording failed');set('message',e.message);controller?.stop('recording-error')}});
const preciseTime=ms=>`${time(ms)}.${Math.floor(ms%1000/100)}`;
const time=ms=>`${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
function controls(){const running=controller?.state.running;const ready=!!game&&!!connection&&(connection.mock||connection.configured)&&!ending;$('start').disabled=!ready||running||experiment?.state.running;$('restart').disabled=!ready||experiment?.state.running;$('stop').disabled=!running;$('record').disabled=!!running||ending||experiment?.state.running;$('experiment-start').disabled=!ready||running||experiment?.state.running;$('experiment-cancel').disabled=!experiment?.state.running;}
function event(e){
 if(e.type==='start'){activeStrategy=e.strategyId;set('active-strategy',`${episodeOptions?.phase||'manual'} · ${activeStrategy} · ${CONFIG_VERSION}`)}
 if(e.type==='start'&&episodeOptions)episodeLogs.set(e.runId,episodeEvents);
 const log=episodeLogs.get(e.runId);if(log)log.push(e.type==='stop'?{...e,gameState:game.snapshot()}:e);
 if(e.type==='decision'&&log&&e.runId!==runId)persistLearning();
 events.push(e.type==='stop'?{...e,gameState:game.snapshot()}:e);$('json').disabled=false;if(e.type==='start'){runId=e.runId;runStart=e.timeMs;elapsed=0;latest=null;observation=null;set('action','—');set('outcome','Awaiting first request');set('sequence','No decisions yet');$('outcome').classList.remove('live');set('latency','—');for(const c of ['flap','wait']){$(`${c}-prob`).value=0;set(`${c}-value`,'—')}set('status',e.warmup?'Preparing first decision':'Running');set('message',e.warmup?(connection.mock?'MOCK · Holding at the starting line while the scripted first decision is prepared. Gameplay will then run at normal speed.':'Holding at the starting line while OpenAI chooses the first move. Gameplay will then run at normal speed.'):(connection.mock?'MOCK run: scripted wait responses; no OpenAI calls.':'Model control is running.'));$('history').replaceChildren();}
 if(e.runId!==runId)return;
 if(e.type==='request'){observation=e.observation;set('status',e.warmup?'Preparing first decision':'Pending');set('message',e.warmup?(connection.mock?'MOCK · Holding at the starting line while the scripted first decision is prepared. Gameplay will then run at normal speed.':'Holding at the starting line while OpenAI chooses the first move. Gameplay will then run at normal speed.'):(connection.mock?'MOCK run: scripted wait responses; no OpenAI calls.':'Model control is running.'));set('outcome',e.warmup?'Preparing first move':'Pending response');set('sequence',`Request ${e.sequence} pending · ${latest?`last answer ${latest.sequence}`:'no answer yet'}`);$('outcome').classList.remove('live')}
 if(e.type==='decision'){latest=e;set('sequence',`Answer ${e.sequence}`);set('status',controller.state.running?'Running':'Stopped');set('action',e.action.toUpperCase());set('outcome',e.outcome==='applied'?'Applied':`Discarded · ${e.reason}`);$('outcome').classList.toggle('live',e.outcome==='applied');set('latency',`${Math.round(e.latencyMs)} ms`);for(const p of e.probabilities){$(`${p.choice}-prob`).value=p.probability;set(`${p.choice}-value`,`${Math.round(p.probability*100)}%`)}const li=document.createElement('li');for(const s of [preciseTime(e.timeMs-runStart),e.action.toUpperCase(),e.outcome+(e.reason?` · ${e.reason}`:'')]){const span=document.createElement('span');span.textContent=s;li.append(span)}$('history').prepend(li);while($('history').children.length>100)$('history').lastChild.remove();}
 if(e.type==='error'){set('message',e.message);set('outcome','Request failed');$('outcome').classList.remove('live')}
 if(e.type==='stop'){elapsed=e.timeMs-runStart;$('outcome').classList.remove('live');if(e.reason!=='api-error')set('outcome','Run ended');set('sequence',`${latest?`Last answer ${latest.sequence}`:'No answer received'}${e.sequence>(latest?.sequence||0)?` · request ${e.sequence} ended`:''}`);set('status',e.reason==='game-over'?'Game over':'Paused');if(e.reason!=='api-error')set('message',`Run ended: ${e.reason}. Restart begins a new run.`);if(episodeResolve){const resolve=episodeResolve;episodeResolve=null;const snapshot=game.snapshot(),decisions=episodeEvents.filter(e=>e.type==='decision');const record={...experiment.state.stats.context,episodeId:e.runId,experimentId:episodeOptions.experimentId,phase:episodeOptions.phase,strategyId:episodeOptions.strategyId,courseSeed:episodeOptions.seed,dimensions:{width:snapshot.playfield.width,height:snapshot.playfield.height},obstaclesPassed:snapshot.obstaclesPassed,coinsCollected:snapshot.coinsCollected,activeFlightSeconds:snapshot.activeFlightSeconds,requests:e.sequence,meanLatencyMs:decisions.length?decisions.reduce((sum,e)=>sum+e.latencyMs,0)/decisions.length:0,reason:e.reason,events:episodeEvents};controller.waitForIdle().then(()=>{const settled=record.events.filter(e=>e.type==='decision');record.meanLatencyMs=settled.length?settled.reduce((sum,e)=>sum+e.latencyMs,0)/settled.length:0;resolve({...record,reward:scoreEpisode(record)})})}else if(!experiment?.state.running)finishRecording();}
 controls();
}
function finishRecording(){if(finishPromise)return finishPromise;if(!recorder.active)return Promise.resolve();ending=true;controls();draw();set('record-status','Saving recording…');finishPromise=(async()=>{try{const result=await recorder.stop();$('video').disabled=!result;set('record-status',result?'Recording ready':'No video recorded')}catch(e){set('record-status','Recording failed');set('message',e.message);$('video').disabled=true}finally{ending=false;finishPromise=null;controls()}})();return finishPromise;}
async function start(){if(ending||experiment?.state.running)return;if(controller.state.running){controller.stop('restart');await finishRecording();if(ending)return;}
 episodeOptions=null;activeStrategy=selectStrategy(currentStats(),{explore:false});set('active-strategy',`manual · ${activeStrategy} · ${CONFIG_VERSION}`);
 events=[];$('json').disabled=true;$('video').disabled=true;if(jsonUrl){URL.revokeObjectURL(jsonUrl);jsonUrl=null}
 if($('record').checked){try{draw();recorder.start();set('record-status','● Recording')}catch(e){set('message',e.message);set('record-status','Recording unavailable');controls();return}}else set('record-status','Recording off');controller.start({strategyId:activeStrategy});controls();}
$('start').onclick=start;$('restart').onclick=start;$('stop').onclick=()=>controller.stop('stopped');
function download(url,name){const a=document.createElement('a');a.href=url;a.download=name;a.click()}
$('video').onclick=()=>{const r=recorder.result;if(r)download(r.url,`condor-${connection.mock?'mock':'openai'}-${runId}.${r.extension}`)};
$('json').onclick=()=>{if(jsonUrl)URL.revokeObjectURL(jsonUrl);jsonUrl=URL.createObjectURL(new Blob([JSON.stringify({schemaVersion:1,provider:connection.mock?'local mock':'OpenAI Decisions API',model:connection.model,mock:connection.mock,normalSpeed:true,initialPreparation:true,exportedAt:new Date().toISOString(),runId,strategyId:activeStrategy,configVersion:CONFIG_VERSION,events},null,2)],{type:'application/json'}));download(jsonUrl,`condor-${connection.mock?'mock':'openai'}-${runId}.json`)};
function gap(s){return s?.mountains.find(m=>m.x+m.halfWidth>=s.condor.x)}
function draw(){ctx.fillStyle='#fafafa';ctx.fillRect(0,0,1440,810);ctx.fillStyle='#141519';ctx.font='bold 30px sans-serif';ctx.fillText('Cóndor de los Andes · AI spectator',28,46);ctx.font='16px sans-serif';ctx.fillText(connection?.mock?'MOCK · scripted wait · no OpenAI calls':`OpenAI Decisions API · ${connection?.model||'Connecting'}`,28,76);
 if(game){const c=game.canvas;const scale=Math.min(880/c.width,590/c.height),w=c.width*scale,h=c.height*scale;ctx.imageSmoothingEnabled=false;ctx.drawImage(c,28+(880-w)/2,100,w,h)}ctx.fillStyle='#fff';ctx.fillRect(936,100,476,590);ctx.fillStyle='#141519';ctx.font='bold 26px sans-serif';ctx.fillText('Live decisions',958,138);ctx.font='15px sans-serif';ctx.fillText(activeStrategy?$('active-strategy').textContent:$('status').textContent,958,168);ctx.font='14px sans-serif';ctx.fillText($('sequence').textContent,958,190);ctx.font='bold 45px sans-serif';ctx.fillText($('action').textContent,958,230);ctx.font='17px sans-serif';ctx.fillText($('outcome').textContent,958,266);for(const [i,c]of ['flap','wait'].entries()){const y=310+i*43;ctx.fillText(`${c.toUpperCase()}   ${$(`${c}-value`).textContent}`,958,y);ctx.fillStyle='#e7e9ec';ctx.fillRect(1110,y-15,265,14);ctx.fillStyle='#242528';ctx.fillRect(1110,y-15,265*$(`${c}-prob`).value,14)}ctx.fillText(`Response: ${$('latency').textContent}`,958,412);ctx.fillText(`Score ${$('score').textContent}   Coins ${$('coins').textContent}`,958,448);ctx.fillText(`${$('game-mode').textContent} · ${time(elapsed)}`,958,480);ctx.font='bold 18px sans-serif';ctx.fillText('Recent decisions',958,526);ctx.font='14px sans-serif';Array.from($('history').children).slice(0,4).forEach((li,i)=>ctx.fillText(Array.from(li.children).map(s=>s.textContent).join('   '),958,556+i*28));ctx.font='16px sans-serif';ctx.fillText(`Observation: height ${$('height').textContent} · velocity ${$('velocity').textContent} · gap ${$('gap').textContent}`,28,730);ctx.fillText($('message').textContent.slice(0,155),28,765);ctx.fillText(`${connection?.mock?'MOCK · scripted test mode':'Model-controlled'} · normal speed · probabilities are not survival chances`,28,795);}
function frame(){if(game){const s=game.snapshot();if(controller?.state.running)elapsed=performance.now()-runStart;set('score',s.score);set('coins',`${s.coins} / 5`);set('game-mode',s.mode);set('elapsed',time(elapsed));const seen=observation;set('height',seen?`${Math.round(seen.playfield.height-seen.condor.y)} px`:'—');set('velocity',seen?`${seen.condor.vy.toFixed(1)} px/frame`:'—');const g=gap(seen);set('gap',g?`${Math.max(0,Math.round(g.x-g.halfWidth-seen.condor.x))} px away`:'—');}draw();requestAnimationFrame(frame)}
document.addEventListener('visibilitychange',()=>{if(document.hidden){experiment?.stop('hidden');controller?.stop('hidden')}});
window.addEventListener('pagehide',()=>{experiment?.stop('page-unloaded');controller?.stop('page-unloaded');recorder.dispose();if(jsonUrl)URL.revokeObjectURL(jsonUrl)});
async function initialize(){try{const response=await fetch('/api/status');if(!response.ok)throw Error('Local connection failed');connection=await response.json();set('model',connection.model);set('mode-banner',connection.mock?'MOCK · NO OPENAI CALLS':connection.configured?'OpenAI · local connection':'No API key configured');$('mode-banner').classList.toggle('mock',connection.mock);let attempts=0;while(!(game=$('game').contentWindow.condorAI)){if(++attempts>100)throw Error('Game bridge unavailable. Reload this local page.');await new Promise(r=>setTimeout(r,100))}controller=createController({game,onEvent:event,decide:async(payload,{signal})=>{const r=await fetch('/api/decision',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal});if(!r.ok){let body;try{body=await r.json()}catch{}throw Object.assign(Error('Decision request failed'),{code:Object.hasOwn(ERROR_MESSAGES,body?.code)?body.code:'invalid-answer'})};return r.json()}});setupExperiment();set('status','Ready');set('message',connection.mock?'Ready in MOCK mode. Wait-only responses may end a run quickly.':connection.configured?'Ready for model control.':'Configure an API key locally and restart the server before real play.');controls()}catch(e){set('status','Unavailable');set('message',e.message)}}
requestAnimationFrame(frame);initialize();

function setupExperiment(){
 set('learning-notice',storageNotice);
 const snapshot=game.snapshot();
 renderLearning({context:{model:connection.model,configVersion:CONFIG_VERSION,mock:connection.mock,dimensions:{width:snapshot.playfield.width,height:snapshot.playfield.height}},allRecords:learningRecords});
 $('experiment-cancel').onclick=()=>experiment?.stop('cancelled');
 $('experiment-start').onclick=async()=>{
  if(controller.state.running||ending||experiment?.state.running)return;
  const stats=currentStats(),context=stats.context;
  if($('record').checked){try{draw();recorder.start();set('record-status','● Recording experiment');$('video').disabled=true}catch(e){set('message',e.message);return}}
  experiment=createExperiment({stats,runEpisode:options=>new Promise(resolve=>{
   episodeOptions=options;episodeEvents=[];episodeResolve=resolve;
   const cancel=()=>controller.stop(experiment.state.reason||'cancelled');
   options.signal.addEventListener('abort',cancel,{once:true});
   const complete=episodeResolve;episodeResolve=record=>{options.signal.removeEventListener('abort',cancel);complete(record)};
   controller.start({seed:options.seed,strategyId:options.strategyId,durationMs:options.durationMs,maxRequests:options.maxRequests});
  }),onUpdate:state=>{
   for(const record of state.records)if(!learningRecords.some(r=>r.episodeId===record.episodeId))learningRecords.push(record);
   persistLearning();
   if(state.reason&&recorder.active)finishRecording();
   set('experiment-status',`${state.running?'Running':'Ended'} · ${state.phase||'preparing'} · ${state.strategyId||'—'} · ${state.records.length}/10 episodes · ${state.requests}/750 requests · ${state.reason||''}`);
   $('experiment-records').textContent=JSON.stringify(state.records,null,2);
   if(experimentUrl)URL.revokeObjectURL(experimentUrl);
   experimentUrl=URL.createObjectURL(new Blob([JSON.stringify({schemaVersion:1,experimentId:state.experimentId,context,limits:{durationMs:150000,maxRequests:750},reason:state.reason,records:state.records,stats:state.stats},null,2)],{type:'application/json'}));
   $('experiment-export').href=experimentUrl;$('experiment-export').download=`condor-experiment-${state.experimentId}.json`;$('experiment-export').hidden=false;
   document.dispatchEvent(new CustomEvent('learning-update',{detail:{...state,allRecords:learningRecords}}));controls();
  }});
  await experiment.start();episodeOptions=null;await finishRecording();controls();
 };
}
