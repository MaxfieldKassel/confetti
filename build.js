require('dotenv').config();
const fs = require('fs');
const path = require('path');
const UglifyJS = require('uglify-js');

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

// move all files from src to dist after minifying them
const srcJsDir = path.join(__dirname, 'src');
const distJsDir = path.join(__dirname, 'dist');
minifyJs(srcJsDir, distJsDir);
