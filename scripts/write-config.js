const fs = require('fs');
const path = require('path');

const serverUrl = process.env.BACKEND_URL || process.env.VITE_BACKEND_URL || '';
const contents = `window.HUDDLACE_CONFIG = { serverUrl: ${JSON.stringify(serverUrl)} };\n`;

fs.writeFileSync(path.join(__dirname, '../public/js/config.js'), contents);
console.log('config.js written (serverUrl:', serverUrl || 'same origin', ')');
