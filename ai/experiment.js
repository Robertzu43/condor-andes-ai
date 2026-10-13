import {selectStrategy,updateStats,scoreEpisode} from './learning.js';
export function createExperiment({runEpisode,onUpdate=()=>{},now=()=>performance.now(),stats}) {
  let abort,timer;
  let state={running:false,records:[],stats,reason:null,experimentId:null,context:stats.context,phase:null,strategyId:null,requests:0};
  const publish=()=>onUpdate({...state,records:[...state.records]});
  function stop(reason='cancelled'){if(!state.running)return;state.reason=reason;abort.abort();publish()}
  async function start(){
    if(state.running)return;
    state={...state,running:true,records:[],reason:null,experimentId:crypto.randomUUID(),requests:0};
    abort=new AbortController();const startedAt=now();timer=setTimeout(()=>stop('budget'),150000);publish();
    let frozen;
    try {
      for(let index=0;index<10;index++){
        const remaining=150000-(now()-startedAt);
        if(abort.signal.aborted||remaining<=0||state.requests>=750){if(!state.reason)stop('budget');break}
        const phase=index<6?'training':[ 'baseline','evaluation','evaluation','baseline'][index-6];
        if(index===6)frozen=selectStrategy(state.stats,{explore:false});
        const strategyId=phase==='training'?selectStrategy(state.stats):phase==='baseline'?'balanced-v1':frozen;
        const seed=index<6?[101,102,103][index%3]:index<8?1001:1002;
        Object.assign(state,{phase,strategyId});publish();
        const opts={seed,strategyId,phase,experimentId:state.experimentId,durationMs:Math.min(15000,remaining),maxRequests:750-state.requests,signal:abort.signal};
        let record;
        try{record=await runEpisode(opts)}catch{record={...state.stats.context,episodeId:crypto.randomUUID(),experimentId:state.experimentId,phase,strategyId,courseSeed:seed,obstaclesPassed:0,coinsCollected:0,activeFlightSeconds:0,requests:0,meanLatencyMs:0,events:[],reason:'api-error'}}
        state.requests+=record.requests;
        const dimensions=state.stats.context.dimensions;
        if(record.dimensions.width!==dimensions.width||record.dimensions.height!==dimensions.height)stop('resize');
        if(now()-startedAt>=150000||state.requests>=750)stop('budget');
        if(state.reason)record={...record,reason:state.reason};
        record={...record,reward:scoreEpisode(record)};
        state.records.push(record);state.stats=updateStats(state.stats,record);publish();
        if(!['game-over','duration'].includes(record.reason)){stop(record.reason);break}
      }
    }finally{clearTimeout(timer);state.running=false;state.reason??='complete';publish()}
  }
  return {start,stop,get state(){return {...state,records:[...state.records]}}};
}
