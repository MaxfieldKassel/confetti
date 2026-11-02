(function () {
    'use strict';

    var MAX_PARTICLES = 7;
    var MIN_PARTICLES = 3;
    var SLOW_FRAME_MS = 16;
    var EFFECT_DURATION_MS = 3000;
    var SHORT_HOST = 'xn--dk8haa.ws';
    var DISPLAY_ORIGIN = 'https://🎉🎉🎉.ws';

    var celebrationText = document.getElementById('celebration-text');
    var customUrlLink = document.getElementById('custom-url-link');
    var customUrlInput = document.getElementById('custom-url-input');
    var customText = document.getElementById('custom-text');
    var generateButton = document.getElementById('generate-link');
    var urlDisplay = document.getElementById('generated-url-display');
    var themeButton = document.getElementById('theme-toggle-button');

    var fullPageEffectActive = false;
    var lastTime = 0;
    var particleCount = MAX_PARTICLES;

    // Continuous confetti from both sides, scaled down on slow devices.
    function sideConfetti(timestamp) {
        if (!fullPageEffectActive) {
            if (lastTime) {
                particleCount = timestamp - lastTime > SLOW_FRAME_MS
                    ? Math.max(MIN_PARTICLES, particleCount - 1)
                    : Math.min(MAX_PARTICLES, particleCount + 1);
            }
            confetti({ particleCount: particleCount, angle: 60, spread: 55, origin: { x: 0 } });
            confetti({ particleCount: particleCount, angle: 120, spread: 55, origin: { x: 1 } });
            lastTime = timestamp;
        }
        requestAnimationFrame(sideConfetti);
    }
    requestAnimationFrame(sideConfetti);

    // Burst at the pointer. pointerdown covers mouse, touch and pen with a
    // single event, so taps no longer fire twice (touchstart + click).
    document.addEventListener('pointerdown', function (e) {
        if (fullPageEffectActive || (e.target.closest && e.target.closest('a'))) return;
        confetti({
            particleCount: 20,
            spread: 70,
            origin: { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight }
        });
    });

    // Temporarily replace the main text with a status message and a burst.
    function flashMessage(text, color) {
        if (fullPageEffectActive) return;
        var originalText = celebrationText.textContent;
        celebrationText.textContent = text;
        fullPageEffectActive = true;

        confetti.reset();
        confetti({ particleCount: 100, spread: 160, startVelocity: 30, origin: { y: 0.6 }, colors: [color] });

        setTimeout(function () {
            celebrationText.textContent = originalText;
            fullPageEffectActive = false;
        }, EFFECT_DURATION_MS);
    }

    function showError(text) {
        flashMessage(text || 'Error creating link!', '#FF0000');
    }

    customUrlLink.addEventListener('click', function () {
        customUrlInput.style.display = 'block';
        customUrlLink.style.display = 'none';
        urlDisplay.style.display = 'none';
        customText.focus();
    });

    function copyLink(customUrl) {
        var origin = window.location.host === SHORT_HOST ? DISPLAY_ORIGIN : window.location.origin;
        if (!navigator.clipboard) {
            showError('Copying is not supported here');
            return;
        }
        navigator.clipboard.writeText(origin + customUrl).then(function () {
            flashMessage('Link copied to clipboard!', '#00FF00');
            customUrlLink.style.display = 'block';
            urlDisplay.textContent = '';
            urlDisplay.style.display = 'none';
        }, function () {
            showError('Error copying link!');
        });
    }

    function generateCustomUrl() {
        var text = customText.value.trim();
        if (!text) return;

        fetch('/generate-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text })
        }).then(function (response) {
            return response.json().then(function (data) {
                if (!response.ok || !data.customUrl) throw new Error(data.error);
                return data;
            });
        }).then(function (data) {
            window.history.pushState({ path: data.customUrl }, '', data.customUrl);
            celebrationText.textContent = data.customText;
            customUrlInput.style.display = 'none';
            customText.value = '';

            var copyButton = document.createElement('button');
            copyButton.type = 'button';
            copyButton.textContent = 'Copy Link';
            copyButton.addEventListener('click', function () { copyLink(data.customUrl); });
            urlDisplay.textContent = '';
            urlDisplay.appendChild(copyButton);
            urlDisplay.style.display = 'block';
        }).catch(function (err) {
            showError(err && err.message);
        });
    }

    generateButton.addEventListener('click', generateCustomUrl);
    customText.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            generateCustomUrl();
        }
    });

    function setDarkMode(dark) {
        document.body.classList.toggle('dark-mode', dark);
        themeButton.textContent = dark ? 'Light Mode' : 'Dark Mode';
    }

    themeButton.addEventListener('click', function () {
        setDarkMode(!document.body.classList.contains('dark-mode'));
    });
    setDarkMode(!!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches));
})();
