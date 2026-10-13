# Research hypothesis: fast decisions with outcome feedback

The condor is a visible test environment, not the scientific claim. We test whether fast decisions plus measured outcomes and a reward-driven strategy update can improve held-out performance within a practical request and time budget.

## Claims and evidence

| Claim | Measurement |
|---|---|
| Decision service is fast enough for control | Request latency distribution, late answers, decisions/second |
| System adapts from outcomes | Versioned strategy counts, empirical reward means and explicit exploration choices |
| Adaptation improves generalization | Frozen learned strategy vs fixed balanced baseline on disjoint held-out courses |
| Adaptation is efficient | Reward gain per request and elapsed time; cost only when measured |

## Scope and limits

The first implementation is an episode-level bandit over fixed strategy guidance, around an unchanged hosted model. It is not weight training or a full per-action reinforcement learner. Every flap/wait still comes from Decisions. Six training flights and two evaluation courses are a smoke test of the method, not strong evidence of general superiority.

Returned choice probabilities are not survival probabilities. A49% choice can succeed or fail; one result does not determine calibration. Track the state, both probabilities, chosen action, latency and subsequent outcome. Association with episode reward is descriptive: later actions, course difficulty and latency confound credit assignment, and many decisions from one flight are correlated. Unchosen outcomes are not observed. Probability calibration would require a separately defined binary/multiclass target and out-of-sample scoring.

Independent episodes could be collected in parallel in a later experiment. Within a flight, actions remain sequential because state depends on prior actions. Parallelism increases sample throughput; it does not itself cause learning. Scaling must retain budgets, independent environments, versioned policies and a held-out evaluation protocol.

## Honest reporting

Publish the method and all valid outcomes, including regressions. Keep interruptions separate. Freeze evaluation strategies before looking at evaluation outcomes. A failed hypothesis is informative; do not manufacture a rising graph. To support stronger claims, expand repeated seeds, compare uncertainty and test independent tasks rather than generalizing from one game.
