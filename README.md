# Cóndor de los Andes — local AI spectator

This separate repository credits [robertzu43/condor-andes](https://github.com/robertzu43/condor-andes), copied from upstream commit `723a252` under its original MIT license (preserved in LICENSE). The original repository and public game are independent of this local experiment.

Node.js 22 or newer is required. There are no runtime dependencies.

```sh
npm run ai:mock
```

Open http://127.0.0.1:8789 when the spectator frontend is available. Mock mode always answers **wait**, makes no OpenAI calls, and must be visibly marked MOCK in recordings and logs. Direct bridge inspection is available at `/index.html#ai`.

For real decisions, copy `.env.example` to `.env`, set `OPENAI_API_KEY` locally, and run `npm run ai`. Restart the server after configuring the key. Never commit the key or paste it into chat. `/api/status` reports whether a key is configured without returning it. Real mode uses `gpt-6-luna` through OpenAI POST `/v1/decisions`. Missing credentials pause play; no automatic scripted fallback exists.

Control runs are limited to 150 seconds / 750 requests and at most five decisions per second, with one request at a time. Answers older than 250 ms are discarded; three consecutive stale answers pause the game. Death, stop, hidden pages, and resizing freeze AI control. AI play never submits to the human leaderboard. Real latency and performance have not been verified.

```sh
npm test
npm run build
```

The public build remains an explicit game asset allowlist and excludes the local server, credentials, spectator and AI controller. Deployment scripts and the original Cloudflare binding have been removed to prevent accidental deployment to the upstream project. The original human score function remains credited source material; the local server does not serve it.

## Human game

Use Space or tap to flap. Collect five Inti coins to enter ULTRA ANDES. The copied game assets preserve the original physics, rendering and human input. Open `/index.html` for human play; `/index.html#ai` enables local structured controls.
