# Live AI progress checkpoint

The public original game is unchanged. This repository contains the independent local AI spectator, real Decisions API control, video recording and full JSON decision exports.

## Latest observed real run

- Nine applied model decisions, all flap.
- One obstacle passed, one coin collected.
- Game over after approximately four seconds; no rate-limit error during this run.
- Last response 184 ms.
- Observed through the live spectator UI; this summary is not a replacement for a downloaded frame-by-frame log.

Forty-one automated tests and the public asset build passed at the checkpoint. Startup preparation, late-answer rejection, stop/restart, recording finalization and key-error handling have regression coverage. The first model answer arrives before simulation begins; all later play is at normal speed.

## Learning and next experiment

Repeated flapping at the measured cadence tends to climb. Clearer instructions and compact obstacle geometry alone did not eliminate the all-flap pattern. Next, provide estimated trajectories for both candidate actions using visible physics and latency, leaving action selection exclusively to OpenAI. Compare subsequent runs on survival and obstacles passed; random layouts and network latency prevent causal conclusions from one run.

## Access and billing

The saved replacement key passed independent and local-server checks and the latest consecutive live requests. Prior rate-limit responses conflicted with the paid dashboard; the exact cause was not established. Credentials remain local and ignored by Git. Do not assume all future limits are resolved based on one run.

## Trajectory experiment

Added estimated candidate trajectories for flap and wait, including answer latency, next decision delay, ceiling reset, terminal speed, ground contact and conservative gap margins. A reviewed startup correction uses an estimated 250 ms next-request latency while holding the initial world.

45 tests and the build pass. First trajectory trial ended around one second after flap then wait. After the startup correction, a trial applied three flaps and one wait, then died around two seconds while awaiting another answer; score and coins stayed zero. These trials did not demonstrate better survival than the prior four-second checkpoint. Network timing and randomized courses are confounders.

Next proposed work is an explicit reward-driven strategy-learning experiment with seeded comparison courses, episode logs and an honest learning curve. It does not update hosted model weights.
