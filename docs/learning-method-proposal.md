# Proposed learning experiment

Status: design proposal, not implemented.

## Purpose
Show how a Decisions-controlled condor can improve through feedback, without claiming that the hosted model is retrained or that every flight improves.

## Recommended method
Use an episode-level contextual-free multi-armed bandit to select from three versioned strategy configurations: balanced flight, extra upper-gap caution and extra ground caution. Each configuration changes guidance presented alongside identical observed state and candidate trajectories. OpenAI chooses every flap or wait. No local policy overrides its answer. A bandit is a limited reinforcement-learning formulation; this is strategy adaptation around a fixed hosted model, not model-weight training.

After each valid completed episode, reward = 10 * obstacles passed + 2 * coins collected + 0.1 * active flight seconds, with flight time capped at150seconds. API failures, hidden-tab stops and manual stops are recorded as interrupted, not treated as strategy failures or given learning rewards. Exploration deliberately tries alternatives and may perform worse. Persist strategy counts, mean rewards and versioned episode records locally.

## Evaluation
Add deterministic AI-only course seeds. Use a small training seed set for adaptation and a disjoint fixed evaluation set. Compare the original fixed strategy against the learned selection using the same evaluation courses, repeated trials and the same request cadence. Do not tune on evaluation results. Report raw episode reward, obstacles, survival, coins, latency and interruption reason. Keep unknown token cost unknown.

Plot reward by episode, a clearly labelled trailing mean, and baseline-versus-adaptive evaluation results. Include failed valid flights; separate infrastructure failures visibly. Render plots from real logs only. No fabricated rising curve and no claim of guaranteed improvement.

## Product flow
Keep manual recorded runs. Add a Learning experiment panel with selected strategy, valid completed episodes, best measured strategy, reward and chart. Batch experiments require an explicit bounded Start experiment action, with a shared request and wall-time cap, cancel control, rate-limit stop and no automatic restart after account errors. Retain server-only credentials, loopback binding and original public-game isolation.

## Alternatives
1. Manual prompt experiments are simpler but do not constitute automatic learning.
2. Recommended bandit learns which strategy configuration to use; interpretable and small enough for this demo.
3. Training a separate local action policy is a broader RL project and would change the claim that Decisions chooses every action.

## Validation
Test reward calculations, interrupted-run exclusion, deterministic seed isolation, bandit updates/exploration and persistence, budget cancellation and baseline/evaluation split. Validate actual browser display and a small explicitly bounded real API batch before publishing a performance claim.
