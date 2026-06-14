'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

const COPY_ENTRIES = [
  'index.html',
  'robots.txt',
  'sitemap.xml',
  'admin',
  'assets',
  'cars',
  'contact',
  'drivers',
  'events',
  'hotel',
  'massage'
];

function copyEntry(name) {
  const source = path.join(ROOT, name);
  const target = path.join(PUBLIC, name);
  if (!fs.existsSync(source)) return;

  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.cpSync(source, target, { recursive: true });
    return;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

fs.rmSync(PUBLIC, { recursive: true, force: true });
fs.mkdirSync(PUBLIC, { recursive: true });

for (const entry of COPY_ENTRIES) copyEntry(entry);

console.log(`Prepared Vercel public assets in ${path.relative(ROOT, PUBLIC)}`);
