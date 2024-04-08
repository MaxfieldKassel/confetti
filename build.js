require('dotenv').config();
const fs = require('fs');
const path = require('path');
const UglifyJS = require('uglify-js');

// Function to replace placeholders in HTML
function processHtml(htmlFilePath, outputFilePath) {
    fs.readFile(htmlFilePath, 'utf8', (err, data) => {
        if (err) {
            console.error('Failed to read HTML file:', err);
            return;
        }

        // Replace placeholders with environment variable values
        let output = data.replace(/%LINKEDIN_URL%/g, process.env.LINKEDIN_URL)
                         .replace(/%LINKEDIN_NAME%/g, process.env.LINKEDIN_NAME);

        // Ensure the output directory exists
        fs.mkdirSync(path.dirname(outputFilePath), { recursive: true });

        // Write the output to a new file
        fs.writeFile(outputFilePath, output, 'utf8', (err) => {
            if (err) {
                console.error('Failed to write output file:', err);
                return;
            }
            console.log('HTML build completed successfully.');
        });
    });
}

// Function to minify JS files
function minifyJs(srcDir, distDir) {
    fs.readdir(srcDir, (err, files) => {
        if (err) {
            console.error('Failed to list files in directory:', err);
            return;
        }

        files.forEach(file => {
            if (path.extname(file) === '.js') {
                const filePath = path.join(srcDir, file);
                const result = UglifyJS.minify(fs.readFileSync(filePath, 'utf8'));
                if (result.error) {
                    console.error('UglifyJS error:', result.error);
                    return;
                }

                const distPath = path.join(distDir, file);
                // Ensure the output directory exists
                fs.mkdirSync(distDir, { recursive: true });

                fs.writeFileSync(distPath, result.code);
                console.log(`Minified ${file} successfully.`);
            }
        });
    });
}

// Replace placeholders in HTML and minify JavaScript files
const htmlFilePath = path.join(__dirname, 'index.html');
const outputHtmlPath = path.join(__dirname, 'dist', 'index.html');
processHtml(htmlFilePath, outputHtmlPath);

const srcJsDir = path.join(__dirname, 'src');
const distJsDir = path.join(__dirname, 'dist');
minifyJs(srcJsDir, distJsDir);
