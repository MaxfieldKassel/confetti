'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Writable } = require('node:stream');
const {
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
} = require('../private/server');
const { createLogger } = require('../private/logger');

const KEY = Buffer.from('0123456789abcdef0123456789abcdef');

// The pre-1.2 token format, exactly as the old server produced it.
function legacyEncrypt(text) {
    const crypto = require('node:crypto');
    const key = KEY.toString();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-ctr', key, iv);
    const enc = Buffer.concat([cipher.update(text), cipher.final()]);
    const mac = crypto.createHmac('sha256', key).update(enc).digest('hex');
    return `${iv.toString('hex')}:${enc.toString('hex')}:${mac}`;
}

function captureLogger() {
    const lines = [];
    const stream = new Writable({
        write(chunk, enc, cb) {
            lines.push(...chunk.toString().trim().split('\n').map((l) => JSON.parse(l)));
            cb();
        },
    });
    return { logger: createLogger({ stream, level: 'debug', format: 'json' }), lines };
}

describe('crypto', () => {
    test('round-trips unicode text', () => {
        const text = 'Congrats 🎉 <3 & "quotes"';
        assert.equal(decrypt(encrypt(text, KEY), KEY), text);
    });

    test('tokens are URL-safe, randomized and much shorter than the legacy format', () => {
        const text = 'Happy birthday!';
        const a = encrypt(text, KEY);
        assert.match(a, /^[A-Za-z0-9_-]+$/);
        assert.notEqual(a, encrypt(text, KEY));
        assert.ok(a.length < legacyEncrypt(text).length / 2, `${a.length} vs ${legacyEncrypt(text).length}`);
    });

    test('rejects malformed, tampered, wrong-key and unknown-version tokens', () => {
        for (const bad of ['', 'garbage', 'a+b/c=', 'AAAA']) {
            assert.throws(() => decrypt(bad, KEY), { reason: 'malformed' }, bad);
        }
        const raw = Buffer.from(encrypt('hello', KEY), 'base64url');
        for (const i of [1, 14, raw.length - 1]) {
            const t = Buffer.from(raw);
            t[i] ^= 1;
            assert.throws(() => decrypt(t.toString('base64url'), KEY), { reason: 'auth_failed' }, `byte ${i}`);
        }
        const v2 = Buffer.from(raw);
        v2[0] = 2;
        assert.throws(() => decrypt(v2.toString('base64url'), KEY), { reason: 'unknown_version' });
        const otherKey = Buffer.from('fedcba9876543210fedcba9876543210');
        assert.throws(() => decrypt(encrypt('hello', KEY), otherKey), { reason: 'auth_failed' });
    });

    test('still decrypts legacy (AES-CTR + HMAC) links', () => {
        assert.equal(decrypt(legacyEncrypt('legacy 🎉'), KEY), 'legacy 🎉');
        const [iv, ct, mac] = legacyEncrypt('hello').split(':');
        const flipped = (ct[0] === '0' ? '1' : '0') + ct.slice(1);
        assert.throws(() => decrypt(`${iv}:${flipped}:${mac}`, KEY), { reason: 'auth_failed' });
        assert.throws(() => decrypt('abc:def:ghi', KEY), { reason: 'malformed' });
    });
});

describe('helpers', () => {
    test('cleanMessage keeps text verbatim but strips control chars', () => {
        assert.equal(cleanMessage('  I <3 you & me \u0007 '), 'I <3 you & me');
        assert.equal(cleanMessage(123), '');
        assert.equal(cleanMessage(undefined), '');
    });

    test('messageOfTheDay cycles by UTC day of year', () => {
        const msgs = ['a', 'b', 'c'];
        assert.equal(messageOfTheDay(msgs, new Date('2026-01-01T00:00:00Z')), 'b'); // day 1
        assert.equal(messageOfTheDay(msgs, new Date('2026-01-01T23:59:59Z')), 'b');
        assert.equal(messageOfTheDay(msgs, new Date('2026-01-02T00:00:00Z')), 'c');
    });

    test('loadSecretKey validates length', () => {
        assert.throws(() => loadSecretKey({}), /must be set/);
        assert.throws(() => loadSecretKey({ SECRET_KEY: 'short' }), /exactly 32 bytes/);
        assert.equal(loadSecretKey({ SECRET_KEY: KEY.toString() }).length, 32);
    });

    test('parseRateLimit', () => {
        assert.equal(parseRateLimit(undefined), 30);
        assert.equal(parseRateLimit('0'), 0);
        assert.equal(parseRateLimit('5'), 5);
        assert.throws(() => parseRateLimit('-1'));
        assert.throws(() => parseRateLimit('lots'));
    });

    test('rateLimit counts per IP and resets each window', () => {
        let t = 0;
        const limiter = rateLimit({ max: 2, windowMs: 1000, now: () => t });
        const call = (ip) => {
            let status = 200;
            const res = { locals: {}, set() {}, status(s) { status = s; return this; }, json() { return this; } };
            limiter({ ip, log: { warn() {} } }, res, () => {});
            return status;
        };
        assert.deepEqual([call('a'), call('a'), call('a'), call('b')], [200, 200, 429, 200]);
        t = 1000;
        assert.equal(call('a'), 200);
    });

    test('parseTrustProxy', () => {
        assert.equal(parseTrustProxy(undefined), false);
        assert.equal(parseTrustProxy('true'), true);
        assert.equal(parseTrustProxy('1'), 1);
        assert.equal(parseTrustProxy('loopback'), 'loopback');
    });

    test('redactPath hides tokens and query strings', () => {
        assert.equal(redactPath('/custom/abc%3Adef?x=1'), '/custom/:token');
        assert.equal(redactPath('/styles.css?v=2'), '/styles.css');
    });
});

describe('http', () => {
    let server;
    let base;
    let logs;

    before(async () => {
        const { logger, lines } = captureLogger();
        logs = lines;
        const app = createApp({ secretKey: KEY, messages: ['Hello world'], logger });
        await new Promise((resolve) => {
            server = app.listen(0, '127.0.0.1', resolve);
        });
        base = `http://127.0.0.1:${server.address().port}`;
    });

    after(() => new Promise((resolve) => server.close(resolve)));

    const post = (body) =>
        fetch(`${base}/generate-url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

    test('home page renders with security headers', async () => {
        const res = await fetch(base + '/');
        assert.equal(res.status, 200);
        assert.match(await res.text(), /Hello world/);
        assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
        assert.equal(res.headers.get('x-powered-by'), null);
        assert.ok(res.headers.get('x-request-id'));
    });

    test('healthz', async () => {
        const res = await fetch(base + '/healthz');
        assert.equal(res.status, 200);
        assert.equal(await res.text(), 'ok');
    });

    test('generate + view custom URL, escaping HTML exactly once', async () => {
        const res = await post({ text: '  I <3 you & me  ' });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.customText, 'I <3 you & me');

        const page = await fetch(base + data.customUrl);
        assert.equal(page.status, 200);
        assert.equal(page.headers.get('cache-control'), 'no-store');
        assert.match(await page.text(), /I &lt;3 you &amp; me/);
    });

    test('rejects empty, non-string and oversized input', async () => {
        for (const body of [{}, { text: '   ' }, { text: 123 }, { text: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) }]) {
            const res = await post(body);
            assert.equal(res.status, 400, JSON.stringify(body).slice(0, 40));
            assert.ok((await res.json()).error);
        }
        assert.equal((await post({ text: 'x'.repeat(MAX_MESSAGE_LENGTH) })).status, 200);
    });

    test('rejects bodies over the size limit and malformed JSON with JSON errors', async () => {
        const big = await post({ text: 'x'.repeat(20000) });
        assert.equal(big.status, 413);
        assert.ok((await big.json()).error);

        const bad = await fetch(`${base}/generate-url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{nope',
        });
        assert.equal(bad.status, 400);
    });

    test('legacy links still render', async () => {
        const res = await fetch(`${base}/custom/${encodeURIComponent(legacyEncrypt('old link'))}`);
        assert.equal(res.status, 200);
        assert.match(await res.text(), /old link/);
        assert.ok(logs.some((l) => l.msg === 'request' && l.tokenVersion === 'legacy' && l.status === 200));
    });

    test('invalid custom URLs redirect home', async () => {
        for (const path of ['/custom/garbage', `/custom/${'a'.repeat(32)}%3Aabcd%3A${'0'.repeat(64)}`]) {
            const res = await fetch(base + path, { redirect: 'manual' });
            assert.equal(res.status, 302, path);
            assert.equal(res.headers.get('location'), '/');
        }
    });

    test('bad percent-encoding is a 400, not a stack trace', async () => {
        const res = await fetch(base + '/custom/%E0%A4%A');
        assert.equal(res.status, 400);
        assert.doesNotMatch(await res.text(), /at /);
    });

    test('unknown routes 404', async () => {
        assert.equal((await fetch(base + '/nope')).status, 404);
    });

    test('logs never contain message text or tokens', async () => {
        const data = await (await post({ text: 'super secret message' })).json();
        await fetch(base + data.customUrl);
        const token = decodeURIComponent(data.customUrl.split('/').pop());
        const all = JSON.stringify(logs);
        assert.doesNotMatch(all, /super secret message/);
        assert.ok(!all.includes(token));
        assert.ok(logs.some((l) => l.msg === 'request' && l.path === '/custom/:token' && l.status === 200));
        assert.ok(logs.some((l) => l.msg === 'Rejected custom URL' && l.reason === 'malformed'));
    });
});

describe('rate limiting', () => {
    let server;
    let base;

    before(async () => {
        const app = createApp({
            secretKey: KEY,
            messages: ['x'],
            logger: createLogger({ level: 'silent' }),
            rateLimitPerMinute: 2,
        });
        await new Promise((resolve) => {
            server = app.listen(0, '127.0.0.1', resolve);
        });
        base = `http://127.0.0.1:${server.address().port}`;
    });

    after(() => new Promise((resolve) => server.close(resolve)));

    test('returns 429 with Retry-After once the limit is hit; pages are unaffected', async () => {
        const post = () =>
            fetch(`${base}/generate-url`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: 'hi' }),
            });
        assert.equal((await post()).status, 200);
        assert.equal((await post()).status, 200);
        const limited = await post();
        assert.equal(limited.status, 429);
        assert.ok(Number(limited.headers.get('retry-after')) > 0);
        assert.match((await limited.json()).error, /Too many/);
        assert.equal((await fetch(base + '/')).status, 200);
    });
});
