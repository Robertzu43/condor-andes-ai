# Task 3: bounded orchestration and app integration

Implemented runner, validated smaller controller start bounds, seed/strategy forwarding, shared budgets, six training seeds and frozen counterbalanced held-out trials. Cancellation is terminal to the queue; pending answers are discarded and retained before episode record resolves. API errors, geometry changes and interruptions stop the remaining batch; reward remains null. Physical reward and context-partitioned training reuse Task 2 functions.

App adds distinct Start experiment/Cancel controls, disabled conflicting manual starts, local persisted records with visible load/save notices, an actual visible blob download anchor, and accessible full JSON details. A selected recorder remains active across episode restarts; cancellation finalizes recording immediately, including when waiting for an aborted transport to settle. Completion finalizes once. Credentials remain server only. Manual run behavior remains unchanged.

## Task 4 interface

- `createExperiment({runEpisode,onUpdate,now,stats})` exposes `start()`, `stop(reason='cancelled')`, `state`.
- State fields: `running`, `experimentId`, `context` (model/configVersion/mock/dimensions), `records`, `stats`, `reason`, `phase`, `strategyId`, `requests`.
- App dispatches `document` event `learning-update` with `detail:{...state,allRecords:learningRecords}` at every update. Subscribe before starting an experiment. Stored/current evidence is also rendered as JSON inside `#experiment-records`; chart module can use this as fallback initial current-batch state. Initial persisted historical records are not yet dispatched until starting a batch.
- UI wrapper `#learning-panel`; controls `#experiment-start`, `#experiment-cancel`; statuses `#experiment-status`, `#learning-notice`; visible download anchor `#experiment-export`.
- Run callback opts: seed, strategyId, phase, experimentId, durationMs, maxRequests, signal. Callback resolves schema-1 episode with full events (observations, complete probabilities, timings, action and outcome). Every interruption is retained.
- `controller.start({seed,strategyId,durationMs,maxRequests})`, default manual behavior preserved. Explicit duration ends as `duration`; request bounds end as `budget`. `controller.waitForIdle()` resolves after pending decision settles to include late discarded probability data; production fetch is abortable and server transport has timeout.
- Recording overlay includes current batch phase and strategy.

## Verification

Observed new bounded controller test fail before production edits. New runner suite initially failed because module did not exist. Runner tests cover prescribed split/freeze, cancel during preparation with late result, shared wall and request ceilings, API failure and mismatched dimensions. Controller test additionally verifies waiting for a cancelled response retains discarded decision evidence. Full `npm test`: 64 passing. `npm run build`: passed, public allowlist unchanged.

Skipped browser/media permission checks and real API calls, reserved for parent. Plot design belongs to Task 4. Browser storage and recording integration still require visible-browser verification; no result claims made.
