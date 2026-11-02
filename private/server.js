'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createLogger } = require('./logger');

const DIST_DIR = path.join(__dirname, '..', 'dist');
const VIEWS_DIR = path.join(__dirname, 'views');
const MESSAGES_FILE = path.join(__dirname, 'messages.json');

const MAX_MESSAGE_LENGTH = 500;

// Current token format (v1): base64url( version | iv | ciphertext | tag ), AES-256-GCM.
const TOKEN_VERSION = 1;
const GCM_IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const TOKEN_MIN_BYTES = 1 + GCM_IV_LENGTH + 1 + GCM_TAG_LENGTH;

// Legacy format (still accepted so old links keep working):
// hex(iv) ":" hex(AES-256-CTR ciphertext) ":" hex(HMAC-SHA256(ciphertext)).
const LEGACY_TOKEN_PATTERN = /^[0-9a-f]{32}:(?:[0-9a-f]{2})+:[0-9a-f]{64}$/;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_KEYS = 50_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Everything the page needs is served from this origin. canvas-confetti renders
// in a Web Worker created from a blob: URL, hence worker-src blob:.
const CONTENT_SECURITY_POLICY = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    'worker-src blob:',
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
].join('; ');

class TokenError extends Error {
    constructor(reason) {
        super(`Invalid custom URL token: ${reason}`);
        this.reason = reason;
    }
}

// --- Crypto -----------------------------------------------------------------

// Derive a dedicated GCM key so the raw SECRET_KEY (used by the legacy
// CTR+HMAC format) is never used directly with a second algorithm.
const gcmKeys = new WeakMap();
function gcmKey(secretKey) {
    let key = gcmKeys.get(secretKey);
    if (!key) {
        key = Buffer.from(crypto.hkdfSync('sha256', secretKey, Buffer.alloc(0), 'confetti token v1 aes-256-gcm', 32));
        gcmKeys.set(secretKey, key);
    }
    return key;
}

function encrypt(text, secretKey) {
    const version = Buffer.from([TOKEN_VERSION]);
    const iv = crypto.randomBytes(GCM_IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', gcmKey(secretKey), iv, { authTagLength: GCM_TAG_LENGTH });
    cipher.setAAD(version);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return Buffer.concat([version, iv, encrypted, cipher.getAuthTag()]).toString('base64url');
}

function decryptV1(token, secretKey) {
    if (!TOKEN_PATTERN.test(token)) throw new TokenError('malformed');
    const data = Buffer.from(token, 'base64url');
    if (data.length < TOKEN_MIN_BYTES) throw new TokenError('malformed');
    if (data[0] !== TOKEN_VERSION) throw new TokenError('unknown_version');
    const iv = data.subarray(1, 1 + GCM_IV_LENGTH);
    const tag = data.subarray(data.length - GCM_TAG_LENGTH);
    const encrypted = data.subarray(1 + GCM_IV_LENGTH, data.length - GCM_TAG_LENGTH);
    const decipher = crypto.createDecipheriv('aes-256-gcm', gcmKey(secretKey), iv, { authTagLength: GCM_TAG_LENGTH });
    decipher.setAAD(data.subarray(0, 1));
    decipher.setAuthTag(tag);
    try {
        return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch {
        throw new TokenError('auth_failed');
    }
}

function decryptLegacy(token, secretKey) {
    if (!LEGACY_TOKEN_PATTERN.test(token)) throw new TokenError('malformed');
    const [ivHex, encryptedHex, hmacHex] = token.split(':');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const expected = crypto.createHmac('sha256', secretKey).update(encrypted).digest();
    if (!crypto.timingSafeEqual(expected, Buffer.from(hmacHex, 'hex'))) throw new TokenError('auth_failed');
    const decipher = crypto.createDecipheriv('aes-256-ctr', secretKey, Buffer.from(ivHex, 'hex'));
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function tokenVersion(token) {
    return typeof token === 'string' && token.includes(':') ? 'legacy' : 'v1';
}

function decrypt(token, secretKey) {
    if (typeof token !== 'string' || token.length === 0) throw new TokenError('malformed');
    return tokenVersion(token) === 'legacy' ? decryptLegacy(token, secretKey) : decryptV1(token, secretKey);
}

// --- Rate limiting ----------------------------------------------------------

// Fixed-window, in-memory, per client IP. Per-process only, which is fine for
// a single container. Behind a reverse proxy set TRUST_PROXY, or every client
// shares the proxy's IP (and therefore one bucket).
function rateLimit({ max, windowMs = RATE_LIMIT_WINDOW_MS, maxKeys = RATE_LIMIT_MAX_KEYS, now = Date.now }) {
    const hits = new Map();
    let windowStart = now();

    return (req, res, next) => {
        if (!max) return next();
        const t = now();
        if (t - windowStart >= windowMs || hits.size >= maxKeys) {
            hits.clear();
            windowStart = t;
        }
        const count = (hits.get(req.ip) || 0) + 1;
        hits.set(req.ip, count);
        const remaining = Math.max(0, max - count);
        const resetSeconds = Math.ceil((windowStart + windowMs - t) / 1000);
        res.set({ 'RateLimit-Limit': String(max), 'RateLimit-Remaining': String(remaining), 'RateLimit-Reset': String(resetSeconds) });
        if (count > max) {
            res.locals.logFields = { reason: 'rate_limited' };
            if (count === max + 1) req.log.warn('Rate limit exceeded', { ip: req.ip, limit: max, windowMs });
            res.set('Retry-After', String(resetSeconds));
            return res.status(429).json({ error: 'Too many links created. Please wait a minute and try again.' });
        }
        next();
    };
}

// --- Helpers ----------------------------------------------------------------

// Output is HTML-escaped by EJS (<%= %>) and inserted with textContent on the
// client, so messages are stored verbatim; we only drop control characters.
function cleanMessage(value) {
    if (typeof value !== 'string') return '';
    // eslint-disable-next-line no-control-regex
    return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

function messageOfTheDay(messages, now = new Date()) {
    const dayOfYear = Math.floor((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 0)) / DAY_MS);
    return messages[dayOfYear % messages.length];
}

function loadSecretKey(env = process.env) {
    const key = env.SECRET_KEY_FILE ? fs.readFileSync(env.SECRET_KEY_FILE, 'utf8').trim() : env.SECRET_KEY;
    if (!key) throw new Error('SECRET_KEY (or SECRET_KEY_FILE) must be set');
    const buffer = Buffer.from(key, 'utf8');
    if (buffer.length !== 32) throw new Error(`SECRET_KEY must be exactly 32 bytes (got ${buffer.length})`);
    return buffer;
}

function parseRateLimit(value) {
    if (value === undefined || value === '') return 30;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) throw new Error(`RATE_LIMIT_PER_MINUTE must be a non-negative integer (got "${value}")`);
    return n; // 0 disables
}

function parseTrustProxy(value) {
    if (value === undefined || value === '' || value === 'false') return false;
    if (value === 'true') return true;
    if (/^\d+$/.test(value)) return Number(value);
    return value; // e.g. "loopback", "10.0.0.0/8"
}

function redactPath(url) {
    // Never log the encrypted token (or query strings).
    return url.split('?')[0].replace(/^\/custom\/[^/]+/, '/custom/:token');
}

// --- Middleware -------------------------------------------------------------

function requestLogger(logger) {
    return (req, res, next) => {
        const start = process.hrtime.bigint();
        req.id = crypto.randomUUID();
        req.log = logger.child({ reqId: req.id });
        res.setHeader('X-Request-Id', req.id);

        res.on('finish', () => {
            const fields = {
                method: req.method,
                path: redactPath(req.originalUrl),
                status: res.statusCode,
                durationMs: Number((process.hrtime.bigint() - start) / 1000n) / 1000,
                bytes: Number(res.getHeader('content-length')) || undefined,
                ip: req.ip,
                ua: req.get('user-agent'),
                ...res.locals.logFields,
            };
            if (res.statusCode >= 500) req.log.error('request', fields);
            else if (req.path === '/healthz') req.log.debug('request', fields);
            else req.log.info('request', fields);
        });
        next();
    };
}

function securityHeaders(req, res, next) {
    res.set({
        'Content-Security-Policy': CONTENT_SECURITY_POLICY,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Cross-Origin-Opener-Policy': 'same-origin',
    });
    next();
}

function errorHandler(logger) {
    // eslint-disable-next-line no-unused-vars
    return (err, req, res, next) => {
        const log = req.log || logger;
        let status = Number(err.status || err.statusCode) || 500;
        if (status < 400 || status > 599) status = 500;

        if (status >= 500) log.error('Unhandled error', { err });
        else log.warn('Rejected request', { status, reason: err.type || err.message });

        if (res.headersSent) return next(err);
        const message = status >= 500 ? 'Internal server error' : (err.expose && err.message) || 'Bad request';
        if (req.method === 'POST') res.status(status).json({ error: message });
        else res.status(status).type('text').send(message);
    };
}

// --- App --------------------------------------------------------------------

function createApp({ secretKey, messages, logger = createLogger(), trustProxy = false, rateLimitPerMinute = 30 }) {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', trustProxy);
    app.set('views', VIEWS_DIR);
    app.set('view engine', 'ejs');
    app.locals.maxMessageLength = MAX_MESSAGE_LENGTH;

    app.use(requestLogger(logger));
    app.use(securityHeaders);

    app.get('/healthz', (req, res) => res.type('text').send('ok'));
    app.use(express.static(DIST_DIR, { index: false }));

    app.get('/', (req, res) => {
        res.render('index', { message: messageOfTheDay(messages) });
    });

    app.post('/generate-url', rateLimit({ max: rateLimitPerMinute }), express.json({ limit: '8kb' }), (req, res) => {
        const text = cleanMessage(req.body?.text);
        if (!text) {
            res.locals.logFields = { reason: 'empty' };
            return res.status(400).json({ error: 'Message cannot be empty.' });
        }
        if (text.length > MAX_MESSAGE_LENGTH) {
            res.locals.logFields = { reason: 'too_long', messageLength: text.length };
            return res.status(400).json({ error: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.` });
        }
        res.locals.logFields = { messageLength: text.length };
        res.json({ customUrl: `/custom/${encrypt(text, secretKey)}`, customText: text });
    });

    app.get('/custom/:token', (req, res) => {
        const version = tokenVersion(req.params.token);
        let message;
        try {
            message = cleanMessage(decrypt(req.params.token, secretKey));
            if (!message) throw new TokenError('empty');
        } catch (err) {
            if (!(err instanceof TokenError)) throw err;
            res.locals.logFields = { tokenVersion: version, tokenError: err.reason };
            req.log.warn('Rejected custom URL', { reason: err.reason, tokenVersion: version, tokenLength: req.params.token.length });
            return res.redirect('/');
        }
        res.locals.logFields = { tokenVersion: version };
        res.set('Cache-Control', 'no-store');
        res.render('index', { message });
    });

    app.use((req, res) => res.status(404).type('text').send('Not found'));
    app.use(errorHandler(logger));
    return app;
}

// --- Entrypoint -------------------------------------------------------------

function start() {
    try {
        process.loadEnvFile(); // ./.env, if present; never overrides real env vars
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
    }

    const logger = createLogger();
    process.on('uncaughtException', (err) => {
        logger.error('Uncaught exception', { err });
        process.exit(1);
    });
    process.on('unhandledRejection', (reason) => {
        logger.error('Unhandled promise rejection', { err: reason instanceof Error ? reason : new Error(String(reason)) });
        process.exit(1);
    });

    let secretKey;
    let rateLimitPerMinute;
    try {
        secretKey = loadSecretKey();
        rateLimitPerMinute = parseRateLimit(process.env.RATE_LIMIT_PER_MINUTE);
    } catch (err) {
        logger.error('Invalid configuration, refusing to start', { reason: err.message });
        process.exit(1);
    }

    const messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
    const port = Number(process.env.PORT) || 80;
    const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
    const app = createApp({ secretKey, messages, logger, trustProxy, rateLimitPerMinute });

    const server = app.listen(port, (err) => {
        if (err) {
            logger.error('Server failed to start', { err, port });
            process.exit(1);
        }
        logger.info('Server listening', {
            port,
            version: require('../package.json').version,
            node: process.version,
            nodeEnv: process.env.NODE_ENV,
            logLevel: logger.level,
            trustProxy,
            rateLimitPerMinute,
            messages: messages.length,
        });
    });

    let shuttingDown = false;
    function shutdown(signal) {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.info('Shutting down', { signal });
        setTimeout(() => {
            logger.warn('Forcing exit: connections still open', { timeoutMs: SHUTDOWN_TIMEOUT_MS });
            process.exit(1);
        }, SHUTDOWN_TIMEOUT_MS).unref();
        server.close((err) => {
            if (err) logger.error('Error while closing server', { err });
            else logger.info('Server closed');
            process.exit(err ? 1 : 0);
        });
        server.closeIdleConnections();
    }
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = {
    createApp,
    encrypt,
    decrypt,
    cleanMessage,
    messageOfTheDay,
    loadSecretKey,
    parseRateLimit,
    parseTrustProxy,
    rateLimit,
    redactPath,
    MAX_MESSAGE_LENGTH,
};

if (require.main === module) start();
