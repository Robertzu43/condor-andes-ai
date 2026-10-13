import {GLIDE, FLAP, COIN, PAL, THEME, drawSprite} from '/sprites.js';

const byId = id => document.getElementById(id);
const number = value => Number.isFinite(value) ? value : 0;
const money = value => `$${number(value).toFixed(2)}`;
const text = (id, value) => {byId(id).textContent = value;};
const label = candidate => candidate ? `${candidate.strategyId ?? candidate.id ?? 'Strategy'} · ${candidate.stepFrames ?? '?'} frames` : 'Waiting for results';
const make = (tag, className, content) => {const element = document.createElement(tag); element.className = className; if (content !== undefined) element.textContent = content; return element;};
const slots = Array.from({length:4}, (_, slot) => {
  const tile = make('article','bird');
  const head = make('div','bird-head');
  const name = make('span','bird-name',`CONDOR ${String(slot + 1).padStart(2,'0')}`);
  const status = make('span','bird-state','WAITING');
  const canvas = make('canvas',''); canvas.width = 384; canvas.height = 216;
  canvas.setAttribute('role','img'); canvas.setAttribute('aria-label', `Condor ${slot + 1} waiting for a flight`);
  const foot = make('div','bird-foot'); const detail = make('div','bird-detail','A flight will appear when this slot is assigned.');
  const metrics = make('div','bird-metrics'); foot.append(detail,metrics); head.append(name,status); tile.append(head,canvas,foot); byId('birds').append(tile);
  return {canvas,status,detail,metrics};
});

function drawFlight(canvas, bird) {
  const ctx = canvas.getContext('2d');
  const snapshot = bird?.snapshot;
  const width = number(snapshot?.playfield?.width) || 384, height = number(snapshot?.playfield?.height) || 216;
  // Bound the canvas allocation; draw coordinates still use the authoritative playfield.
  canvas.width = Math.min(width, 2048); canvas.height = Math.min(height, 2048);
  ctx.scale(canvas.width / width, canvas.height / height); ctx.imageSmoothingEnabled = false;
  const theme = THEME[snapshot?.mode] || THEME.normal, palette = PAL[snapshot?.mode] || PAL.normal;
  const sky = ctx.createLinearGradient(0,0,0,height); sky.addColorStop(0,theme.sky0); sky.addColorStop(1,theme.sky1);
  ctx.fillStyle = snapshot ? sky : '#edf3ed'; ctx.fillRect(0,0,width,height);
  if (!snapshot) {
    drawSprite(ctx,GLIDE,PAL.normal,width / 2 - 32,height / 2 - 32,2);
    ctx.fillStyle = '#68716b'; ctx.font = '11px monospace'; ctx.textAlign = 'center'; ctx.fillText('WAITING FOR FLIGHT',width / 2,height - 30); return;
  }
  const ground = number(snapshot.playfield.ground);
  ctx.fillStyle = theme.ground; ctx.fillRect(0,ground,width,height-ground);
  ctx.fillStyle = theme.groundDark; ctx.fillRect(0,ground,width,2);
  for (const mountain of snapshot.mountains || []) {
    for (const [rows,flip] of [[mountain.topRows || [],true],[mountain.bottomRows || [],false]]) {
      rows.forEach((w,i) => {
        const y = flip ? i : ground - 1 - i, snow = i > rows.length * .78;
        ctx.fillStyle = snow ? theme.snow : theme.rock; ctx.fillRect(mountain.x-w,y,2*w,1);
        ctx.fillStyle = snow ? theme.snow2 : theme.rockDark; ctx.fillRect(mountain.x+(w*.3|0),y,w-(w*.3|0),1);
        ctx.fillStyle = snow ? theme.snow : theme.rockLight; ctx.fillRect(mountain.x-w,y,Math.max(1,w*.25|0),1);
      });
    }
  }
  for (const coin of snapshot.visibleCoins || []) drawSprite(ctx,COIN,palette,coin.x-6,coin.y-6);
  if (snapshot.condor) drawSprite(ctx,bird.lastAction === 'flap' ? FLAP : GLIDE,palette,snapshot.condor.x-2,snapshot.condor.spriteY);
  ctx.fillStyle = theme.hud; ctx.font = '10px monospace'; ctx.textAlign = 'left'; ctx.fillText(`SCORE ${number(snapshot.score)}  COINS ${number(snapshot.coins)}`,10,18);
}

function render(state) {
  const spend = state.spend || {}, confirmed = number(spend.confirmedUsd);
  const cap = number(state.approvedMaxUsd) || 1.25;
  text('phase',`${state.mock ? 'Mock · ' : ''}${state.phase || 'waiting'}`);
  text('experiment', state.experimentId || 'No experiment yet');
  text('connection',state.running ? '● Live search' : state.phase === 'waiting' ? 'Waiting for runner' : 'Search stopped');
  text('flight-total',`${number(state.completedFlights)} flights completed`);
  text('flight-valid',`${number(state.validFlights)} valid · ${number(state.interruptedFlights)} interrupted`);
  text('spend',money(confirmed)); byId('budget').max = cap; byId('budget').value = confirmed;
  text('budget-caption',`${money(state.targetUsd ?? 1)} target · ${money(cap)} approved maximum`);
  text('reserved',money(spend.reservedUsd)); text('uncertain',money(spend.uncertainUsd));
  text('committed',money(spend.committedCeilingUsd));
  const calls = typeof spend.calls === 'number' ? spend.calls : Object.values(spend.calls || {}).reduce((sum,n) => sum+number(n),0);
  text('calls', `${number(calls)}${state.mock ? ' (mock)' : ''}`);
  const started = (state.birds || []).filter(bird => ['preparing','assessing','flying','running','deciding'].includes(String(bird.status).toLowerCase())).length;
  text('invocations',state.flightInvocations ?? number(state.completedFlights)+started);
  for (let slot = 0; slot < 4; slot++) {
    const bird = (state.birds || []).find(bird => bird.slot === slot), elements = slots[slot];
    elements.status.textContent = String(bird?.status || 'waiting').toUpperCase();
    elements.detail.textContent = bird ? `${label(bird)} · seed ${bird.seed ?? '—'} · ${bird.phase ?? state.phase}` : 'A flight will appear when this slot is assigned.';
    const snapshot = bird?.snapshot;
    const probability = bird?.probabilities?.find(item => item.choice === 'flap')?.probability;
    elements.metrics.replaceChildren(make('span','',`${number(snapshot?.obstaclesPassed)} passed · ${number(snapshot?.activeFlightSeconds).toFixed(1)}s`),make('span','',`${bird?.lastAction || '—'}${Number.isFinite(probability) ? ` · flap ${(probability * 100).toFixed(0)}%` : ''}`));
    elements.canvas.setAttribute('aria-label', bird ? `Condor ${slot + 1}: ${label(bird)}, ${bird.status}, ${number(snapshot?.obstaclesPassed)} obstacles passed, frame ${number(snapshot?.frame)}${snapshot?.deathCause ? `, death cause ${snapshot.deathCause}` : ''}` : `Condor ${slot + 1} waiting for a flight`);
    drawFlight(elements.canvas,bird);
  }
  const ranking = [...(state.trainingRanking || [])].sort((a,b) => number(b.meanReward)-number(a.meanReward));
  text('best',label(ranking[0]?.candidate));
  const maxReward = Math.max(1,...ranking.map(row => Math.max(0,number(row.meanReward))));
  byId('ranking').replaceChildren(...ranking.map(row => {
    const element = make('div','rank-row'), heading = make('div','rank-label');
    heading.append(make('span','',label(row.candidate)),make('strong','',number(row.meanReward).toFixed(1)));
    const bar = make('progress',''); bar.max = maxReward; bar.value = Math.max(0,number(row.meanReward)); bar.setAttribute('aria-label',`${label(row.candidate)} mean reward ${number(row.meanReward).toFixed(1)}`);
    element.append(heading,bar,make('div','rank-detail',`n=${number(row.n)} · ${number(row.meanObstacles).toFixed(1)} obstacles · ${number(row.meanSeconds).toFixed(1)}s`)); return element;
  }));
  text('selection',state.selected ? `Selected for evaluation: ${label(state.selected.candidate || state.selected)}. Results apply to the tested courses and budget.` : 'No strategy selected yet. Results apply to the tested courses and budget.');
  const recent = (state.recent || []).slice(-6).reverse();
  byId('recent').replaceChildren(...(recent.length ? recent.map(row => make('li','',`${row.candidateId} · reward ${number(row.reward).toFixed(1)} · ${number(row.obstaclesPassed)} passed · ${row.reason || 'completed'}${row.cause ? ` / ${row.cause}` : ''}`)) : [make('li','muted','Results will appear here.')]));
  text('stop-reason', state.stopReason ? `Stopped: ${state.stopReason}` : state.running ? 'Searching within the approved budget.' : 'Waiting for a run snapshot.');
  const updated = new Date(state.updatedAt);
  text('updated',Number.isFinite(updated.getTime()) ? `Updated ${updated.toLocaleTimeString()} · local, read only` : 'Local · read only');
}

render({phase:'waiting'});
let lastSnapshot;
async function poll() {
  try {
    const response = await fetch('/live',{cache:'no-store'});
    if (!response.ok) throw Error('Dashboard unavailable');
    const raw = await response.text();
    if (raw !== lastSnapshot) {render(JSON.parse(raw)); lastSnapshot = raw;}
  } catch {lastSnapshot = undefined; text('connection','Disconnected · last snapshot');}
  setTimeout(poll,250);
}
poll();
