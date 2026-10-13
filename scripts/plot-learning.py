"""Render an honest, static figure from an exported real experiment.
Optional authoring dependency: matplotlib. Not used by the game runtime.
Usage: python scripts/plot-learning.py experiment.json output.svg
"""
import json, sys, math
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

source, destination = map(Path, sys.argv[1:3])
data = json.loads(source.read_text())
records = data.get('records', data.get('episodes', []))
if not records:
    raise SystemExit('No episode records; no figure generated.')
experiment = records[-1]['experimentId']
rows = [r for r in records if r['experimentId'] == experiment and r.get('mock') is False]
if not rows:
    raise SystemExit('No real episodes in the latest experiment; refusing to label mock data as real.')
# Refuse misleading mixed contexts or corrupt rewards before making a publication figure.
context = lambda r: (r['model'], r['configVersion'], r['dimensions']['width'], r['dimensions']['height'])
assert len({r['episodeId'] for r in rows}) == len(rows), 'Duplicate episode records'
assert len({context(r) for r in rows}) == 1, 'Mixed experiment contexts'
for row in rows:
    reward = row.get('reward')
    if reward is not None:
        assert row['reason'] in ('game-over', 'duration'), 'Interrupted episode has reward'
        assert all(isinstance(row[k], (int, float)) and math.isfinite(row[k]) and row[k] >= 0 for k in ('obstaclesPassed', 'coinsCollected', 'activeFlightSeconds')), 'Invalid flight metrics'
        assert math.isclose(reward, 10 * row['obstaclesPassed'] + 2 * row['coinsCollected'] + .1 * min(150, row['activeFlightSeconds'])), 'Reward disagrees with metrics'
valid = [r for r in rows if r.get('reward') is not None]
training = [r for r in valid if r['phase'] == 'training']
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10, 'axes.spines.top': False, 'axes.spines.right': False})
fig, axes = plt.subplots(1, 3, figsize=(15, 4.7), layout='constrained')
fig.suptitle('Cóndor · measured strategy-learning experiment', fontsize=18, fontweight='bold')
ax = axes[0]
if training:
    xs = [rows.index(r)+1 for r in training]
    ys = [r['reward'] for r in training]
    means = [sum(ys[max(0,i-2):i+1])/len(ys[max(0,i-2):i+1]) for i in range(len(ys))]
    ax.plot(xs, ys, 'o-', color='#174f80', label='Episode reward')
    ax.plot(xs, means, '--', color='#b75f11', label='Trailing mean (up to 3)')
    ax.legend(fontsize=8)
else:
    ax.text(.5,.5,'No valid training episodes',ha='center',transform=ax.transAxes)
ax.set(title='Training feedback', xlabel='Episode order', ylabel='Measured reward')
ax = axes[1]
seeds = sorted({r['courseSeed'] for r in valid if r['phase'] in ('baseline','evaluation')})
for i, seed in enumerate(seeds):
    base = [r['reward'] for r in valid if r['courseSeed']==seed and r['phase']=='baseline']
    learned = [r['reward'] for r in valid if r['courseSeed']==seed and r['phase']=='evaluation']
    if base: ax.scatter(i-.12,base[-1],marker='s',color='#6d7278',label='Fixed balanced' if i==0 else None)
    if learned: ax.scatter(i+.12,learned[-1],color='#17745b',label='Frozen learned choice' if i==0 else None)
    if base and learned: ax.plot([i-.12,i+.12],[base[-1],learned[-1]],color='#b6bec6',zorder=0)
ax.set_xticks(range(len(seeds)),[str(seed) for seed in seeds])
ax.set(title='Held-out course comparison',xlabel='Course seed',ylabel='Measured reward')
if seeds: ax.legend(fontsize=8)
else: ax.text(.5,.5,'No completed evaluation',ha='center',transform=ax.transAxes)
ax=axes[2]
points=[]
for row in valid:
    probs=[]
    for event in row.get('events',[]):
        if not isinstance(event,dict) or event.get('type')!='decision' or event.get('outcome')!='applied': continue
        for p in (event.get('probabilities') or []) if isinstance(event.get('probabilities'),list) else []:
            if isinstance(p,dict) and p.get('choice')==event.get('action') and isinstance(p.get('probability'),(int,float)) and 0 <= p['probability'] <= 1:
                probs.append(p['probability'])
    if probs: points.append((sum(probs)/len(probs),row['reward']))
if points: ax.scatter(*zip(*points),color='#174f80',alpha=.8)
else: ax.text(.5,.5,'No probability/outcome pairs',ha='center',transform=ax.transAxes)
ax.set(title='Probability evidence (descriptive)',xlabel='Mean chosen-action probability per episode',ylabel='Episode reward',xlim=(0,1))
for ax in axes: ax.grid(axis='y',alpha=.2); ax.set_ylim(bottom=0)
interrupted=len(rows)-len(valid)
fig.supxlabel(f'{len(valid)} valid episodes · {interrupted} interruptions excluded from reward · small sample, no causal or calibration claim\nReward = 10 × obstacles + 2 × coins + 0.1 × active seconds. Hosted model weights unchanged.',fontsize=9)
destination.parent.mkdir(parents=True,exist_ok=True)
fig.savefig(destination,metadata={'Description':'Generated from real exported episode records; no synthetic performance points.'})
print(f'Wrote figure from {len(rows)} real episode records: {destination}')
