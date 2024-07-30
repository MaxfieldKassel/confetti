let fullPageEffectActive = false;
function continuousSideConfetti() {
    if (!fullPageEffectActive) { //Don't do an effect if there is another full page effect going on.
        // Launch confetti from the left edge
        confetti({
            particleCount: 7,
            angle: 60,
            spread: 55,
            origin: { x: 0 } // From the left side
        });
        // Launch confetti from the right edge
        confetti({
            particleCount: 7,
            angle: 120,
            spread: 55,
            origin: { x: 1 } // From the right side
        });
    }

    // Continue indefinitely
    requestAnimationFrame(continuousSideConfetti);
}

continuousSideConfetti();

function triggerConfetti(e) {
    // Check if the target or any of its parents is a link
    let target = e.target;
    while (target != null) {
        if (target.nodeName === 'A') {
            // It's a link, so do nothing and let the default action proceed
            return;
        }
        target = target.parentNode;
    }

    //No on click if there is a full page effect
    if (fullPageEffectActive)
        return;

    // Prevent the default action for non-link elements
    e.preventDefault();

    // Calculate position for the confetti burst
    var posX = e.pageX || e.touches && e.touches[0].pageX;
    var posY = e.pageY || e.touches && e.touches[0].pageY;

    var relativeX = posX / window.innerWidth;
    var relativeY = posY / window.innerHeight;

    // Burst confetti at the click/touch position
    confetti({
        particleCount: 20,
        spread: 70,
        origin: { x: relativeX, y: relativeY }
    });
}

// Listen for both click and touchstart events to cover taps and clicks
document.addEventListener('click', triggerConfetti);
document.addEventListener('touchstart', triggerConfetti);


// Handle click on the custom URL link to toggle the visibility of the input box
document.getElementById('custom-url-link').onclick = function () {
    const inputBox = document.getElementById('custom-url-input');
    inputBox.style.display = inputBox.style.display === 'block' ? 'none' : 'block';
    // Hide the link and generated URL display upon opening or closing the input box
    document.getElementById('custom-url-link').style.display = 'none';
    document.getElementById('generated-url-display').style.display = 'none';
};

// Function to generate a custom URL based on user input
function generateCustomUrl() {
    const text = document.getElementById('custom-text').value;
    if (text.trim() === "") return;  // Prevent empty submissions

    fetch('/generate-url', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: text }),
    })
        .then(response => response.json())
        .then(data => {
            if (data.customUrl) {
                // Update the browser's history state
                window.history.pushState({ path: data.customUrl }, '', data.customUrl);
                // Display the custom text and hide input elements
                document.getElementById('celebration-text').textContent = data.customText;
                document.getElementById('custom-url-input').style.display = 'none';

                // Display and configure the 'Copy Link' button
                const display = document.getElementById('generated-url-display');
                display.textContent = '';  // Clear previous content
                const copyButton = document.createElement('button');
                copyButton.textContent = 'Copy Link';
                copyButton.onclick = copyLinkHandler(data.customUrl);
                display.appendChild(copyButton);
                display.style.display = 'block';
            } else {
                mainTextConfetti("Error creating link!", '#FF0000');
            }
        })
        .catch(error => {
            mainTextConfetti("Error creating link!", '#FF0000');
            console.error('Error:', error);
        });
    // Reset the input text
    document.getElementById('custom-text').value = '';
}

// Function to handle link copying, also manages UI updates post-copy
function copyLinkHandler(customUrl) {
    return function () {
        // check for punycode url, and override with emoji url (current workaround for punycode issue)
        if (window.location.origin.includes('xn--dk8haa.ws')) {
            const startURL = 'https://🎉🎉🎉.ws'
        } else {
            const startURL = window.location.origin
        }
        navigator.clipboard.writeText(startURL + customUrl)
            .then(() => {
                mainTextConfetti("Link copied to clipboard!", '#00FF00');
                document.getElementById('custom-url-link').style.display = 'block';
                document.getElementById('generated-url-display').textContent = '';  // Clear display
            })
            .catch(err => {
                mainTextConfetti("Error copying link!", '#FF0000');
                console.error('Error copying link: ', err);
            });
    };
}

// Function to display celebratory effects and messages
function mainTextConfetti(text, color) {
    const mainTextElement = document.getElementById('celebration-text');
    const originalText = mainTextElement.textContent;

    if (fullPageEffectActive) return;  // Prevent overlapping effects
    mainTextElement.textContent = text;
    fullPageEffectActive = true;

    confetti.reset();
    confetti({
        particleCount: 100,
        spread: 160,
        startVelocity: 30,
        origin: { y: 0.6 },
        colors: [color]
    });

    setTimeout(() => {
        mainTextElement.textContent = originalText;
        fullPageEffectActive = false;
    }, 3000);
}

// Function to handle key press in the input box
function handleKeyPress(event) {
    if (event.key === 'Enter') {
        generateCustomUrl();  // Call generate URL function if Enter is pressed
        event.preventDefault(); // Prevent default action (form submission)
    }
}