# 🎉 [Confetti Website](https://🎉🎉🎉.ws) 🎉

<div align="center">
<div style="display: inline-block; width: 49%;">
    <img src="dark-mode.webp" alt="Dark Mode" style="max-width: 100%; height: auto;"/>
    Dark Mode
  </div>
<div style="display: inline-block; width: 49%;">
    <img src="light-mode.webp" alt="Light Mode" style="max-width: 100%; height: auto;"/>
    Light Mode
  </div>
  
  <br>
  <h1><a href="https://🎉🎉🎉.ws">🎉🎉🎉.ws</a></h1>
  <br>
</div>
This project is a simple web application that displays celebratory messages with confetti effects. It includes functionality for generating custom URLs encrypted with AES-256-GCM, ensuring that the message can only be viewed by opening the URL. No data is stored on the server, making the application highly scalable and secure. It also includes dark and light mode, defaulting to the user's system preference.

## Usage

### Prerequisites

- [Nix](https://nixos.org) with flakes to build the package / Docker image.
- Node.js 24+ (26 LTS recommended) for local development (or use `nix develop`).

### Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `SECRET_KEY` | — (required) | 32-character key used to encrypt messages into URLs. |
| `SECRET_KEY_FILE` | — | Read the key from this file instead (Docker/systemd secrets). |
| `PORT` | `80` | Port to listen on. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` or `silent`. |
| `LOG_FORMAT` | `json` (`text` on a TTY) | `json` = one object per line, `text` = human readable. |
| `RATE_LIMIT_PER_MINUTE` | `30` | Max links each client IP can create per minute (`0` disables). In-memory, per process. |
| `TRUST_PROXY` | off | Express [trust proxy](https://expressjs.com/en/guide/behind-proxies.html) value (`true`, hop count, `loopback`, subnets). Set it behind a reverse proxy so client IPs are logged and rate limited correctly. |

Locally these can go in a `.env` file in the project root (loaded automatically; real environment variables win). The server refuses to start if the key is missing or not 32 bytes.

```
SECRET_KEY=this_is_a_valid_32_character_key
```

#### How to Generate a 32-Character Secret Key

**macOS and Linux:**

```bash
openssl rand -hex 16
```

or

```bash
dd if=/dev/urandom bs=16 count=1 2>/dev/null | xxd -p -c 32
```

**Windows (PowerShell):**

```powershell
[System.BitConverter]::ToString((New-Object Security.Cryptography.RNGCryptoServiceProvider).GetBytes(16)).Replace("-", "")
```

### Building and Running

#### Docker image (via Nix)

```bash
nix build .#dockerImage
docker load < result
docker run -p 80:80 -e SECRET_KEY=... confetti:1.2.0
```

The image runs as an unprivileged user, contains only `node` (slim) and the production dependencies, and logs JSON to stdout (`docker logs`). The plain package is `nix build` (runs the tests as part of the build), and there is a NixOS module at `nixosModules.default` (`services.confetti`).

#### Local Development

```bash
npm install
npm run build   # bundles + minifies the front end into dist/
npm test
PORT=3000 npm start
```

Or `nix develop` for a shell with the right Node version.

### Logging

Every request produces one log line (method, path, status, duration, IP, user agent, request ID). The request ID is also returned in the `X-Request-Id` header, so a user-reported problem can be matched to its log line. Custom URL requests include `tokenVersion` (`v1` or `legacy`). Rejected ones are logged at `warn` with the reason (`malformed`, `auth_failed` — e.g. after a key rotation — `unknown_version` or `empty`). Rate-limited clients get a `429` and one `warn` line per window. Unexpected errors are logged at `error` with a stack trace, and startup/shutdown are logged too.

**Message contents and URL tokens are never logged** (custom URLs appear as `/custom/:token`). `GET /healthz` returns `ok` for health checks and is only logged at `debug`.

### Project Layout

- `src/app.js`, `src/styles.css` — front-end sources.
- `build.js` — bundles `canvas-confetti` + `src/app.js` into a single minified `dist/app.js` and minifies the CSS. No CDNs or external requests at runtime.
- `dist/` — static files served by Express (build output + `confetti.png`).
- `private/server.js` — Express server: `/`, `POST /generate-url`, `/custom/:token`, `/healthz`.
- `private/logger.js` — tiny dependency-free structured logger.
- `private/messages.json` — daily messages, chosen by UTC day of the year.
- `test/` — `node --test` suite.
- `flake.nix` — package, Docker image, dev shell and NixOS module.

### License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.
