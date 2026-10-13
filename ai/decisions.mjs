import {projectFlight} from './projection.mjs';
import {STRATEGIES} from './learning.js';
const guidance = Object.freeze({'balanced-v1':'','upper-caution-v1':' Extra upper-gap caution: favor waiting when another flap reduces upper-gap clearance and the wait trajectory remains safe.','ground-caution-v1':' Extra ground caution: favor a flap when waiting risks ground contact and the flap trajectory remains within the gap.'});
export const SAFE_ERROR_CODES=['authentication','billing','access','rate-limit','network','invalid-answer','not-configured'];
const failure=code=>Object.assign(Error(code==='not-configured'?'OpenAI API key not configured':'Decision request failed or returned an invalid/refused answer'),{code});
export const MODEL = 'gpt-6-luna';
const choices = ['flap', 'wait'];
export function validatePayload(payload) {
  if (!payload || !payload.observation || typeof payload.observation !== 'object' || Array.isArray(payload.observation)) throw Error('Invalid observation');
  const visit = (v, depth = 0) => {
    if (depth > 12) throw Error('Observation too deep');
    if (typeof v === 'number' && (!Number.isFinite(v) || Math.abs(v) > 1e15)) throw Error('Invalid number');
    if (v && typeof v === 'object') Object.values(v).forEach(x => visit(x, depth + 1));
  };
  if (Object.keys(payload).some(key=>!['observation','previousAction','latencyMs','strategyId'].includes(key))) throw Error('Invalid request field');
  if (Object.hasOwn(payload,'strategyId') && !STRATEGIES.includes(payload.strategyId)) throw Error('Invalid strategy');
  visit(payload);
  if (JSON.stringify(payload).length > 16000) throw Error('Observation too large');
  if (payload.previousAction != null && (!choices.includes(payload.previousAction.action) || !Number.isInteger(payload.previousAction.frame))) throw Error('Invalid previous action');
  if (payload.latencyMs != null && (!Number.isFinite(payload.latencyMs) || payload.latencyMs < 0 || payload.latencyMs > 10000)) throw Error('Invalid latency');
  return payload;
}
export function normalizeAnswer(data, mock = false) {
  const a = data?.answers?.length === 1 && data.answers[0];
  const unit = n => Number.isFinite(n) && n >= 0 && n <= 1;
  if (!a || a.type !== 'choice' || a.name !== 'flight' || !choices.includes(a.choice) || !unit(a.confidence) || a.probabilities?.length !== 2) throw Error('Invalid or refused decision');
  const probabilities = a.probabilities.map(p => ({choice:p.value, probability:p.probability}));
  if (!choices.every(c => probabilities.filter(p => p.choice === c && unit(p.probability)).length === 1) || Math.abs(probabilities.reduce((s,p)=>s+p.probability,0)-1) > .01) throw Error('Invalid probabilities');
  return {action:a.choice,probabilities,confidence:a.confidence,model:MODEL,mock};
}
function providerObservation(o) {
  const fields=['state','frame','paused','pauseReason','playfield','gravity','flapImpulse','scrollSpeed','mode','invulnerabilitySeconds'];
  const compact=Object.fromEntries(fields.filter(key=>Object.hasOwn(o,key)).map(key=>[key,o[key]]));
  if(o.condor) compact.condor=Object.fromEntries(['x','y','w','h','vy'].map(key=>[key,o.condor[key]]));
  if(Array.isArray(o.mountains)) compact.mountains=o.mountains.map(({x,halfWidth,gapTop,gapBottom})=>({x,halfWidth,gapTop,gapBottom}));
  return compact;
}
export function createDecider({apiKey, mock = false, fetchImpl = fetch} = {}) {
  return async (payload, {signal} = {}) => {
    validatePayload(payload);
    if (mock) return normalizeAnswer({answers:[{type:'choice',name:'flight',choice:'wait',confidence:1,probabilities:[{value:'flap',probability:0},{value:'wait',probability:1}]}]},true);
    if (!apiKey) throw failure('not-configured');
    try {
      const r = await fetchImpl('https://api.openai.com/v1/decisions',{method:'POST',signal:AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]),headers:{'content-type':'application/json',Authorization:`Bearer ${apiKey}`},body:JSON.stringify({model:MODEL,input:JSON.stringify({...payload,flightProjection:projectFlight(payload),observation:providerObservation(payload.observation)}),questions:[{name:'flight',type:'choice',instructions:'Choose every flap or wait with probabilities; apply once on receipt. x grows right, y down; condor is the collision hitbox. At 60Hz: vy=min(vy+gravity,8); y+=vy; ceiling resets y=2, vy=0. Flap replaces vy with flapImpulse; wait adds no input. World moves during requests except first controller-paused preparation with previousAction=null. flightProjection estimates arrival, then BOTH actions through nominal max(200ms, recent latency) and a 500ms delayStress from that same arrival. Compare ground contact, clearance and end state in both horizons. 500ms matches the stale-answer threshold; actual delays can exceed it, so it is no safety guarantee. minimumGapTop/BottomMargin describe the nearest planning gap even when distant. minimumCorridorTop/BottomMargin measure clearance ONLY during actual horizontal hitbox overlap with visible mountains; null means no overlap in that horizon. Negative overlap margins indicate conservative corridor risk, not a detailed silhouette collision. A distant gap is for planning, not immediate collision risk. Prioritize survival; weigh upper/lower corridor risk during overlap and ground risk in nominal and stress estimates. Estimates omit future obstacles and timing jitter; they do not recommend an action. You choose every action.' + guidance[payload.strategyId ?? 'balanced-v1'],choices:[{value:'flap',description:'Apply one upward impulse.'},{value:'wait',description:'Apply no impulse.'}]}]})});
      if (!r.ok) {let code=r.status===401?'authentication':r.status===402?'billing':r.status===403?'access':r.status===429?'rate-limit':'network';if(r.status===429){try{const body=await r.json();if(['insufficient_quota','billing_hard_limit_reached'].includes(body?.error?.code))code='billing';}catch{}}throw failure(code);}
      try{return normalizeAnswer(await r.json());}catch{throw failure('invalid-answer');}
    } catch (e) { throw failure(SAFE_ERROR_CODES.includes(e.code)?e.code:'network'); }
  };
}
