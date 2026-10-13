# Live Decisions Spectator Implementation Plan

**Goal:** Implement the approved local game-data-driven AI player with a side-by-side decision display and synchronized video/log exports.

**Architecture:** Keep the original repository and public deployment untouched. Build in a separate condor-andes-ai repository using a credited copy of the game at upstream commit 723a252. Add a loopback-only Node server, a gated game bridge, a pure async controller, and a separate spectator/recorder frontend. Serve the local game in an iframe so its existing rendering and input remain isolated.

**Tech stack:** Native JavaScript modules, Node HTTP and fetch, Canvas, MediaRecorder, node:test. No runtime packages required.

**Spec:** condor-live-ai-design.md (repository copy: docs/superpowers/specs/2026-10-12-live-ai-design.md).

## Global constraints

- Real model: gpt-6-luna, OpenAI POST /v1/decisions with choice answers flap/wait.
- Use structured observations only, with visible obstacles, not future random state.
- One outstanding request; maximum five requests per second, 150 seconds or 750 requests per run.
- Simulation remains at 60 Hz. Apply each flap once. Drop answers over 250 ms old or for a different run. Stop/pause after three consecutive stale answers, API failure, refusal, or malformed answer.
- Keep secrets server-side and bind only to loopback. Serve only explicit assets, validate origin/host, bound request sizes and request duration. Explicit mock mode must be clearly identified everywhere including exports.
- Existing production assets and leaderboard behavior for humans remain intact. AI sessions never submit scores.
- OpenAI-inspired light UI: game left, decisions right, provider and model labels, progress and decision history, video and JSON exports. Mockup is visual reference, not proof of performance.

## Review focus

- Late responses after restart or stop must never apply to the next game.
- Browser visibility changes and resizing cannot silently reset or advance a recorded AI run.
- Recording errors and unsupported codecs must give actionable messages and never claim saved video.
- Arbitrary websites or non-loopback clients must not invoke the paid local API bridge.
- Secrets, local files, and AI runs must not leak into public deploy bundles or score submissions.

## Task 1: Game bridge, Decisions server, and live controller

Files: game.js (gated hook only), ai/server.mjs, ai/decisions.mjs, ai/controller.js and focused ai/*.test.js, package.json and README.md setup scripts/docs.

Interfaces:
- Game iframe at /index.html#ai on loopback exposes window.condorAI with start(), flap(), pause(), resume(), snapshot(), canvas. start starts active normal play; pause stops simulation; snapshot returns serializable observed fields, state, frame, score, coins, mode and visible mountains; expose readiness to parent via iframe load/poll.
- POST /api/decision accepts {observation, previousAction, latencyMs}; response {action, probabilities:[{choice,probability}], confidence, model, mock}. GET /api/status returns {configured,model,mock}. Server reads OPENAI_API_KEY without returning it. Explicit --mock flag never calls real API. npm run ai starts local server on 127.0.0.1:8789.
- createController({game,decide,onEvent,now}) returns start(),stop(reason), state; game is the bridge, decide(payload,{signal}) returns normalized response. Events carry type, runId, sequence, observation, action, probabilities, timestamps, latency and applied/discarded outcome as appropriate. Export constants and document exact event shape for Task 2 in the implementation report. Controller owns duration/request limits and stops on game over. Pause game on stop or error. No hidden autopilot.

- [ ] Write focused tests for observation isolation, request payload/answer validation, origin and file restrictions, one-shot flap/wait, stale responses, stop/restart races, limits, death, and missing-key/mock distinction. Demonstrate expected failures before implementation.
- [ ] Implement minimal game hook, server, normalized Decisions client, and async controller. Read official Decisions examples saved at work/decisions.md outside repository. Reject non-finite or excessive input; do not return upstream secrets in errors.
- [ ] Run focused tests then npm test and npm run build; record evidence and exact frontend contracts.
- [ ] Commit Task 1; independent review checks spec and quality before Task 2.

## Task 2: Spectator UI, synchronized recording, and integration

Files: ai/index.html, ai/style.css, ai/app.js, ai/recorder.js, tests for recording/export behavior; README.md finalized. Modify Task 1 files only for integration defects and document them.

Consume Task 1's documented bridge/controller/server contracts. Serve spectator at /, iframe game at /index.html#ai. Match the approved outputs/condor-openai-style-mockup.png: original colorful game at left, latest action/probabilities/history/progress at right, observed state below gameplay, recording controls at bottom. Provider label Powered by OpenAI Decisions API, actual model label, and clearly marked mock/no-key states. Use available system geometric sans-serif fallback, not a false claim that official OpenAI Sans is installed.

- [ ] Implement accessible responsive UI, Start/Stop/Restart, error/status feedback, and real controller event wiring. No sample metrics unless explicitly mock mode.
- [ ] Compose game canvas and live decision information in a separate fixed-size recording canvas. Use captureStream plus runtime-supported MediaRecorder MIME type; include both columns and pending/error/pause states. Do not infer hidden reasoning. Abort recording start cleanly if unsupported.
- [ ] Export a playable video and JSON observations/actions with timing, errors, mode, provider and model. Revoke object URLs when replaced; stop tracks on recorder disposal. Preserve completed recording on session stop and prevent overlapping runs/recorders.
- [ ] Add behavior tests for export lifecycle and failures. Run the existing suite and build. Verify public build remains free of local AI server or secrets.
- [ ] Commit and report. Parent performs browser end-to-end validation with explicitly mock API, screenshot review, and a real run only if credentials are configured. Independent final branch review follows, then create the separate private repository and a draft pull request against its imported baseline. Never push to Robertzu43/condor-andes.

## Execution

User explicitly approved the design and requested execution using agents where useful. Run these two dependent implementation tasks sequentially with independent reviews, while parent handles environment and browser verification. No further design permission is required. Real API testing depends on a locally configured key; development and mock verification proceed without it.
