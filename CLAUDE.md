# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Confetti (🎉🎉🎉.ws) is a web app that displays celebratory messages with confetti effects. Users can generate custom encrypted URLs containing messages — no data is stored server-side. Supports dark/light mode based on user's system preference.

Goals: keep it small. Front end is minimal, minified/mangled, and has no external runtime requests (no CDNs). Server avoids dependencies beyond `express` and `ejs`.

## Build & Run Commands

```bash
npm install              # Install dependencies
npm run build            # Bundle canvas-confetti + src/app.js -> dist/app.js, minify src/styles.css -> dist/styles.css
npm test                 # node --test (test/)
PORT=3000 npm start      # Start the server (needs SECRET_KEY in env or .env)
```

### Nix (production path)

```bash
nix develop                  # Dev shell with Node.js 26
nix build                    # Package (runs build + tests); bin/confetti wrapper
nix build .#dockerImage      # Docker image tarball: docker load < result
```

After changing `package-lock.json`, update `npmDepsHash` in `flake.nix` (build once; Nix prints the expected hash).

## Environment

`SECRET_KEY` (32 bytes, `openssl rand -hex 16`) or `SECRET_KEY_FILE`; optional `PORT` (80), `LOG_LEVEL` (info), `LOG_FORMAT` (json/text), `TRUST_PROXY`. A `.env` file is loaded via `process.loadEnvFile()`. The server exits at startup if the key is invalid.

## Architecture

**Build (`build.js`):** UglifyJS bundles `canvas-confetti/dist/confetti.browser.js` + `src/app.js` inside one IIFE into `dist/app.js`; a small regex minifier writes `dist/styles.css`. Build output is gitignored; `dist/confetti.png` is committed.

**Server (`private/server.js`):** `createApp()` (exported for tests) + `start()` (env, signals, graceful shutdown). Routes:
- `GET /` — daily message from `private/messages.json` (UTC day of year)
- `POST /generate-url` — encrypts text (AES-256-CTR + HMAC-SHA256, format `iv:ciphertext:hmac` hex) into `/custom/<token>`; max 500 chars
- `GET /custom/:token` — decrypts and renders; invalid tokens redirect to `/`
- `GET /healthz` — `ok`

Messages are stored verbatim; safety comes from EJS `<%= %>` escaping and `textContent` on the client (do not add extra HTML escaping — it double-escapes). Strict CSP (`script-src 'self'`, no inline scripts/handlers; `worker-src blob:` for canvas-confetti's worker).

**Logging (`private/logger.js`):** dependency-free JSON-lines logger. One `request` line per request with `reqId` (also `X-Request-Id` header). Never log message text or tokens — paths are redacted to `/custom/:token`.

**Client (`src/app.js`):** IIFE; side-streaming confetti, pointerdown bursts, custom URL UI, clipboard copy, theme toggle. All handlers attached in JS.
