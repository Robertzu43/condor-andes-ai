import {projectFlight} from './projection.mjs';
import {STRATEGIES} from './learning.js';
const guidance = Object.freeze({'balanced-v1':'','upper-caution-v1':' Extra upper-gap caution: favor waiting when another flap reduces upper-gap clearance and the wait trajectory remains safe.','ground-caution-v1':' Extra ground caution: favor a flap when waiting risks ground contact and the flap trajectory remains within the gap.'});
const variantGuidance=Object.freeze({standard:'',clearance:' Clearance refinement: when both choices avoid predicted lethal contact, compare minimum top and bottom gap clearance and alignment with the incoming gap. Favor wait if already climbing and another flap reduces upper clearance, provided waiting remains viable. Negative corridor margins are not proof of collision; exact visible rock contact takes priority.',recovery:' Recovery refinement: do not wait merely to avoid upper rock if waiting risks ground contact. Consider projected end velocity and height, time since lastFlapFrame, and the ability to recover before the next decision. Prioritize exact visible rock contact evidence alongside lethal ground risk; projections remain estimates.'});
const assessmentGuidance=Object.freeze({immediate:' Assessment lens: immediate survival; emphasize contact before arrival and the next action horizon.',approach:' Assessment lens: approach survival; emphasize moving gap alignment and the next visible obstacle.',recovery:' Assessment lens: recovery survival; emphasize vertical recovery, repeat-tap risk and the 500ms delayStress horizon.'});
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
  if (Object.keys(payload).some(key=>!['observation','previousAction','latencyMs','strategyId','assessment','simulation','guidanceVariant'].includes(key))) throw Error('Invalid request field');
  if (Object.hasOwn(payload,'strategyId') && !STRATEGIES.includes(payload.strategyId)) throw Error('Invalid strategy');
  if (Object.hasOwn(payload,'guidanceVariant') && (typeof payload.guidanceVariant!=='string' || !Object.hasOwn(variantGuidance,payload.guidanceVariant) || payload.strategyId!=='upper-caution-v1')) throw Error('Invalid guidance variant');
  if (Object.hasOwn(payload,'assessment') && (typeof payload.assessment!=='string' || !Object.hasOwn(assessmentGuidance,payload.assessment))) throw Error('Invalid assessment');
  if(Object.hasOwn(payload,'simulation') && (!payload.simulation || Array.isArray(payload.simulation) || Object.keys(payload.simulation).some(k=>k!=='stepFrames') || !Number.isInteger(payload.simulation.stepFrames) || payload.simulation.stepFrames<1 || payload.simulation.stepFrames>30))throw Error('Invalid simulation');
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
  const fields=['state','frame','lastFlapFrame','paused','pauseReason','playfield','gravity','flapImpulse','scrollSpeed','mode','invulnerabilitySeconds'];
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
      const r = await fetchImpl('https://api.openai.com/v1/decisions',{method:'POST',signal:AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]),headers:{'content-type':'application/json',Authorization:`Bearer ${apiKey}`},body:JSON.stringify({model:MODEL,input:JSON.stringify({...payload,guidanceVariant:payload.guidanceVariant??'standard',flightProjection:projectFlight(payload),observation:providerObservation(payload.observation)}),questions:[{name:'flight',type:'choice',instructions:'Choose flap or wait with probabilities. The controller aggregates concurrent assessments of this same observation and applies one action after a fresh quorum. This is a 60Hz game, x right, y down, condor is a 20x14 collision hitbox. Tap REPLACES vy with -5.2, never adds thrust; gravity adds 0.35 each frame before y moves; falling vy caps at 8; ceiling resets hitbox top to 2 and vy to 0. One isolated tap rises about 36px over 14 frames (233ms) before falling. Repeated taps reset that arc and can climb into upper rocks. lastFlapFrame records the actual last tap, distinct from a previous wait. ' + (payload.simulation?`Decision-step simulation: the world is frozen while the API answers. Exactly ${payload.simulation.stepFrames} real game frames advance after the aggregate action. Arrival is unchanged; nominal and delayStress paths both cover that fixed horizon without network delay.`:'The world scrolls during API requests except frozen first preparation. flightProjection advances to estimated answer arrival, then compares flap and wait through nominal and 500ms delayStress horizons.') + ' silhouetteAvailable means exact visible mountain rows are available: firstRockContactFrame is the first predicted geometric rock contact after the action; arrivalRockContactFrame is contact BEFORE the answer can be applied. Values are frame offsets; null means no contact within that limited horizon, NOT permanent safety. Nonlethal 1-2px tips and strict overlap follow the game code. Use row contact evidence ahead of conservative rectangular corridor margins: negative corridor margins alone do NOT establish rock collision. Prioritize avoiding ground and unprotected rock contact across both horizons. If only one choice avoids those contacts, favor it; if neither does, use remaining clearance and timing to reduce risk. Rocks consume ULTRA protection or are ignored during invulnerability; ground is always lethal. Forecasts hold speed fixed, extrapolate beyond geometric rock contact, and omit future hidden obstacles, coin-triggered protection changes and timing jitter. Longer paths require new observations. You choose every action; forecasts never execute inputs.' + guidance[payload.strategyId ?? 'balanced-v1'] + (payload.simulation && payload.assessment==='recovery'?' Assessment lens: recovery survival; emphasize vertical recovery and repeat-tap risk over the fixed frame horizon.':assessmentGuidance[payload.assessment ?? 'immediate']) + variantGuidance[payload.guidanceVariant ?? 'standard'],choices:[{value:'flap',description:'Apply one upward impulse.'},{value:'wait',description:'Apply no impulse.'}]}]})});
      if (!r.ok) {let code=r.status===401?'authentication':r.status===402?'billing':r.status===403?'access':r.status===429?'rate-limit':'network';if(r.status===429){try{const body=await r.json();if(['insufficient_quota','billing_hard_limit_reached'].includes(body?.error?.code))code='billing';}catch{}}throw failure(code);}
      try{return normalizeAnswer(await r.json());}catch{throw failure('invalid-answer');}
    } catch (e) { throw failure(SAFE_ERROR_CODES.includes(e.code)?e.code:'network'); }
  };
}
