'use strict';

const fs = require('fs');
const path = require('path');

require.resolve('./index.html');
require.resolve('./robots.txt');
require.resolve('./sitemap.xml');

for (const dir of ['assets', 'admin', 'cars', 'contact', 'drivers', 'events', 'hotel', 'massage']) {
  const source = path.join(__dirname, dir);
  if (fs.existsSync(source)) {
    fs.readdirSync(source, { recursive: true });
  }
}
