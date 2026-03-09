# yt-dlp Audio Download

Minimal app: enter a link, get audio. Uses **yt-dlp** (audio-only) piped to **ffmpeg** (16 kHz mono WAV). No database or extra services.

## Prerequisites

- **Node.js** (e.g. 18+)
- **yt-dlp**: A copy is included in `bin/` (Windows: `bin/yt-dlp.exe`). To use your own, put it on your PATH or set `YT_DLP_PATH`.
- **ffmpeg**: Bundled via `ffmpeg-static` (no separate install needed).

## Run

Copy `.env.example` to `.env` and set your Supabase URL and keys (or use the existing `.env` if present). Then:

```bash
npm install
npm start
```

Open http://localhost:3000. Enter a URL and click **Download**. The page shows how long the download took and keeps a short history of the last few runs.

## How it works

- **Backend:** `POST /download` with `{ "url": "https://..." }` runs yt-dlp (audio format fallback for YouTube etc.) piped to ffmpeg (16 kHz mono WAV) and streams the result back.
- **Frontend:** Single page with URL input, Download button, timelog (duration from click to completion), and optional run history.

## Port

Default port is 3000. Set `PORT` to change it:

```bash
PORT=8080 npm start
```

## Faster downloads (aria2, optional)

By default the app streams directly (fast for short clips, ~4 s). To try **aria2** (multi-connection, can help on long videos):

```bash
USE_ARIA2=1 npm start
```

Install aria2 if needed: `winget install aria2.aria2` (Windows), `brew install aria2` (macOS), or [aria2.github.io](https://aria2.github.io/).

## Redis (optional)

Set `REDIS_URL` in `.env` (e.g. `redis://localhost:6379`) to use Redis from the app. Use `getRedis()` from `lib/redis.js` in code. To let the AI in Cursor use Redis (MCP), see [docs/REDIS_MCP.md](docs/REDIS_MCP.md).
