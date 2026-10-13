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
export function createDecider({apiKey, mock = false, fetchImpl = fetch} = {}) {
  return async (payload, {signal} = {}) => {
    validatePayload(payload);
    if (mock) return normalizeAnswer({answers:[{type:'choice',name:'flight',choice:'wait',confidence:1,probabilities:[{value:'flap',probability:0},{value:'wait',probability:1}]}]},true);
    if (!apiKey) throw failure('not-configured');
    try {
      const r = await fetchImpl('https://api.openai.com/v1/decisions',{method:'POST',signal:AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]),headers:{'content-type':'application/json',Authorization:`Bearer ${apiKey}`},body:JSON.stringify({model:MODEL,input:JSON.stringify({...payload,observation:{...payload.observation,...(Array.isArray(payload.observation.mountains)?{mountains:payload.observation.mountains.map(({x,halfWidth,gapTop,gapBottom})=>({x,halfWidth,gapTop,gapBottom}))}:{})}}),questions:[{name:'flight',type:'choice',instructions:'Choose flap or wait, applied once on receipt. Prioritize survival through the nearest approaching gap; collect coins only when safe. x grows right, y down. condor.y/h are hitbox top/height; spriteY is artwork. Positive vy falls. At 60 Hz each frame: vy=min(vy+gravity,8); y+=vy. FLAP REPLACES vy with flapImpulse; WAIT adds no input. A -5.2 flap with .35 gravity rises about36px; repeated400ms flaps climb. Compare both trajectories, permitting descent when needed. Keep the hitbox within the conservative gap corridor: gapTop<=condor.y and condor.y+condor.h<=gapBottom; avoid ground and upper mountain. Predict arrival position using latencyMs*60/1000 frames, then the next action opportunity after200ms cooldown plus another estimated API delay. If paused=true, pauseReason=controller and previousAction=null, this is first preparation: world frozen until this answer, then resumes60Hz. Otherwise it moves during requests. Geometry omits detailed silhouettes and future obstacles. You choose every action.',choices:[{value:'flap',description:'Apply one upward impulse.'},{value:'wait',description:'Apply no impulse.'}]}]})});
      if (!r.ok) {let code=r.status===401?'authentication':r.status===402?'billing':r.status===403?'access':r.status===429?'rate-limit':'network';if(r.status===429){try{const body=await r.json();if(['insufficient_quota','billing_hard_limit_reached'].includes(body?.error?.code))code='billing';}catch{}}throw failure(code);}
      try{return normalizeAnswer(await r.json());}catch{throw failure('invalid-answer');}
    } catch (e) { throw failure(SAFE_ERROR_CODES.includes(e.code)?e.code:'network'); }
  };
}
