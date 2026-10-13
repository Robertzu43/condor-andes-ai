import test from 'node:test';
import assert from 'node:assert/strict';
import * as learning from './learning.js';
const context={model:'gpt-6-luna',configVersion:'flight-guidance-v1',dimensions:{width:800,height:600},mock:false};
const record=(extra={})=>({episodeId:'e1',experimentId:'x1',phase:'training',strategyId:'balanced-v1',courseSeed:101,...context,obstaclesPassed:2,coinsCollected:3,activeFlightSeconds:10,requests:4,meanLatencyMs:100,reason:'game-over',reward:27,events:[],...extra});
test('reward uses physical counters and excludes invalid outcomes',()=>{
 assert.equal(learning.scoreEpisode(record()),27);
 assert.equal(learning.scoreEpisode(record({activeFlightSeconds:200})),41);
 for(const reason of ['manual-stop','limit','network','hidden'])assert.equal(learning.scoreEpisode(record({reason})),null);
 for(const extra of [{coinsCollected:-1},{obstaclesPassed:NaN},{activeFlightSeconds:Infinity},{coinsCollected:1.5}])assert.equal(learning.scoreEpisode(record(extra)),null);
});
test('UCB explores unvisited strategies then rewards uncertainty; frozen choice uses mean',()=>{
 const stats=learning.emptyStats(context);
 assert.equal(learning.selectStrategy(stats),'balanced-v1');
 const one=learning.updateStats(stats,record());
 assert.equal(learning.selectStrategy(one),'upper-caution-v1');
 const two=learning.updateStats(one,record({episodeId:'e2',strategyId:'upper-caution-v1'}));
 assert.equal(learning.selectStrategy(two),'ground-caution-v1');
 const three=learning.updateStats(two,record({episodeId:'e3',strategyId:'ground-caution-v1',coinsCollected:4,reward:29}));
 assert.equal(learning.selectStrategy(three,{explore:false}),'ground-caution-v1');
 const asymmetric={...three,arms:{'balanced-v1':{visits:100,totalReward:1000},'upper-caution-v1':{visits:1,totalReward:9},'ground-caution-v1':{visits:100,totalReward:0}}};
 assert.equal(learning.selectStrategy(asymmetric),'upper-caution-v1');
 assert.equal(learning.selectStrategy(asymmetric,{explore:false}),'balanced-v1');
 assert.equal(stats.arms['balanced-v1'].visits,0);
});
test('stats deduplicate and separate evaluation, mocks, models, dimensions and configuration',()=>{
 const first=learning.updateStats(learning.emptyStats(context),record());
 for(const extra of [{},{phase:'evaluation'},{phase:'baseline'},{mock:true},{model:'other'},{configVersion:'other'},{dimensions:{width:600,height:800}},{reason:'network'},{reward:999}]){
 const next=learning.updateStats(first,record({episodeId:Object.keys(extra).length?'other':'e1',...extra}));
 assert.deepEqual(next,first);
 }
 const second=learning.updateStats(first,record({episodeId:'e2'}));assert.equal(second.arms['balanced-v1'].visits,2);assert.equal(first.arms['balanced-v1'].visits,1);
});
test('persistence validates, recomputes rewards, deduplicates records and reports corrupt storage',()=>{
 const saved=learning.deserializeLearning(JSON.stringify({schemaVersion:1,records:[record(),record(),record({episodeId:'e2',phase:'evaluation'}),record({episodeId:'bad',reward:999})]}));
 assert.deepEqual(saved.records.map(r=>r.episodeId),['e1','e2']);assert.ok(saved.notice);
 for(const text of ['bad',JSON.stringify({schemaVersion:2,records:[]}),JSON.stringify({schemaVersion:1,records:{}})]){const result=learning.deserializeLearning(text);assert.deepEqual(result.records,[]);assert.ok(result.notice)}
 assert.deepEqual(learning.deserializeLearning(learning.serializeLearning([record()])).records,[record()]);
 const interrupted=record({episodeId:'stop',reason:'manual-stop',reward:null});assert.equal(learning.deserializeLearning(learning.serializeLearning([interrupted])).records[0].reward,null);
});
test('mock training stays in its own partition and malformed metadata is ignored',()=>{
 const mock=learning.updateStats(learning.emptyStats({...context,mock:true}),record({mock:true}));assert.equal(mock.arms['balanced-v1'].visits,1);
 assert.equal(learning.updateStats(mock,record()).arms['balanced-v1'].visits,1);
 for(const extra of [{strategyId:'unknown'},{courseSeed:-1},{dimensions:{width:0,height:600}},{requests:NaN},{meanLatencyMs:-1},{events:[] ,phase:'unknown'}]){
  const bad=record(extra);assert.deepEqual(learning.deserializeLearning(JSON.stringify({schemaVersion:1,records:[bad]})).records,[]);
  assert.throws(()=>learning.serializeLearning([bad]));
 }
 assert.throws(()=>learning.emptyStats({...context,mock:'false'}));
 assert.throws(()=>learning.selectStrategy({arms:{}}));
 assert.equal(learning.selectStrategy(learning.emptyStats(context),{explore:false}),'balanced-v1');
 assert.deepEqual(learning.deserializeLearning(null),{schemaVersion:1,records:[],notice:null});
});
test('current guidance excludes historical slower-cadence training while retaining exportable history',()=>{const previous=record(),current={...context,configVersion:learning.CONFIG_VERSION};const stored=learning.deserializeLearning(learning.serializeLearning([previous]));assert.equal(stored.records.length,1);const stats=learning.emptyStats(current);assert.deepEqual(learning.updateStats(stats,stored.records[0]),stats);const next=learning.updateStats(stats,record({episodeId:'current',configVersion:learning.CONFIG_VERSION}));assert.equal(next.arms['balanced-v1'].visits,1)});
