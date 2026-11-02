'use strict';

// Minimal dependency-free structured logger.
//
//   LOG_LEVEL  = debug | info (default) | warn | error | silent
//   LOG_FORMAT = json | text   (default: text on a TTY, json otherwise)
//
// JSON output is one object per line on stdout, which is what `docker logs`,
// journald and most log shippers expect.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: Infinity };

function serializeError(err) {
    const out = { name: err.name, message: err.message };
    if (err.code !== undefined) out.code = err.code;
    if (err.status !== undefined) out.status = err.status;
    if (err.stack) out.stack = err.stack;
    return out;
}

function normalize(fields) {
    const out = {};
    for (const [key, value] of Object.entries(fields || {})) {
        if (value === undefined) continue;
        out[key] = value instanceof Error ? serializeError(value) : value;
    }
    return out;
}

function formatText(entry) {
    const { time, level, msg, err, ...rest } = entry;
    let line = `${time} ${level.toUpperCase().padEnd(5)} ${msg}`;
    for (const [key, value] of Object.entries(rest)) {
        line += ` ${key}=${JSON.stringify(value)}`;
    }
    if (err) line += `\n${err.stack || `${err.name}: ${err.message}`}`;
    return line;
}

function createLogger(options = {}) {
    const stream = options.stream || process.stdout;
    const levelName = (options.level || process.env.LOG_LEVEL || 'info').toLowerCase();
    const format = (options.format || process.env.LOG_FORMAT || (stream.isTTY ? 'text' : 'json')).toLowerCase();
    const threshold = LEVELS[levelName] ?? LEVELS.info;
    const base = normalize(options.base);

    function write(level, msg, fields) {
        if (LEVELS[level] < threshold) return;
        const entry = { time: new Date().toISOString(), level, msg, ...base, ...normalize(fields) };
        let line;
        try {
            line = format === 'text' ? formatText(entry) : JSON.stringify(entry);
        } catch (e) {
            line = JSON.stringify({ time: entry.time, level, msg, logError: e.message });
        }
        stream.write(line + '\n');
    }

    const logger = {
        level: LEVELS[levelName] === undefined ? 'info' : levelName,
        debug: (msg, fields) => write('debug', msg, fields),
        info: (msg, fields) => write('info', msg, fields),
        warn: (msg, fields) => write('warn', msg, fields),
        error: (msg, fields) => write('error', msg, fields),
        child: (fields) => createLogger({ ...options, stream, level: levelName, format, base: { ...base, ...fields } }),
    };

    if (LEVELS[levelName] === undefined) {
        logger.warn('Unknown LOG_LEVEL, falling back to "info"', { requested: levelName });
    }
    return logger;
}

module.exports = { createLogger };
