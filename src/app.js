function continuousSideConfetti() {
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

async function displayDailyMessage() {
    try {
        const response = await fetch('/daily-message'); // Fetch the daily message from the endpoint
        const data = await response.json(); // Parse the JSON response
        document.getElementById('celebration-text').innerText = data.message;
    } catch (error) {
        console.error('Failed to fetch the daily message:', error);
    }
}

// Call the function to update the message
displayDailyMessage();