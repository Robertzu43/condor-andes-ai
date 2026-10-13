# Cóndor de los Andes — local AI spectator

This separate repository credits [robertzu43/condor-andes](https://github.com/robertzu43/condor-andes), copied from upstream commit `723a252` under its original MIT license (preserved in LICENSE). The original repository and public game are independent of this local experiment.

Node.js 22 or newer is required. There are no runtime dependencies.

```sh
npm run ai:mock
```

Open http://127.0.0.1:8789 to use the spectator. Mock mode always answers **wait**, makes no OpenAI calls, and is visibly marked MOCK in the page, recordings and logs. Direct bridge inspection is available at `/index.html#ai`.

For real decisions, copy `.env.example` to `.env`, set `OPENAI_API_KEY` locally, and run `npm run ai`. Restart the server after configuring the key. Never commit the key or paste it into chat. `/api/status` reports whether a key is configured without returning it. Real mode uses `gpt-6-luna` through OpenAI POST `/v1/decisions`. Missing credentials pause play; no automatic scripted fallback exists.

Control runs are limited to 150 seconds / 750 requests and at most five decisions per second, with one request at a time. Answers older than 500 ms are discarded; three consecutive stale answers pause the game. Death, stop, hidden pages, and resizing freeze AI control. AI play never submits to the human leaderboard. Real API play has been verified in short trials. The latest checkpoint applied nine decisions, passed one obstacle and collected one coin before game over at about four seconds; this is not a validated long-duration demo.

```sh
npm test
npm run build
```

The public build remains an explicit game asset allowlist and excludes the local server, credentials, spectator and AI controller. Deployment scripts and the original Cloudflare binding have been removed to prevent accidental deployment to the upstream project. The original human score function remains credited source material; the local server does not serve it.

## Human game

Use Space or tap to flap. Collect five Inti coins to enter ULTRA ANDES. The copied game assets preserve the original physics, rendering and human input. Open `/index.html` for human play; `/index.html#ai` enables local structured controls.

## Spectator controls and exports

Start begins a normal-speed model-controlled run; Stop pauses it; Restart ends the current run and begins another. The panel displays actual choice probabilities and applied/discarded outcomes. During requests it explicitly displays Pending. The observation summary is the latest snapshot sent to the model, while game progress updates continuously. No hidden reasoning is shown.

Enable **Record this run** before Start. Recording captures the real game canvas and the live decision/progress panel together at 30 frames per second, with visible mock, pending, pause and error labels. A supported MediaRecorder codec is selected at runtime (usually WebM in Chrome); unsupported recording blocks the recorded run with an explanation. Stop, death or controller failure finalizes the video, then **Download video** saves it. **Export decisions** saves the complete run events, observations, returned probabilities, frames, timestamps, errors and mode as JSON. Restart replaces the previous run and exports, so download them first. Recording needs a visible browser tab; hiding the page ends control.

The local game permits its existing Google Fonts stylesheet and font origin to preserve its pixel lettering; the spectator uses available Avenir / Century Gothic / sans-serif fonts. No official OpenAI font is bundled. Chrome recording and video export were verified. The latest live run reported a 184 ms final response; latency varies.

The first decision is a preparation phase: the game world remains frozen while OpenAI chooses the first flap or wait. The actual model answer resumes play and applies once; subsequent requests keep the simulation moving. Preparation counts toward the 150-second bound. Hidden pages or resizing cancel preparation.
