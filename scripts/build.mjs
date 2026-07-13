#!/usr/bin/env node
// Assemble a self-contained biblioviewer HTML file from the template + data.
//
// Usage: node scripts/build.mjs <bibliography.json> <output.html> [--locked] [--template path]

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const [dataFile, outFile] = positional;
if (!dataFile || !outFile) {
  console.error('Usage: node build.mjs <bibliography.json> <output.html> [--locked] [--template path]');
  process.exit(1);
}
const locked = args.includes('--locked');
const tplIdx = args.indexOf('--template');
const templatePath =
  tplIdx !== -1 ? args[tplIdx + 1] : join(dirname(fileURLToPath(import.meta.url)), '..', 'template.html');

const data = JSON.parse(readFileSync(dataFile, 'utf8'));
data.locked = locked;

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const json = JSON.stringify(data).replace(/</g, '\\u003c');

const template = readFileSync(templatePath, 'utf8');
if (!template.includes('__BIBLIO_DATA__')) {
  console.error('Template is missing the __BIBLIO_DATA__ placeholder.');
  process.exit(1);
}
const html = template
  .replace('__BIBLIO_DATA__', () => json)
  .replace('__BIBLIO_TITLE__', () => escapeHtml(data.title || 'Annotated Bibliography'));

writeFileSync(outFile, html);
const kb = Math.round(Buffer.byteLength(html) / 1024);
const n = data.sections.reduce((a, s) => a + s.entries.length, 0);
const snaps = data.sections.flatMap((s) => s.entries).filter((e) => e.snapshot?.status === 'ok').length;
console.log(`Wrote ${outFile} (${kb} KB, ${n} entries, ${snaps} cached snapshots, ${locked ? 'LOCKED' : 'editable'})`);
