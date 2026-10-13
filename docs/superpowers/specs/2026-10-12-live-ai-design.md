# Cóndor de los Andes: live AI player

Status: approved for implementation; user authorized agent-assisted execution on October 12, 2026.

## Intended result

Codex builds a separate repository, condor-andes-ai, for an AI spectator app using a credited MIT-licensed copy of the game. The original repository and its public deployment must remain untouched. The user has selected structured game data as the model's observation. OpenAI makes live flap/wait decisions while the game runs. A recording captures the actual gameplay and the visible decisions together.

## First version

Run the AI mode locally on the user's computer. A local server serves the game and calls OpenAI with a server-side OPENAI_API_KEY. The browser never receives the key. This gives a concrete recording workflow without introducing a public paid API endpoint. Publishing an AI mode on Cloudflare is a later scope choice.

Use the Decisions API with gpt-6-luna and a choice question with two options: flap and wait. These are the only automatic flight inputs. There is no heuristic autopilot. The existing gravity, collisions, mountain generation, scoring, and ULTRA rules remain the game engine's responsibility.

## Observation and control

Capture a snapshot with a run identifier, sequence number, simulation frame and timestamp; playfield dimensions; condor hitbox, vertical position and velocity; gravity and flap impulse; horizontal scrolling speed; visible mountain locations and gap bounds; visible coin locations; score, mode, and invulnerability time. Do not expose future random obstacles.

Make at most one model request at a time, initially capped at five requests per second. Each question asks which action should be applied once when the response arrives. Include the previous action, its frame, and the most recent measured latency so the model can account for motion during the request. Continue rendering and simulating at the existing 60 Hz while awaiting a response. Waiting for a response does not repeat a previous flap.

Apply flap exactly once for a valid flap answer; wait applies no impulse. Tag all results with their snapshot and run identifiers. Discard results after death, stop, restart, or a changed run identifier. Reject responses older than 250 ms of wall-clock snapshot age, log them as stale, and request a fresh observation. The age threshold is a proposed starting value, to be evaluated with measured latency; it is not a claim that the API can meet it.

On request failure, refusal, malformed answer, or three consecutive stale responses, stop AI control and pause the local AI session with a visible explanation. Do not switch silently to scripted play. Provide Start, Stop, and Restart controls; stop aborts outstanding requests. Limit a run to 60 seconds or 300 requests, whichever comes first.

## Live display and recording

Visual direction: the user approved the left-game/right-decisions layout and requested OpenAI-inspired colors and typography with clear provider attribution. Use off-white, near-black text, subtle gray borders, restrained green status indicators, and an approachable geometric sans-serif. Show “Powered by OpenAI Decisions API” and the actual configured model next to the decision panel. Keep Cóndor de los Andes as the primary product identity. The revised mockup is illustrative, not proof of an implemented API connection. Use a suitable available font until access to OpenAI Sans is established.

Use a two-column spectator layout: the live game on the left and a live decision/progress panel on the right. This layout is explicitly requested by the user. The right panel shows the current model action prominently, its returned option probabilities, request latency, and whether the action was applied or discarded. Beneath it, maintain a timestamped scrolling history of actual model decisions and their outcomes. Show game progress continuously: score, coins toward ULTRA, current mode, elapsed run time, and game status. Keep the latest observed height, vertical velocity, and upcoming gap available as concise context for each decision. Update the panel from actual model responses and game events, never from scripted placeholder decisions. During an outstanding request show that a decision is pending; distinguish a returned choice from an action applied to the game. Probabilities are model outputs, not proven chances of surviving. The display does not claim to expose hidden reasoning or invent a narrative explanation.

Use a separate capture canvas to compose the actual game canvas and decision panel into one video. Record that canvas using a browser-supported MediaRecorder format, choosing a supported MIME type at runtime. Export the video and a JSON decision log. Include wall-clock timestamps, simulation frames, observations, actions, probabilities, latency, application/discard status, and errors in the log. Mark pauses and failures visibly in the recording. Check recording support before starting a recorded run.

Keep AI sessions out of the public human leaderboard. The recording should identify itself as model-controlled, normal-speed gameplay. No voiceover or background music is included in this first version.

## Contribution scope

Add a small game observation/control interface, a local spectator page, a local API bridge, recording and log export, focused tests, and setup documentation. Keep the copied public build allowlist and human play flow working; never push changes to the original game repository. Create the new GitHub repository as private initially, with an attributed source baseline and a reviewed feature pull request. Do not deploy the new app automatically.

## Validation

Test snapshot contents, one-shot flap application, wait behavior, stale responses, run isolation, stop/restart, API failures, recording support handling, and suppression of AI leaderboard submissions. Run existing tests and the deployment build. Exercise the full browser flow with a clearly labeled mock before a real API run.

For a real run, measure request latency, action rate, stale-response rate, score, and recording/log synchronization. A successful end-to-end run is evidence of integration, not a promise of strong game performance. If latency prevents normal-speed play, report that result and discuss an explicitly labeled slower simulation instead of presenting it as real-time success.

## Prerequisite for real model play

An OpenAI API key with Decisions API access must be configured locally. Do not paste the key into chat. A real gameplay video cannot be claimed until the live API run and recording have been verified.

## Reference

OpenAI Decisions API: https://developers.openai.com/api/docs/guides/decisions
