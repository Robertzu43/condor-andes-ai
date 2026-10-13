import {deserializeLearning,emptyStats,updateStats,selectStrategy} from './learning.js';
const mean=values=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
const sameContext=(a,b)=>a.model===b.model&&a.configVersion===b.configVersion&&a.mock===b.mock&&a.dimensions.width===b.dimensions.width&&a.dimensions.height===b.dimensions.height;
function chosenProbability(event){
 if(event?.type!=='decision'||event.outcome!=='applied'||!['flap','wait'].includes(event.action)||!Array.isArray(event.probabilities)||event.probabilities.length!==2)return null;
 const probabilities=event.probabilities;
 if(!['flap','wait'].every(choice=>probabilities.filter(p=>p?.choice===choice&&Number.isFinite(p.probability)&&p.probability>=0&&p.probability<=1).length===1)||Math.abs(probabilities.reduce((sum,p)=>sum+p.probability,0)-1)>.01)return null;
 return probabilities.find(p=>p.choice===event.action).probability;
}
export function buildLearningSeries(input,context){
 let validated=[];
 try{validated=deserializeLearning(JSON.stringify({schemaVersion:1,records:input})).records}catch{}
 const records=validated.filter(r=>sameContext(r,context)),training=[],pairs=[],probability=[],recent=[];
 let stats=emptyStats(context);
 for(const record of records){
  stats=updateStats(stats,record);
  if(record.phase==='training'){
   if(record.reward!==null){recent.push(record.reward);if(recent.length>3)recent.shift()}
   training.push({...record,index:training.length+1,mean:record.reward===null?null:mean(recent)});
  }else{
   let pair=pairs.find(p=>p.experimentId===record.experimentId&&p.seed===record.courseSeed);
   if(!pair){pair={experimentId:record.experimentId,seed:record.courseSeed,baseline:[],evaluation:[]};pairs.push(pair)}
   pair[record.phase].push(record);
  }
  const chosen=record.events.map(chosenProbability).filter(p=>p!==null);
  if(record.reward!==null&&chosen.length)probability.push({...record,probability:mean(chosen),decisions:chosen.length});
 }
 for(const pair of pairs){const b=mean(pair.baseline.filter(r=>r.reward!==null).map(r=>r.reward)),e=mean(pair.evaluation.filter(r=>r.reward!==null).map(r=>r.reward));pair.delta=b===null||e===null?null:e-b}
 const summary=phase=>{const rewards=records.filter(r=>r.phase===phase&&r.reward!==null).map(r=>r.reward);return {count:rewards.length,mean:mean(rewards)}};
 const best=selectStrategy(stats,{explore:false}),arm=stats.arms[best];
 return {records,training,pairs,probability,excluded:(Array.isArray(input)?input.length:0)-records.length,validTraining:stats.episodeIds.length,best:arm.visits?best:null,bestMean:arm.visits?arm.totalReward/arm.visits:null,baseline:summary('baseline'),evaluation:summary('evaluation')};
}
const format=value=>value===null?'—':value.toFixed(2);
function svgNode(name,attributes={},text){const node=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [key,value]of Object.entries(attributes))node.setAttribute(key,value);if(text!==undefined)node.textContent=text;return node}
function chart(container,title,xLabel,points,{maxX,meanLine=false,percent=false}={}){
 container.replaceChildren();
 if(!points.length){const p=document.createElement('p');p.textContent='No episodes for this view yet.';container.append(p);return}
 const maxY=Math.max(1,...points.filter(p=>p.y!==null).map(p=>p.y)),x=value=>48+value/Math.max(1,maxX)*530,y=value=>190-value/maxY*155;
 const svg=svgNode('svg',{viewBox:'0 0 610 250',role:'img','aria-label':title});svg.append(svgNode('title',{},title),svgNode('desc',{},'Each marker is an episode. Crosses below the axis are interruptions with no reward. Hover markers for episode details.'));
 for(const fraction of [0,.5,1]){const reward=maxY*fraction;svg.append(svgNode('line',{x1:48,x2:578,y1:y(reward),y2:y(reward),stroke:'#e0e2e5'}),svgNode('text',{x:40,y:y(reward)+4,'text-anchor':'end'},format(reward)))}
 svg.append(svgNode('text',{x:48,y:18},'Reward'),svgNode('text',{x:313,y:245,'text-anchor':'middle'},xLabel));
 if(meanLine){const valid=points.filter(p=>p.mean!==null);svg.append(svgNode('polyline',{points:valid.map(p=>`${x(p.x)},${y(p.mean)}`).join(' '),fill:'none',stroke:'#737981','stroke-width':2,'stroke-dasharray':'5 4'}))}
 for(const point of points){const cx=x(point.x),cy=point.y===null?207:y(point.y),node=point.y===null?svgNode('path',{d:`M${cx-4},${cy-4}l8,8m-8,0l8,-8`,stroke:'#737981','stroke-width':2}):svgNode('circle',{cx,cy,r:4,fill:point.phase==='baseline'?'#fff':'#202124',stroke:'#202124'});node.append(svgNode('title',{},point.label));svg.append(node)}
 for(const value of [0,maxX/2,maxX])svg.append(svgNode('text',{x:x(value),y:230,'text-anchor':'middle'},percent?`${Math.round(value*100)}%`:Number.isInteger(value)?value:value.toFixed(1)));
 container.append(svg);
}
export function renderLearning(state){
 const root=document.getElementById('learning-charts');if(!root||!state.context)return;
 const data=buildLearningSeries(state.allRecords||state.records||[],state.context),context=state.context;
 document.getElementById('learning-summary').textContent=`${context.mock?'MOCK · scripted fixtures':'Real decisions'} · ${context.model} · ${context.configVersion} · ${context.dimensions.width} × ${context.dimensions.height}. Selected: ${state.strategyId||data.best||'none yet'} · Phase: ${state.phase||'history'}. Valid training episodes: ${data.validTraining}. Best training mean: ${format(data.bestMean)}${data.best?` (${data.best})`:''}. Baseline: ${format(data.baseline.mean)} (n=${data.baseline.count}); frozen evaluation: ${format(data.evaluation.mean)} (n=${data.evaluation.count}). ${data.excluded} other-context, duplicate or invalid records excluded.`;
 const detail=r=>`${r.episodeId} · ${r.phase} · ${r.strategyId} · seed ${r.courseSeed} · ${r.reward===null?`interrupted: ${r.reason}`:`reward ${format(r.reward)}`}`;
 chart(document.getElementById('training-chart'),'Actual training reward and trailing last-three valid mean','Training episode',data.training.map(r=>({x:r.index,y:r.reward,mean:r.mean,label:detail(r),phase:r.phase})),{maxX:Math.max(1,data.training.length),meanLine:true});
 const paired=data.pairs.flatMap((pair,index)=>['baseline','evaluation'].flatMap((phase,offset)=>pair[phase].map(r=>({x:index+1+(offset? .12:-.12),y:r.reward,phase,label:detail(r)}))));
 chart(document.getElementById('evaluation-chart'),'Held-out paired baseline and frozen evaluation rewards','Pair (same experiment and seed)',paired,{maxX:data.pairs.length+1});
 chart(document.getElementById('probability-chart'),'Descriptive chosen-action probability versus episode reward','Mean probability of applied chosen actions',data.probability.map(r=>({x:r.probability,y:r.reward,phase:r.phase,label:`${detail(r)} · mean choice ${Math.round(r.probability*100)}% from ${r.decisions} applied decisions`})),{maxX:1,percent:true});
 const list=document.getElementById('evaluation-pairs');list.replaceChildren();
 for(const [index,pair]of data.pairs.entries()){const li=document.createElement('li');li.textContent=`Pair ${index+1} · ${pair.experimentId} · seed ${pair.seed}: baseline n=${pair.baseline.filter(r=>r.reward!==null).length}; evaluation n=${pair.evaluation.filter(r=>r.reward!==null).length}; learned − baseline ${format(pair.delta)}. ${[...pair.baseline,...pair.evaluation].filter(r=>r.reward===null).map(r=>`${r.phase} interrupted (${r.reason})`).join('; ')}`;list.append(li)}
}
