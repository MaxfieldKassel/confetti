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
    parseTrustProxy,
    redactPath,
    MAX_MESSAGE_LENGTH,
} = require('../private/server');
const { createLogger } = require('../private/logger');

const KEY = Buffer.from('0123456789abcdef0123456789abcdef');

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

    test('rejects malformed tokens and tampering', () => {
        assert.throws(() => decrypt('garbage', KEY), { reason: 'malformed' });
        const [iv, ct, mac] = encrypt('hello', KEY).split(':');
        const flipped = (ct[0] === '0' ? '1' : '0') + ct.slice(1);
        assert.throws(() => decrypt(`${iv}:${flipped}:${mac}`, KEY), { reason: 'bad_hmac' });
        const otherKey = Buffer.from('fedcba9876543210fedcba9876543210');
        assert.throws(() => decrypt(encrypt('hello', KEY), otherKey), { reason: 'bad_hmac' });
    });

    test('decrypts tokens produced by the previous implementation', () => {
        // Same algorithm/format as before the refactor (string key, hex parts).
        const crypto = require('node:crypto');
        const key = KEY.toString();
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-ctr', key, iv);
        const enc = Buffer.concat([cipher.update('legacy'), cipher.final()]);
        const mac = crypto.createHmac('sha256', key).update(enc).digest('hex');
        assert.equal(decrypt(`${iv.toString('hex')}:${enc.toString('hex')}:${mac}`, KEY), 'legacy');
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
