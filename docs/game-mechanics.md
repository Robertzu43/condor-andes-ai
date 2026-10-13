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
| Timing | First answer holds the world; later requests do not; server reports remaining 200 ms acceptance cooldown | Forecast the state when an answer arrives, not only the stale request state. |

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
