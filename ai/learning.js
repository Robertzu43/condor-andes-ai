export const CONFIG_VERSION = 'flight-guidance-v3';
export const STRATEGIES = Object.freeze(['balanced-v1','upper-caution-v1','ground-caution-v1']);
const nonnegative = value => Number.isFinite(value) && value >= 0;
const count = value => Number.isSafeInteger(value) && value >= 0;
const text = value => typeof value === 'string' && value.length > 0;
const validContext = value => value && text(value.model) && text(value.configVersion) && typeof value.mock === 'boolean' && nonnegative(value.dimensions?.width) && value.dimensions.width > 0 && nonnegative(value.dimensions?.height) && value.dimensions.height > 0;
const sameContext = (a,b) => a.model === b.model && a.configVersion === b.configVersion && a.mock === b.mock && a.dimensions.width === b.dimensions.width && a.dimensions.height === b.dimensions.height;
export function scoreEpisode(record) {
  if (!record || !['game-over','duration'].includes(record.reason) || !count(record.obstaclesPassed) || !count(record.coinsCollected) || !nonnegative(record.activeFlightSeconds)) return null;
  const reward=10*record.obstaclesPassed+2*record.coinsCollected+.1*Math.min(150,record.activeFlightSeconds);
  return Number.isFinite(reward) ? reward : null;
}
function validRecord(record) {
  if (!validContext(record) || !text(record.episodeId) || !text(record.experimentId) || !['training','baseline','evaluation'].includes(record.phase) || !STRATEGIES.includes(record.strategyId) || !count(record.courseSeed) || record.courseSeed > 0xffffffff || !count(record.obstaclesPassed) || !count(record.coinsCollected) || !nonnegative(record.activeFlightSeconds) || !count(record.requests) || !nonnegative(record.meanLatencyMs) || !text(record.reason) || !Array.isArray(record.events)) return false;
  return record.reward === scoreEpisode(record);
}
export function emptyStats(context) {
  if (!validContext(context)) throw Error('Invalid learning context');
  return {context:{model:context.model,configVersion:context.configVersion,mock:context.mock,dimensions:{...context.dimensions}},arms:Object.fromEntries(STRATEGIES.map(id=>[id,{visits:0,totalReward:0}])),episodeIds:[]};
}
export function selectStrategy(stats,{explore=true}={}) {
  const arms=STRATEGIES.map(id=>stats?.arms?.[id]);
  if (arms.some(arm=>!arm || !count(arm.visits) || !nonnegative(arm.totalReward))) throw Error('Invalid learning statistics');
  if (explore) {const untried=arms.findIndex(arm=>arm.visits===0);if(untried>=0)return STRATEGIES[untried];}
  const total=arms.reduce((sum,arm)=>sum+arm.visits,0);
  let best=0,bestValue=-Infinity;
  arms.forEach((arm,index)=>{const value=arm.visits ? arm.totalReward/arm.visits+(explore ? Math.sqrt(2*Math.log(total)/arm.visits) : 0) : -Infinity;if(value>bestValue){best=index;bestValue=value}});
  return STRATEGIES[best];
}
export function updateStats(stats,record) {
  if (!validRecord(record) || record.phase!=='training' || record.reward===null || !sameContext(stats.context,record) || stats.episodeIds.includes(record.episodeId)) return stats;
  const arm=stats.arms[record.strategyId];
  return {...stats,arms:{...stats.arms,[record.strategyId]:{visits:arm.visits+1,totalReward:arm.totalReward+record.reward}},episodeIds:[...stats.episodeIds,record.episodeId]};
}
export function deserializeLearning(value) {
  const empty=notice=>({schemaVersion:1,records:[],notice});
  if (value == null || value === '') return empty(null);
  try {
    const data=JSON.parse(value);
    if (data?.schemaVersion!==1 || !Array.isArray(data.records)) return empty('Stored learning data is incompatible; starting empty.');
    const ids=new Set(),records=[];let skipped=false;
    for(const record of data.records){if(!validRecord(record)||ids.has(record.episodeId)){skipped=true;continue;}ids.add(record.episodeId);records.push(record);}
    return {schemaVersion:1,records,notice:skipped?'Invalid or duplicate stored episodes were ignored.':null};
  } catch { return empty('Stored learning data could not be read; starting empty.'); }
}
export function serializeLearning(records) {
  if (!Array.isArray(records) || records.some(record=>!validRecord(record))) throw Error('Invalid learning records');
  return JSON.stringify({schemaVersion:1,records});
}
