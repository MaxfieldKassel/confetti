'use strict';

// Builds the front end into dist/:
//   dist/app.js     = canvas-confetti + src/app.js, bundled and minified/mangled
//   dist/styles.css = src/styles.css, minified
// No runtime dependencies or external requests: everything is served locally.

const fs = require('fs');
const path = require('path');
const UglifyJS = require('uglify-js');

const SRC = path.join(__dirname, 'src');
const DIST = path.join(__dirname, 'dist');

function buildJs() {
    const confetti = fs.readFileSync(require.resolve('canvas-confetti/dist/confetti.browser.js'), 'utf8');
    const app = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');
    // One enclosing scope so nothing but `window.confetti` leaks into globals.
    const bundle = `(function () {\n${confetti}\n;\n${app}\n})();\n`;
    const result = UglifyJS.minify(bundle, {
        compress: { passes: 2 },
        mangle: true,
        output: { comments: false },
    });
    if (result.error) throw result.error;
    for (const warning of result.warnings || []) console.warn(warning);
    return result.code;
}

function minifyCss(css) {
    return css
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, ' ')
        .replace(/\s*([{}:;,>])\s*/g, '$1')
        .replace(/;}/g, '}')
        .trim();
}

function write(name, contents) {
    fs.writeFileSync(path.join(DIST, name), contents);
    console.log(`Built dist/${name} (${Buffer.byteLength(contents)} bytes)`);
}

try {
    fs.mkdirSync(DIST, { recursive: true });
    write('app.js', buildJs());
    write('styles.css', minifyCss(fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8')));
} catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
}
