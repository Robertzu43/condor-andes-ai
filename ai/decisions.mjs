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
    if (!apiKey) throw Error('OpenAI API key not configured');
    try {
      const r = await fetchImpl('https://api.openai.com/v1/decisions',{method:'POST',signal:AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]),headers:{'content-type':'application/json',Authorization:`Bearer ${apiKey}`},body:JSON.stringify({model:MODEL,input:JSON.stringify(payload),questions:[{name:'flight',type:'choice',instructions:'Choose one flight input to apply once on receipt to keep the condor alive and collect visible coins. Physics values are per 60 Hz frame. Account for latency, velocity, visible mountain shapes and gap bounds; no future obstacles are known.',choices:[{value:'flap',description:'Apply one upward impulse.'},{value:'wait',description:'Apply no impulse.'}]}]})});
      if (!r.ok) throw Error();
      return normalizeAnswer(await r.json());
    } catch { throw Error('Decision request failed or returned an invalid/refused answer'); }
  };
}
