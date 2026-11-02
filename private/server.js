'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createLogger } = require('./logger');

const DIST_DIR = path.join(__dirname, '..', 'dist');
const VIEWS_DIR = path.join(__dirname, 'views');
const MESSAGES_FILE = path.join(__dirname, 'messages.json');

const ALGORITHM = 'aes-256-ctr';
const IV_LENGTH = 16;
const MAX_MESSAGE_LENGTH = 500;
const TOKEN_PATTERN = /^[0-9a-f]{32}:(?:[0-9a-f]{2})+:[0-9a-f]{64}$/;
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
// Token format (unchanged, so existing links keep working):
//   hex(iv) ":" hex(AES-256-CTR ciphertext) ":" hex(HMAC-SHA256(ciphertext))

function encrypt(text, key) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const hmac = crypto.createHmac('sha256', key).update(encrypted).digest('hex');
    return `${iv.toString('hex')}:${encrypted.toString('hex')}:${hmac}`;
}

function decrypt(token, key) {
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) throw new TokenError('malformed');
    const [ivHex, encryptedHex, hmacHex] = token.split(':');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const expected = crypto.createHmac('sha256', key).update(encrypted).digest();
    if (!crypto.timingSafeEqual(expected, Buffer.from(hmacHex, 'hex'))) throw new TokenError('bad_hmac');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
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

function createApp({ secretKey, messages, logger = createLogger(), trustProxy = false }) {
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

    app.post('/generate-url', express.json({ limit: '8kb' }), (req, res) => {
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
        res.json({ customUrl: `/custom/${encodeURIComponent(encrypt(text, secretKey))}`, customText: text });
    });

    app.get('/custom/:token', (req, res) => {
        let message;
        try {
            message = cleanMessage(decrypt(req.params.token, secretKey));
            if (!message) throw new TokenError('empty');
        } catch (err) {
            if (!(err instanceof TokenError)) throw err;
            res.locals.logFields = { tokenError: err.reason };
            req.log.warn('Rejected custom URL', { reason: err.reason, tokenLength: req.params.token.length });
            return res.redirect('/');
        }
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
    try {
        secretKey = loadSecretKey();
    } catch (err) {
        logger.error('Invalid configuration, refusing to start', { reason: err.message });
        process.exit(1);
    }

    const messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
    const port = Number(process.env.PORT) || 80;
    const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
    const app = createApp({ secretKey, messages, logger, trustProxy });

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
    parseTrustProxy,
    redactPath,
    MAX_MESSAGE_LENGTH,
};

if (require.main === module) start();
