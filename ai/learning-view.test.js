import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLearningSeries} from './learning-view.js';
const context={model:'model',configVersion:'flight-guidance-v1',mock:false,dimensions:{width:800,height:600}};
const record=(id,reward=1,extra={})=>({...context,episodeId:id,experimentId:'batch',phase:'training',strategyId:'balanced-v1',courseSeed:101,obstaclesPassed:0,coinsCollected:0,activeFlightSeconds:reward*10,requests:1,meanLatencyMs:100,reason:'duration',reward,events:[],...extra});
const event=(probability=.7,extra={})=>({type:'decision',outcome:'applied',action:'flap',probabilities:[{choice:'flap',probability},{choice:'wait',probability:1-probability}],...extra});
test('training trailing mean uses last three valid outcomes and leaves interruptions null',()=>{
 const result=buildLearningSeries([record('1'),record('stop',0,{reason:'cancelled',reward:null}),record('2',2),record('3',3),record('4',4)],context);
 assert.deepEqual(result.training.map(p=>p.mean),[1,null,1.5,2,3]);
 assert.equal(result.training[1].reward,null);assert.equal(result.validTraining,4);
});
test('validation deduplicates, excludes invalid data and partitions every context field',()=>{
 const records=[record('1'),record('1'),record('bad',1,{reward:999}),record('mock',1,{mock:true}),record('model',1,{model:'other'}),record('config',1,{configVersion:'other'}),record('size',1,{dimensions:{width:600,height:800}})];
 const result=buildLearningSeries(records,context);assert.equal(result.training.length,1);assert.equal(result.excluded,6);
 assert.equal(buildLearningSeries(records,{...context,mock:true}).training[0].episodeId,'mock');
 assert.deepEqual(buildLearningSeries([],context).training,[]);
});
test('held-out rows stay paired by experiment and seed, include interruptions and negative changes',()=>{
 const result=buildLearningSeries([record('t'),record('b',4,{phase:'baseline',courseSeed:1001}),record('e',1,{phase:'evaluation',courseSeed:1001}),record('b2',2,{experimentId:'other',phase:'baseline',courseSeed:1001}),record('e2',0,{phase:'evaluation',courseSeed:1002,reason:'hidden',reward:null})],context);
 assert.equal(result.validTraining,1);assert.equal(result.training[0].mean,1);
 assert.equal(result.pairs.length,3);assert.equal(result.pairs[0].delta,-3);
 assert.deepEqual(result.baseline,{count:2,mean:3});assert.deepEqual(result.evaluation,{count:1,mean:1});
 assert.equal(result.pairs[2].evaluation[0].reward,null);
});
test('probability averages only valid applied chosen actions and keeps one point per episode',()=>{
 const events=[event(.8),event(.6),event(.9,{outcome:'discarded'}),null,{},event(2),event(.7,{probabilities:null}),event(.7,{probabilities:[null]}),event(.7,{action:'unknown'}),event(.7,{probabilities:[{choice:'flap',probability:.7},{choice:'flap',probability:.3}]})];
 const result=buildLearningSeries([record('p',2,{events}),record('stop',0,{events:[event()],reason:'cancelled',reward:null})],context);
 assert.equal(result.probability.length,1);assert.equal(result.probability[0].probability,.7);assert.equal(result.probability[0].decisions,2);assert.equal(result.probability[0].reward,2);
});

test('zero rewards and incomplete pairs remain visible without manufacturing improvement',()=>{
 const result=buildLearningSeries([record('zero',0),record('base',0,{phase:'baseline',courseSeed:1001})],context);
 assert.equal(result.bestMean,0);assert.equal(result.training[0].mean,0);
 assert.equal(result.pairs[0].delta,null);assert.deepEqual(result.evaluation,{count:0,mean:null});
 assert.deepEqual(buildLearningSeries([record('bad',1,{events:'bad'})],context).records,[]);
});
