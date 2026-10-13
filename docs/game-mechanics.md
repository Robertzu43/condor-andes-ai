# Flight mechanics and code-based decision evidence

The source of truth is `game.js`, not the reward chart. The Decisions provider uses the same frame update and tests forecasts against the actual game in a Node VM. Every live input remains the model's choice.

| Mechanic | Actual implementation | Decision implication |
|---|---|---|
| Time | Fixed steps of 1/60 second | Interpret velocity and tap spacing in frames, not render pixels. |
| Tap | Replace vertical velocity with -5.2; no additive thrust | Repeated taps restart the upward arc and can climb into rock. |
| Gravity | Add 0.35, cap fall speed at 8, then move y | An isolated tap from rest rises about 36 px; its last upward frame is 14 (~233 ms). |
| Coordinates | Positive y points down; 20x14 hitbox offset 2x10 from sprite | Use collision coordinates, not the whole rendered sprite. |
| Ceiling | Sprite y clamps to -8, velocity resets to zero | Hitbox top clamps to 2; ceiling contact changes the subsequent arc. |
| Ground | Hitbox bottom >= ground ends play | Ground is fatal even with ULTRA or invulnerability. |
| Rocks | Strict overlap with individual top/bottom rows, width >2, plus broad-phase cutoff | A rectangular gap warning is conservative and can be harmless. |
| Scroll | Start at 2 px/frame, rise with score to 3.5 | Mountains move while the API is answering. |
| Course | Gaps start 92–98 px, narrow toward 64–70; centers drift; seeded ridge silhouettes | Exact visible rows are available; future off-screen course data stays hidden. |
| Coins / ULTRA | Five coins activate protection; a rock hit consumes it and gives one second invulnerability | Geometric contact is not automatically death; ground remains lethal. |
| Timing | First quorum holds the world; later assessment cohorts overlap without pausing play | Forecast the state when an answer arrives, not only the stale request state. |

## Audit finding and correction

Previous forecasts used rectangular corridor margins for rock risk and did not state the first contact against the actual silhouette. The new `flight-guidance-v4` evidence includes `silhouetteAvailable`, `arrivalRockContactFrame` before the answer, and each flap/wait candidate's `firstRockContactFrame` under nominal and 500 ms stress horizons. The provider prioritizes silhouette contact over rectangle warnings. Null contact only means no predicted contact inside that horizon; missing rows are explicitly marked unknown.

A deterministic differential test executes the actual `step()` and `hitRock()` functions across three seeds, four heights, flap/wait and zero/200 ms request delay. It validates arrival contact and 34 still-active candidate paths: 26 actual rock contacts and three rectangular warnings without actual rock contact. This verifies a real mismatch in the *precision of evidence*, not proof that it caused every previous crash. It makes no paid calls.

Snapshots now record `lastFlapFrame` and `deathCause`. Each applied decision exports `appliedState`, and the stop event exports terminal `gameState`, so request state, action effect, timing and collision cause can be traced separately. Manual flights remain outside training rewards.

The input changed, so v4 selects only compatible v4 training. Previous learned strategies and results remain preserved under their original versions; they are not silently treated as trained on these new inputs.

## Limits

These are constant-speed, no-additional-input projections against currently visible silhouettes. They extrapolate beyond first geometric contact and do not simulate future coin-triggered protection changes, newly visible mountains, score-driven speed changes or network jitter. The model can still choose a poor action, and an answer can arrive too late. No hosted weights were trained, and no safe or long flight is claimed from passing mechanics tests.

## Live smoke check

One recorded real v4 manual flight applied ten decisions, all flap, then ended with a **rock collision** at about four seconds; score and coins were zero. The request/answer labels finalized correctly, recording was ready, and browser console errors were absent. This confirms that the new input and cause tracking are connected, not that the strategy is now good. No controlled survival improvement is claimed. Sustained repeated flaps despite factual forecasts indicate that gap-approach planning and the interpretation of nominal versus stress horizons still need evaluation. The next useful comparison is the model's selected path against its forecast and actual applied state on a fixed course, not another reward-only random search.

All 85 application tests and the public build pass. Independent review found no blocker; forecasts were checked against the actual game rather than another copy of the prediction formulas. The original public-game repository and its deployment remain untouched.

## Concurrent control (v5)

Three lenses assess immediate contact, approaching gaps and flight recovery for the same projected observation and fixed strategy. The controller averages the first two fresh same-cohort answers and executes one flap/wait. It never combines different snapshots into one vote. Up to six requests may be outstanding, with new cohorts at least 150 ms apart. A flap invalidates every pending assessment based on the previous path; closed-cohort, stale, canceled and old-run responses cannot execute actions. Stop/restart and the shared request/time budgets remain binding, including requests whose canceled providers have not settled. The server's six-active/30-per-second admission limits are local safeguards, separately labeled from OpenAI limits. This aggregation is application logic around model judgments, not a learned survival model or a guarantee of improved flight.

## Live concurrent smoke check

A recorded real v5 manual flight visibly began with three pending assessments. It issued 53 assessment requests, applied nine aggregate actions (two contributing answers each), and ended on rock at about three seconds with zero score/coins. The final cohort identifier was 17; this is not a count of applied actions, because superseded cohorts cannot act. All nine applied actions were flap. Final state showed zero pending assessments and recording ready; browser console errors and API-error interruption were absent. Raw request counts are issued attempts, not verified billed/returned answer counts. This verifies concurrent control and quorum application, but neither improved survival nor the quality of the consensus. The complete events remain in the app's decision export; no separately downloaded video was inspected. The test was manual, so it did not update training statistics.

All 88 application tests and the public build pass. Independent review checked concurrency, freshness, path invalidation, admission bounds, restart isolation and exports without finding a blocker. The experiment runner now ends on budget when fewer than two calls remain, avoiding an unusable one-call episode. Requests remain bounded, but parallel correlated judgments can repeat the same mistake and consume allowance faster.
