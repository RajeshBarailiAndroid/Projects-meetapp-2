const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '../public');
const serverUrl = (
  process.env.BACKEND_URL ||
  process.env.VITE_BACKEND_URL ||
  ''
).trim().replace(/\/$/, '');

const configContents = `window.HUDDLACE_CONFIG = { serverUrl: ${JSON.stringify(serverUrl)} };\n`;
fs.writeFileSync(path.join(publicDir, 'js/config.js'), configContents);

for (const htmlFile of ['index.html', 'room.html']) {
  const filePath = path.join(publicDir, htmlFile);
  let html = fs.readFileSync(filePath, 'utf8');
  const metaTag = `<meta name="huddlace-backend" content="${serverUrl}" />`;

  if (html.includes('name="huddlace-backend"')) {
    html = html.replace(/<meta name="huddlace-backend" content="[^"]*" \/>/, metaTag);
  } else {
    html = html.replace(
      '<meta name="viewport"',
      `${metaTag}\n<meta name="viewport"`,
    );
  }

  fs.writeFileSync(filePath, html);
}

console.log('config.js written (serverUrl:', serverUrl || 'same origin', ')');
