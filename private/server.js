const express = require('express');
const path = require('path');
const fs = require('fs');
const sanitizeHtml = require('sanitize-html');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = 80;

// Configure Express to use EJS as the template engine and set the views directory
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.json()); // Middleware to parse JSON bodies
app.use(express.static(path.join(__dirname, "../dist/"))); // Serve static files from ../dist

// Encryption settings using AES-256-CTR algorithm
const algorithm = 'aes-256-ctr';
const secretKey = process.env.SECRET_KEY; // Secret key for encryption/decryption, stored in environment variable
const ivLength = 16; // Length of the initialization vector

// Encrypts input text using AES-256-CTR and returns a string with the IV, encrypted text, and HMAC for verification
function encrypt(text) {
    const iv = crypto.randomBytes(ivLength);
    const cipher = crypto.createCipheriv(algorithm, secretKey, iv);
    let encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
    const hmac = crypto.createHmac('sha256', secretKey).update(encrypted).digest('hex');
    return `${iv.toString('hex')}:${encrypted.toString('hex')}:${hmac}`;
}

// Decrypts input text and verifies integrity using HMAC
function decrypt(text) {
    const [ivHex, encryptedHex, hash] = text.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const encryptedText = Buffer.from(encryptedHex, 'hex');
    const hmac = crypto.createHmac('sha256', secretKey).update(encryptedText).digest('hex');
    if (hash !== hmac) throw new Error('Invalid data or key');
    const decipher = crypto.createDecipheriv(algorithm, secretKey, iv);
    return Buffer.concat([decipher.update(encryptedText), decipher.final()]).toString();
}

// Home route: Reads a message from a JSON file based on the day of the year and renders the homepage with this message
app.get('/', (req, res) => {
    fs.readFile(path.join(__dirname, 'messages.json'), 'utf8', (err, data) => {
        if (err) return res.status(500).send('An error occurred.');
        const messages = JSON.parse(data);
        const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));
        const message = messages[dayOfYear % messages.length];
        res.render('index', {
            message
        });
    });
});

// Generates a custom URL based on encrypted user input
app.post('/generate-url', (req, res) => {
    let text = sanitizeHtml(req.body.text, { allowedTags: [], allowedAttributes: {} }).trim();
    if (!text) return res.status(400).send('Input text cannot be empty or whitespace only.');
    res.json({ customUrl: `/custom/${encodeURIComponent(encrypt(text))}`, customText: text });
});

// Custom text route: Decrypts and sanitizes the parameter, then renders the page with this custom message
app.get('/custom/:text', (req, res) => {
    try {
        let decryptedText = sanitizeHtml(decrypt(decodeURIComponent(req.params.text)), { allowedTags: [], allowedAttributes: {} }).trim();
        if (!decryptedText) throw new Error('Decrypted text is empty or whitespace only.');
        res.render('index', {
            message: decryptedText
        });
    } catch (error) {
        res.redirect('/');
    }
});


process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});

app.listen(PORT, () => console.log(`Server is running on http://localhost:${PORT}`));