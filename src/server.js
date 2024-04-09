const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 80;

app.use(express.static(__dirname + '/../'));

app.get('/', function(req, res) {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Endpoint to serve a daily message
app.get('/daily-message', function(req, res) {
    fs.readFile(path.join(__dirname, 'messages.json'), 'utf8', (err, data) => {
        if (err) {
            console.error(err);
            return res.status(500).send('An error occurred while retrieving the messages.');
        }
        const messages = JSON.parse(data);
        const today = new Date();
        const startOfYear = new Date(today.getFullYear(), 0, 0);
        const diff = today - startOfYear;
        const oneDay = 1000 * 60 * 60 * 24;
        const dayOfYear = Math.floor(diff / oneDay);
        
        const messageIndex = dayOfYear % messages.length; // Selects a message based on the day of the year
        res.json({ message: messages[messageIndex] }); // Sends the selected message as a JSON response
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});