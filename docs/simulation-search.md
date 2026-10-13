# Parallel decision search

The experiment compares `balanced-v1`, `upper-caution-v1` and
`ground-caution-v1`, each at 9, 12 and 18 simulation frames per action. Four
isolated VM instances execute the repository's actual `game.js`, with original
60 Hz gravity, flap, collision, coin and ULTRA behavior. Logical geometry is
384 × 216. Hidden future course information is never sent to the model.

For each state, immediate collision, approach and recovery assessments run
concurrently through `gpt-6-luna` Decisions. All calls settle before an action;
valid choice distributions are averaged and ties choose wait. These are
correlated opinions, not independent samples or survival probabilities. The
game freezes while requests run and advances the candidate's exact frame count
after the action. Only this simulation mode removes network latency. The live
controller continues at normal speed with its existing freshness and quorum rules.

Training uses paired seeds starting at 101 and rotates candidate order. A course
counts toward ranking only when all nine candidates complete it with a valid
reward. Reward is `10 × obstacles + 2 × coins + 0.1 × flight seconds`.
Interruptions receive no reward. The highest mean training reward is frozen
before evaluation; ties use candidate ID order. Held-out seeds start at 10001.
Selected and balanced@12 flights alternate order across paired courses.
Evaluation cannot change the selection. Additional 15-second normal-speed
checks compare guidance on seed 200001; simulated cadence and all-three voting
do not transfer automatically.

This is a finite strategy search around a fixed hosted model. It neither finds a
global optimum nor updates model weights. Generalization must be judged on
held-out pairs; training rank alone is insufficient. Prompt strategies,
correlated assessments, finite courses and frozen request timing limit the claim.

## Cost and stopping rules

The single shared guard charges returned uncached input tokens at $0.10 per
million; cache-read, cache-write and output tokens are free for this endpoint.
[Official Decisions pricing](https://developers.openai.com/api/docs/guides/decisions#pricing-and-availability).
Amounts are usage-derived estimates, not a final billing invoice.

Before dispatch, each small text-only request reserves its UTF-8 JSON byte count
plus 4096 tokens at that rate. The guard admits it only when confirmed, uncertain
and pending reservations fit the approved $1.25 total. Invalid usage or any
dispatched failure retains the reservation as uncertain and stops new calls.
There are no automatic retries. Training stops around $0.75 to leave room for
evaluation; evaluation targets total confirmed usage of at least $1. Requests
are paced to at most 20 starts per second; the experiment has a 45-minute,
25,000-call bound. Request allowance reserves can end a phase early.

File-write failure stops new work and waits for dispatched calls to settle.
Existing output directories are refused, so relaunching cannot erase a spend
ledger. A separate new launch does not carry an earlier ledger: do not restart
paid work in another directory under the same cap without accounting for prior
confirmed and uncertain spend.

## Inspectable evidence

- `budget.json`: atomic current confirmed, uncertain and pending cost ledger.
- `api-usage.jsonl`: sanitized per-call token usage, status and rate headers.
- `episodes.jsonl`: complete state, action, probabilities and terminal traces.
- `results.json`: compact episode records, candidate definitions and ranking.
- `selected.json`: frozen training choice and selection rule.
- `summary.json`: paired held-out outcomes, interruptions, spend and target status.
- `live.json`: dashboard snapshot, never credentials or model request headers.

`--mock` performs 18 training flights and six held-out pairs without network
calls or costs. Tests use injected responses and verify budget reservations,
missing usage, failure cleanup, invalid results, paired ranking and dashboard
access boundaries. The original public game and leaderboard are independent.
