#!/usr/bin/env node
// Extract the bibliography JSON out of a built biblioviewer HTML file,
// so it can be edited/refetched and rebuilt.
//
// Usage: node scripts/extract_data.mjs <built-file.html> <out.json>

import { readFileSync, writeFileSync } from 'node:fs';

const [inFile, outFile] = process.argv.slice(2);
if (!inFile || !outFile) {
  console.error('Usage: node extract_data.mjs <built-file.html> <out.json>');
  process.exit(1);
}
const html = readFileSync(inFile, 'utf8');
const m = html.match(/<script type="application\/json" id="biblio-data">([\s\S]*?)<\/script>/);
if (!m) {
  console.error('No biblio-data block found — is this a biblioviewer file?');
  process.exit(1);
}
const data = JSON.parse(m[1]);
delete data.locked; // lock state is chosen at build time
writeFileSync(outFile, JSON.stringify(data, null, 2));
const n = data.sections.reduce((a, s) => a + s.entries.length, 0);
console.log(`Extracted "${data.title}" (${n} entries) to ${outFile}`);
