#!/usr/bin/env node
// Fetch each bibliography entry's URL and store a clean reader-mode snapshot
// (Mozilla Readability, sanitized with DOMPurify) back into the JSON file.
//
// Usage: node scripts/fetch_snapshots.mjs <bibliography.json> [--only id1,id2] [--force]
//                                          [--limit N] [--status] [--from-dir dir]
//   --only      refetch only the listed entry ids
//   --force     refetch entries that already have a snapshot
//   --limit N   fetch at most N still-pending entries (batching for tight contexts)
//   --status    report per-entry progress and exit without fetching
//   --from-dir  offline mode for sandboxes without network access (e.g. claude.ai):
//               instead of fetching, read pre-downloaded pages from <dir>/<entry-id>.html
//               (saved by other means, e.g. an agent's web_fetch tool) and extract those.
//               Such files are often NOT raw HTML — see MARKDOWN INPUT below.

import { readFileSync, writeFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';
import createDOMPurify from 'dompurify';
import { marked } from 'marked';

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
const status = args.includes('--status');
const onlyArg = args.find((a) => a.startsWith('--only'));
const only = onlyArg ? (onlyArg.split('=')[1] ?? args[args.indexOf(onlyArg) + 1] ?? '').split(',').filter(Boolean) : null;
const dirIdx = args.indexOf('--from-dir');
const fromDir = dirIdx !== -1 ? args[dirIdx + 1] : null;
const limitArg = args.find((a) => a.startsWith('--limit'));
const limit = limitArg
  ? parseInt(limitArg.split('=')[1] ?? args[args.indexOf(limitArg) + 1] ?? '', 10)
  : null;
if (limitArg && !(limit > 0)) {
  console.error('--limit needs a positive integer, e.g. --limit 8');
  process.exit(1);
}

const data = JSON.parse(readFileSync(file, 'utf8'));
const entries = data.sections.flatMap((s) => s.entries);
const pending = entries.filter(
  (e) => e.url && (only ? only.includes(e.id) : force || !e.snapshot || e.snapshot.status !== 'ok')
);

// --status: report progress and exit. Lets a batched run across several
// conversations (see SKILL.md) resume without inspecting the JSON by hand —
// re-reading the JSON costs context, which is the scarce resource there.
if (status) {
  const done = entries.filter((e) => e.snapshot?.status === 'ok');
  const md = done.filter((e) => e.snapshot.source === 'markdown');
  for (const e of entries) {
    const s = e.snapshot;
    const state = !e.url ? 'no url'
      : s?.status === 'ok' ? `ok (${s.length ?? '?'} chars${s.source === 'markdown' ? ', markdown' : ''})`
      : s?.status === 'failed' ? `failed — ${s.error ?? 'unknown'}`
      : 'PENDING';
    console.log(`  ${state === 'PENDING' ? '·' : ' '} ${e.id.padEnd(40)} ${state}`);
  }
  console.log(`\n${done.length} of ${entries.length} done, ${pending.length} pending.`);
  if (md.length) console.log(`${md.length} came from Markdown (reduced fidelity).`);
  if (pending.length) {
    console.log(`Next batch: node ${process.argv[1]} ${file} --limit 8` + (fromDir ? ` --from-dir ${fromDir}` : ''));
  }
  process.exit(0);
}

// --limit: take the next N pending, so a large bibliography can be worked in
// batches that fit one conversation's context.
const targets = limit ? pending.slice(0, limit) : pending;
console.log(
  `Fetching ${targets.length} of ${entries.length} entries…` +
  (limit && pending.length > targets.length ? ` (${pending.length - targets.length} more pending after this batch)` : '')
);

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

const MIN_TEXT = 500; // below this, treat extraction as failed rather than ship a stub

// MARKDOWN INPUT. Agent web_fetch tools — claude.ai's included — return pages
// already reader-extracted and converted to Markdown, not raw HTML, even when
// raw HTML is explicitly requested. Handing that to Readability does not fail:
// jsdom parses it as one big text node, Readability wraps the blob in a <div>,
// and the snapshot reports "ok" at full length while the reading pane shows
// literal [text](url) link syntax and [[1]](…) footnote markers. So sniff for
// real markup first and convert Markdown properly instead.
function looksLikeHtml(s) {
  return /<(?:html|body|article|main|section|div|p|h[1-6]|table|ul|ol)\b[^>]*>/i.test(s.slice(0, 4000));
}

// Such files may lead with a metadata block ("--- meta-DC.creator: …"), which
// would otherwise render as visible junk at the top of the reading pane.
function stripFrontMatter(md) {
  const s = md.replace(/^﻿/, '');
  if (!/^\s*---/.test(s)) return s;
  const fenced = /^\s*---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(s);
  if (fenced) return s.slice(fenced[0].length);
  // Unterminated block: drop the marker, then the run of key: value lines.
  const lines = s.replace(/^\s*---[ \t]*/, '').split(/\r?\n/);
  let i = 0;
  while (i < lines.length && (/^[\w.\-]+\s*:\s/.test(lines[i]) || lines[i].trim() === '')) i++;
  return lines.slice(i).join('\n');
}

function extract(source, url) {
  if (!looksLikeHtml(source)) {
    const body = stripFrontMatter(source);
    if (body.trim().length < MIN_TEXT) return null;
    // Already reader-extracted upstream, so there is no site chrome to strip —
    // running Readability here would only reintroduce the wrapping bug above.
    return { ...finish(marked.parse(body, { async: false, gfm: true }), url), source: 'markdown' };
  }
  const html = source;
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
    if (!node || node.textContent.trim().length < MIN_TEXT) return null;
    article = {
      content: node.innerHTML,
      byline: null,
      siteName: null,
      excerpt: null,
      length: node.textContent.trim().length,
      title: docTitle || null,
    };
  }
  const out = finish(article.content, url);
  if (out.length < MIN_TEXT) return null;
  return {
    ...out,
    byline: article.byline ?? null,
    siteName: article.siteName ?? null,
    excerpt: article.excerpt ?? null,
    articleTitle: article.title ?? null,
    source: 'html',
  };
}

// Sanitize, then force absolute/safe link and image URLs. Shared by both paths:
// Markdown-sourced content needs the same treatment, and its relative links
// (e.g. "./Annotated_bibliography#cite_note-1") are dead in a standalone file
// unless resolved against the entry URL here.
function finish(contentHtml, url) {
  const purifyWindow = new JSDOM('').window;
  const DOMPurify = createDOMPurify(purifyWindow);
  const clean = DOMPurify.sanitize(contentHtml, {
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
  const root = doc.getElementById('root');
  return {
    html: root.innerHTML,
    length: root.textContent.trim().length,
    byline: null,
    siteName: null,
    excerpt: null,
    articleTitle: null,
  };
}

let ok = 0, failed = 0, fromMarkdown = 0;
for (const entry of targets) {
  process.stdout.write(`  ${entry.id} … `);
  try {
    let source, baseUrl;
    if (fromDir) {
      source = readFileSync(`${fromDir}/${entry.id}.html`, 'utf8');
      baseUrl = entry.url;
    } else {
      const res = await fetchWithTimeout(entry.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      source = await res.text();
      baseUrl = res.url;
    }
    const result = extract(source, baseUrl);
    if (!result) throw new Error(`no article content (under ${MIN_TEXT} chars of text)`);
    entry.snapshot = {
      status: 'ok',
      fetchedAt: new Date().toISOString().slice(0, 10),
      finalUrl: baseUrl,
      ...result,
    };
    ok++;
    if (result.source === 'markdown') fromMarkdown++;
    console.log(`ok (${result.length} chars${result.source === 'markdown' ? ', from markdown' : ''})`);
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
if (fromMarkdown) {
  console.log(
    `Note: ${fromMarkdown} snapshot(s) came from Markdown, not HTML — the source was already\n` +
    'reader-extracted upstream. Expect reduced fidelity (no images, flattened structure) and\n' +
    'verify nothing was truncated. Marked as "source": "markdown" in the JSON.'
  );
}
if (failed) {
  console.log('Failed entries will fall back to live-embed / open-in-new-tab in the viewer.');
  process.exitCode = 2;
}
