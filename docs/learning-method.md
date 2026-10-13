# Strategy learning around a fixed Decisions model

The local spectator adapts **flight guidance**, not hosted model weights. OpenAI Decisions still chooses every flap or wait. The public human game is independent. The hypothesis is that outcome feedback can select more effective guidance within a small time/request budget; a negative result remains a valid result.

```mermaid
flowchart LR
  A[Observed game state] --> B[Fixed Decisions model + selected guidance]
  B --> C[Actual flap or wait]
  C --> D[Normal-speed seeded flight]
  D --> E[Valid episode reward]
  E --> F[Training UCB1 strategy statistics]
  F --> B
  F --> G[Freeze best empirical strategy]
  G --> H[Held-out paired evaluation, no training update]
```

Three server-owned strategies are versioned as `balanced-v1`, `upper-caution-v1`, and `ground-caution-v1`. Current guidance configuration is `flight-guidance-v5`, combining code-derived visible silhouette contact forecasts with concurrent immediate, approach and recovery assessments. Each cohort uses one shared state and one selected strategy; two fresh answers form one action by averaging their choice probabilities. The strategy-learning experiment changes guidance around the fixed model and this fixed aggregation rule. Earlier v1–v4 records remain separately exportable and cannot train v5. Only currently visible observations are supplied; course seeds and hidden future obstacles stay outside model evidence.

Reward is **10 × physical obstacles passed + 2 × physical coins collected + 0.1 × active flight seconds**, with seconds capped at 150. Physical counters survive the visual five-coin reset and ULTRA score multipliers. Preparation remains frozen and contributes no active-flight reward. Game over and a completed episode duration are valid outcomes. Cancel, hidden tab, resize, API errors, budget exhaustion and recording failures are interruptions with **null reward**, never a zero failure reward.

The episode-level UCB1 policy first visits each untried strategy in listed order. Then it maximizes `meanReward + sqrt(2 × ln(totalVisits) / visits)`, with stable listed-order ties. After training, evaluation freezes the strategy with the highest empirical mean, without the exploration bonus. Existing valid training history in the same context contributes to this choice. Contexts partition by model, configuration version, logical playfield width/height and mock flag; resizing never pools incompatible courses. Evaluation and baseline records never update these statistics.

Each batch attempts six training flights on seeds **101, 102, 103, 101, 102, 103**, followed by **balanced 1001, learned 1001, learned 1002, balanced 1002**. The held-out seeds are disjoint from training and the order is counterbalanced. Each episode is bounded to 15 seconds. Preparation and all episodes share **150 wall seconds and 750 issued assessment requests**. Cohorts launch no faster than every 150 ms; three assessments are requested concurrently per cohort, with at most six outstanding calls globally. Two fresh same-cohort answers select one action; responses from a superseded path cannot apply. Raw assessment events keep each returned distribution and latency; aggregate decision events keep the contributing answers and actual action. Episode mean response latency uses returned raw assessments, not the aggregate decision's quorum delay. Parallelism consumes the request allowance faster, so a batch may finish before 150 seconds. Projections estimate the next opportunity with max(150 ms, recent decision latency), use 250 ms after frozen preparation, and expose a 500 ms stress horizon without a safety guarantee. Errors stop the batch and receive no training reward.

The charts render stored episode records immediately, without making paid calls. Training shows actual reward and a trailing mean over the last three valid training flights (or fewer initially); crosses below the axis mark interruptions, without assigning rewards. Held-out comparison groups by experiment and seed, reports each side's valid counts and learned-minus-baseline reward difference, including zero or negative differences. The current geometry/model/configuration/mock context is explicit, with excluded records counted. MOCK data are scripted fixtures, never real evidence. Empty views stay empty.

The third chart is descriptive: one point per valid episode plots its reward against the mean returned probability of its **applied chosen actions**. Discarded or malformed decision distributions are excluded. This is not survival probability, calibration, causal action credit or evidence about unchosen actions. Decisions within one flight are correlated; later actions, geometry, course difficulty and latency confound association. Calibration requires a separately defined target and out-of-sample scoring. These six training flights and two held-out courses are a method smoke test, not evidence of general superiority or guaranteed improvement.

## Reproduce and inspect

1. Run `npm test` and `npm run build` with Node 22 or newer.
2. Run `npm run ai:mock`, open `http://127.0.0.1:8789`, and use Start experiment. MOCK is visibly marked; it makes no OpenAI calls.
3. For an authorized real batch, configure the server-only ignored `.env` as described in the README, restart with `npm run ai`, and explicitly select Start experiment. Recording is optional and captures strategy/phase across the continuous batch.
4. Download Export experiment JSON, and download the video when recording finalizes. Export includes observations, both returned probabilities, chosen action, timing, applied/discarded status, context, episode counters/reward, interruption reasons and statistics. Preserve unsuccessful outcomes and incomplete pairs.
5. Keep geometry fixed and the tab visible. Local storage retains history; incompatible or invalid episodes are ignored with a notice. Storage failure retains the current in-memory export. A clean browser profile gives a fresh-history batch; the existing-history behavior above is intentional.

Do not infer token costs when not measured. Larger or parallel batches require separate authorization and independent environments; the bounded demonstration does not establish reward gain per dollar. See [research hypothesis](research-hypothesis.md) for the claims and limits.

Cold preparation latency remains recorded, but the first live forecast starts with 250 ms; subsequent live replies supply measured latency.

Manual Start and Restart use the empirical best strategy from valid training episodes matching the current model, guidance version, logical playfield dimensions and mock mode. Without matching training, they use `balanced-v1`. The strategy stays fixed for the flight; Restart reads the latest local records. Live decisions and recordings show the active strategy and phase, and manual JSON exports include the strategy and guidance version. Manual flights do not add training episodes. This selects prompt guidance; it does not train model weights.

For v5, probability-versus-reward charts describe the **mean contributing choice probabilities** of applied aggregate actions. They do not calibrate success odds, establish independent votes, or assign causal credit to one assessment.
