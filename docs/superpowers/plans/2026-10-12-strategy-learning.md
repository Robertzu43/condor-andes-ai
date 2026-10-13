# Reward-driven strategy learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Learn which flight guidance performs best from measured rewards, and show an honest comparison with fixed guidance.

**Architecture:** An episode-level UCB1 bandit selects one of three fixed, versioned guidance variants. A bounded experiment runs training courses, freezes its selected strategy, then compares it with balanced guidance on held-out courses. The hosted Decisions model continues to choose every action. Local episode records drive charts and exports.

**Tech Stack:** Existing Node22+, native JavaScript modules, browser SVG/Canvas, localStorage, node:test. No new runtime dependencies.

**Spec:** ../../learning-method-proposal.md (approved in conversation).

## Global Constraints
- Model weights are not trained; label the feature strategy learning around a fixed model.
- Reward =10*obstaclesPassed +2*coinsCollected +0.1*activeFlightSeconds (seconds capped150).
- Only game-over and completed per-episode duration are valid learning outcomes. API errors, budget cancellation, hidden/resize, manual stop and recording errors are interruptions with null reward.
- Original public game, normal simulation speed and model-only action selection stay intact.
- Credentials stay server-only and ignored by Git. No future course information enters observations.
- Total experiment cap150wallseconds and750requests, shared across all episodes; stop on any API error.

## Review Focus
1. Coin counter resets and ULTRA double-score must not corrupt physical coin/obstacle counts (Task1).
2. Same seed and geometry must reproduce the course; portrait/resize must not be pooled with landscape (Tasks1,3).
3. Interrupted, duplicate or mock episodes must not contaminate learned real strategy statistics (Task2).
4. Stop or exhausted budget must prevent a queued restart or late action (Task3).
5. Empty or worse results must remain visible; held-out evaluation must never update learning (Tasks2,4).

### Task1: Repeatable AI courses and exact metrics
**Files:** game.js, ai/bridge.test.js.
**Interfaces:** condorAI.start({seed}={}); snapshot adds courseSeed, obstaclesPassed, coinsCollected and activeFlightSeconds=frame/60. Unseeded human play retains Math.random. AI seeded RNG resets before spawnPair; validate unsigned32-bit integer seed. Existing condorAI.start() remains compatible.
- [ ] Add failing bridge tests: equal seed and fixed geometry reproduce visible mountains through identical frame/action replay; different seed differs; human random flow unchanged.
- [ ] Add counter tests: one passed obstacle remains one even in ULTRA, fifth coin does not reset coinsCollected, active seconds exclude frozen preparation.
- [ ] Implement a small seeded RNG used only by AI course generation and cumulative counters reset per run.
- [ ] Run node --test ai/bridge.test.js then npm test and npm run build; commit.

### Task2: Pure learning policy and versioned records
**Files:** new ai/learning.js and ai/learning.test.js; ai/decisions.mjs and tests.
**Interfaces:** STRATEGIES=[balanced-v1,upper-caution-v1,ground-caution-v1]; selectStrategy(stats,{explore=true}) returns strategyId; scoreEpisode(record) returns finite reward or null; updateStats(stats,record) returns new stats; deserializeLearning(text) validates schemaVersion1 and deduplicates episodeId. Record contains episodeId, experimentId, phase(training/baseline/evaluation), strategyId, courseSeed, dimensions, model, mock, obstaclesPassed, coinsCollected, activeFlightSeconds, requests, meanLatencyMs, reason, reward and events.
- [ ] Tests first: reward(2obstacles,3coins,10seconds)=27; interruption=null; invalid/negative/nonfinite counters rejected; duplicate records do not update twice; evaluation and mock records never train real statistics.
- [ ] Implement deterministic UCB1: visit untried arms in listed order; otherwise maximize meanReward+sqrt(2*ln(totalVisits)/visits), stable tie order. Frozen best maximizes empirical mean only. Partition learned statistics by model/config version and logical dimensions; bad stored JSON starts empty with visible notice.
- [ ] Add request test that an allowlisted strategyId becomes a fixed server-owned guidance string; reject arbitrary instructions or unknown IDs. Preserve balanced behavior for manual run without strategyId.
- [ ] Run focused tests, full suite/build; commit.

### Task3: Bounded experiment orchestration
**Files:** new ai/experiment.js and tests; ai/controller.js and tests; ai/app.js; ai/server.mjs static allowlist; README.md.
**Interfaces:** controller.start({seed,strategyId,durationMs=150000,maxRequests=750}={}) uses only smaller validated bounds; existing start() compatible. Request carries strategyId. createExperiment({runEpisode,onUpdate,now}) exposes start(),stop(),state; runEpisode({seed,strategyId,phase,durationMs,maxRequests,signal}) resolves a record and cannot silently retry errors.
- [ ] Test stop during preparation, late result after cancellation, walltime/request ceiling across episodes, and failure aborting remaining queue.
- [ ] Run six training episodes using seeds101,102,103 twice, at most15seconds per episode. Choose strategy each training episode using UCB1. Freeze best strategy after training. Run balanced and frozen strategy on seeds1001,1002 in counterbalanced order (baseline1001,learned1001,learned1002,baseline1002), never training on these outcomes.
- [ ] Tests prove disjoint seed sets, frozen evaluation strategy, identical paired logical geometry and no evaluation updates. Record incomplete batch honestly and include every interruption.
- [ ] Integrate Start experiment and Cancel separately from manual controls. Disable conflicting manual start/restart during batch. Preserve a shared request budget even when a call is aborted. Preparation counts toward walltime but not active-flight reward.
- [ ] If recording selected, use one continuous session recording across episode restarts and finalize on experiment end/cancel. Export experiment JSON contains all episode events, metadata and statistics. Validate browser storage errors do not lose current in-memory records.
- [ ] Run full suite/build; commit.

### Task4: Learning display and repository method
**Files:** new ai/learning-view.js; ai/index.html, ai/style.css, ai/app.js, ai/server.mjs; docs/learning-method.md; README.md.
- [ ] Render selected strategy, completed valid episodes, best training mean, evaluation means/counts and an explicit small-sample note. Plot actual reward by episode with trailing mean over last3valid training episodes; interruptions use distinct markers and no invented reward. Baseline/evaluation plot shows paired seed results and sample counts.
- [ ] Show empty state until data exists. Separate mock fixtures from real evidence; validate malformed record handling and no evaluation leakage with pure chart-series tests.
- [ ] Include the selected strategy/phase in session recording. Add readable method diagram, reward definition, exploration rule, seed sets, limits, caveats and reproduction steps to repo. Never claim retraining or guaranteed rising performance.
- [ ] Test the complete mock batch in visible browser: start/cancel, chart, export, recording finalization and mobile fit. Then run one bounded real batch only within existing authorized demo cap; preserve all results, including regressions, and generate a repo SVG from genuine exported records if available.
- [ ] Independent final review, full tests/build, secret exclusion check, commit/push to current separate repository branch and update existing draft PR.

## Execution and acceptance
Use the already selected agent-assisted method: implementation tasks sequentially with independent review at boundaries; parent owns browser and paid calls. Success means a working reproducible learning loop and faithful graph, not a predetermined performance gain. Report measured results and limitations; leave the app open. Larger paid batches require a new explicit request.

## Approved-intent clarification: probability evidence
Keep each choice distribution with observation, selected action, timing and later episode result. Add a descriptive chosen-probability/outcome view alongside reward charts; label choice probability as distinct from survival probability. Do not claim calibration, infer that an unchosen action would succeed, or count correlated decisions within one flight as independent experiments. The first loop adapts strategy settings from episode rewards; learning probability calibration or model weights requires a separate defined target and evaluation. Parallel independent rollout workers are a future scaling path, outside this first bounded visible experiment.
