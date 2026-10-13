// Estimates expose both choices; they never select or execute a game input.
export function projectFlight({observation:o,latencyMs=200,previousAction}) {
  if (!o?.condor || !o.playfield || ![o.condor.y,o.condor.vy,o.condor.h,o.gravity,o.flapImpulse,o.scrollSpeed,o.playfield.ground].every(Number.isFinite)) return null;
  const held=o.paused && o.pauseReason==='controller' && previousAction==null;
  const estimatedLatencyMs=Math.min(1000,Math.max(0,latencyMs));
  const requestFrames=held?0:Math.ceil(estimatedLatencyMs*60/1000);
  const nextDecisionFrames=Math.ceil((200+estimatedLatencyMs)*60/1000);
  const round=n=>Math.round(n*100)/100;
  const advance=s=>{s.vy=Math.min(s.vy+o.gravity,8);s.y+=s.vy;if(s.y<2){s.y=2;s.vy=0}};
  const arrival={y:o.condor.y,vy:o.condor.vy};
  let arrivalGroundContact=arrival.y+o.condor.h>=o.playfield.ground;
  for(let i=0;i<requestFrames&&!arrivalGroundContact;i++){advance(arrival);arrivalGroundContact=arrival.y+o.condor.h>=o.playfield.ground}
  const nearest=(o.mountains||[]).filter(m=>m.x+m.halfWidth-o.scrollSpeed*requestFrames>=o.condor.x).sort((a,b)=>a.x-b.x)[0];
  const candidates={};
  for(const action of ['flap','wait']) {
    const s={...arrival};if(action==='flap')s.vy=o.flapImpulse;
    let minY=s.y,maxY=s.y,groundContact=arrivalGroundContact,minimumGapTopMargin=nearest?s.y-nearest.gapTop:null,minimumGapBottomMargin=nearest?nearest.gapBottom-s.y-o.condor.h:null;
    let framesSimulated=0;
    for(let i=0;i<nextDecisionFrames&&!groundContact;i++){
      advance(s);framesSimulated++;minY=Math.min(minY,s.y);maxY=Math.max(maxY,s.y);
      if(nearest){minimumGapTopMargin=Math.min(minimumGapTopMargin,s.y-nearest.gapTop);minimumGapBottomMargin=Math.min(minimumGapBottomMargin,nearest.gapBottom-s.y-o.condor.h)}
      groundContact=s.y+o.condor.h>=o.playfield.ground;
    }
    candidates[action]={end:{y:round(s.y),vy:round(s.vy)},minimumHitboxTop:round(minY),maximumHitboxBottom:round(maxY+o.condor.h),minimumGapTopMargin:minimumGapTopMargin===null?null:round(minimumGapTopMargin),minimumGapBottomMargin:minimumGapBottomMargin===null?null:round(minimumGapBottomMargin),estimatedGroundContact:groundContact,framesSimulated};
  }
  return {estimated:true,estimatedLatencyMs,requestFrames,nextDecisionFrames,arrival:{y:round(arrival.y),vy:round(arrival.vy)},arrivalGroundContact,nearestGap:nearest?{xAtAnswer:round(nearest.x-o.scrollSpeed*requestFrames),xAtNextDecision:round(nearest.x-o.scrollSpeed*(requestFrames+nextDecisionFrames)),halfWidth:nearest.halfWidth,gapTop:nearest.gapTop,gapBottom:nearest.gapBottom}:null,candidates};
}
