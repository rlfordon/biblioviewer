#!/usr/bin/env node
// Fetch each bibliography entry's URL and store a clean reader-mode snapshot
// (Mozilla Readability, sanitized with DOMPurify) back into the JSON file.
//
// Usage: node scripts/fetch_snapshots.mjs <bibliography.json> [--only id1,id2] [--force] [--from-dir dir]
//   --only      refetch only the listed entry ids
//   --force     refetch entries that already have a snapshot
//   --from-dir  offline mode for sandboxes without network access (e.g. claude.ai):
//               instead of fetching, read pre-downloaded page HTML from <dir>/<entry-id>.html
//               (fetched by other means, e.g. the web_fetch tool) and extract/sanitize those

import { readFileSync, writeFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';
import createDOMPurify from 'dompurify';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const ALLOWED_TAGS = [
  'a', 'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'em', 'strong', 'b', 'i', 'u', 's',
  'sup', 'sub', 'small', 'cite', 'q', 'abbr', 'mark', 'figure', 'figcaption', 'img',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'div', 'span', 'section', 'article',
];
const ALLOWED_ATTR = ['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'datetime'];

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('Usage: node fetch_snapshots.mjs <bibliography.json> [--only id1,id2] [--force]');
  process.exit(1);
}
const force = args.includes('--force');
const onlyArg = args.find((a) => a.startsWith('--only'));
const only = onlyArg ? (onlyArg.split('=')[1] ?? args[args.indexOf(onlyArg) + 1] ?? '').split(',').filter(Boolean) : null;
const dirIdx = args.indexOf('--from-dir');
const fromDir = dirIdx !== -1 ? args[dirIdx + 1] : null;

const data = JSON.parse(readFileSync(file, 'utf8'));
const entries = data.sections.flatMap((s) => s.entries);
const targets = entries.filter(
  (e) => e.url && (only ? only.includes(e.id) : force || !e.snapshot || e.snapshot.status !== 'ok')
);

console.log(`Fetching ${targets.length} of ${entries.length} entries…`);

async function fetchWithTimeout(url, ms = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function extract(html, url) {
  const vc = new VirtualConsole(); // swallow CSS/JS parse noise from real-world pages
  const dom = new JSDOM(html, { url, virtualConsole: vc });
  const docTitle = dom.window.document.title;
  let article = new Readability(dom.window.document, { keepClasses: false }).parse();
  if (!article || !article.content) {
    // Readability rejected the page; fall back to the page's own <article>/<main> element.
    const fallbackDom = new JSDOM(html, { url, virtualConsole: vc });
    const node =
      fallbackDom.window.document.querySelector('article') ||
      fallbackDom.window.document.querySelector('main');
    if (!node || node.textContent.trim().length < 500) return null;
    article = {
      content: node.innerHTML,
      byline: null,
      siteName: null,
      excerpt: null,
      length: node.textContent.trim().length,
      title: docTitle || null,
    };
  }

  const purifyWindow = new JSDOM('').window;
  const DOMPurify = createDOMPurify(purifyWindow);
  const clean = DOMPurify.sanitize(article.content, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });

  // Force absolute, safe link/img URLs; drop tracking pixels.
  const outDom = new JSDOM(`<div id="root">${clean}</div>`);
  const doc = outDom.window.document;
  for (const a of doc.querySelectorAll('a')) {
    try {
      const abs = new URL(a.getAttribute('href') ?? '', url);
      if (!/^https?:$/.test(abs.protocol)) throw new Error('bad scheme');
      a.setAttribute('href', abs.href);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    } catch {
      a.removeAttribute('href');
    }
  }
  for (const img of doc.querySelectorAll('img')) {
    try {
      const abs = new URL(img.getAttribute('src') ?? '', url);
      if (!/^https?:$/.test(abs.protocol)) throw new Error('bad scheme');
      const w = parseInt(img.getAttribute('width') ?? '999', 10);
      const h = parseInt(img.getAttribute('height') ?? '999', 10);
      if (w <= 2 || h <= 2) { img.remove(); continue; }
      img.setAttribute('src', abs.href);
      img.setAttribute('loading', 'lazy');
    } catch {
      img.remove();
    }
  }
  return {
    html: doc.getElementById('root').innerHTML,
    byline: article.byline ?? null,
    siteName: article.siteName ?? null,
    excerpt: article.excerpt ?? null,
    length: article.length ?? null,
    articleTitle: article.title ?? null,
  };
}

let ok = 0, failed = 0;
for (const entry of targets) {
  process.stdout.write(`  ${entry.id} … `);
  try {
    let html, baseUrl;
    if (fromDir) {
      html = readFileSync(`${fromDir}/${entry.id}.html`, 'utf8');
      baseUrl = entry.url;
    } else {
      const res = await fetchWithTimeout(entry.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      html = await res.text();
      baseUrl = res.url;
    }
    const result = extract(html, baseUrl);
    if (!result) throw new Error('readability found no article content');
    entry.snapshot = {
      status: 'ok',
      fetchedAt: new Date().toISOString().slice(0, 10),
      finalUrl: baseUrl,
      ...result,
    };
    ok++;
    console.log(`ok (${result.length} chars)`);
  } catch (err) {
    entry.snapshot = {
      status: 'failed',
      fetchedAt: new Date().toISOString().slice(0, 10),
      error: String(err.message ?? err),
    };
    failed++;
    console.log(`FAILED: ${err.message ?? err}`);
  }
  if (!fromDir) await new Promise((r) => setTimeout(r, 500)); // be polite between requests
}

writeFileSync(file, JSON.stringify(data, null, 2));
console.log(`\nDone: ${ok} ok, ${failed} failed. Snapshots written to ${file}`);
if (failed) {
  console.log('Failed entries will fall back to live-embed / open-in-new-tab in the viewer.');
  process.exitCode = 2;
}
