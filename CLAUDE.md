# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Confetti (🎉🎉🎉.ws) is a web app that displays celebratory messages with confetti effects. Users can generate custom encrypted URLs containing messages — no data is stored server-side. Supports dark/light mode based on user's system preference.

## Build & Run Commands

```bash
npm install              # Install dependencies
npm run build            # Minify src/ JS files into dist/ (runs build.js with UglifyJS)
node private/server.js   # Start the Express server on port 80
docker-compose up --build  # Build and run via Docker
```

No test suite exists (`npm test` is a no-op).

### Nix

```bash
nix develop          # Enter dev shell with Node.js
nix build            # Build the full package
```

## Environment Setup

Requires a `.env` file with a 32-character `SECRET_KEY` used for AES-256-CTR encryption of custom URL messages. Generate with: `openssl rand -hex 16`

## Architecture

**Build pipeline:** `build.js` reads JS files from `src/`, minifies them with UglifyJS, and outputs to `dist/`. The `dist/` directory also contains `styles.css` and static assets served directly by Express.

**Server (`private/server.js`):** Express app using EJS templates. Three routes:
- `GET /` — renders homepage with a daily motivational message from `private/messages.json` (cycled by day-of-year)
- `POST /generate-url` — encrypts user text (AES-256-CTR + HMAC verification) into a URL-safe string, returns the custom URL path
- `GET /custom/:text` — decrypts the URL parameter and renders the page with that message

All user input is sanitized with `sanitize-html` (no tags/attributes allowed).

**Client (`src/app.js`):** Handles continuous side-streaming confetti, click/touch confetti bursts, custom URL generation UI, clipboard copying, and theme toggling. Uses the `canvas-confetti` library loaded as `confetti.browser.js` from dist.

**Docker:** Multi-stage Dockerfile with base, build, dev (nodemon), and production stages. Production runs on port 80.
