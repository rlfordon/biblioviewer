// Headless smoke test for a built biblioviewer HTML file.
// Usage: node scripts/smoke_test.mjs <built-file.html>
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync(process.argv[2], 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'file:///test/biblio.html',
  virtualConsole: vc,
  beforeParse(window) {
    window.HTMLElement.prototype.scrollIntoView = function () {};
    window.URL.createObjectURL = (blob) => { window.__lastExportBlob = blob; return 'blob:fake'; };
    window.URL.revokeObjectURL = () => {};
  },
});

const { document } = dom.window;
// jsdom doesn't implement <dialog> methods; all target browsers do.
for (const dlg of document.querySelectorAll('dialog')) {
  dlg.showModal = function () { this.setAttribute('open', ''); };
  dlg.close = function (v) {
    if (v !== undefined) this.returnValue = v;
    this.removeAttribute('open');
    this.dispatchEvent(new dom.window.Event('close'));
  };
}

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

const entryCount = $$('.entry').length;
check('title set', document.title.length > 3, document.title);
check('sidebar title rendered', $('#biblio-title').textContent.length > 3);
check('sections rendered', $$('.section-heading').length >= 1);
check('entries rendered', entryCount >= 1, String(entryCount));
check('welcome view shown', !!$('.welcome'));

// Select first entry (re-query after render)
$$('.entry')[0].click();
check('entry selected', $$('.entry[aria-selected="true"]').length === 1);
check('detail shows title', $('.art-title') && $('.art-title').textContent.length > 5);
const hasSnap = !!$('.snap-banner');
if (hasSnap) {
  check('article body rendered', $('.article-body') && $('.article-body').textContent.length > 500,
    $('.article-body') ? String($('.article-body').textContent.length) : 'missing');
  const liveBtn = [...$('.snap-banner').querySelectorAll('button')].find((b) => /live/i.test(b.textContent));
  if (liveBtn) {
    liveBtn.click();
    check('live iframe view works', !!$('#live-frame'));
  }
} else {
  check('fallback card shown for uncached entry', !!$('.fallback-card'));
}

// Filter
const filter = $('#filter');
filter.value = 'zzz-no-match-zzz';
filter.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
check('filter can empty list', $$('.entry').length === 0);
filter.value = '';
filter.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
check('filter clears', $$('.entry').length === entryCount);

// Keyboard nav
document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'j', bubbles: true }));
check('j/k selection works', $$('.entry[aria-selected="true"]').length === 1);

// Locked vs editable behavior
const dataScript = JSON.parse($('#biblio-data').textContent);
if (dataScript.locked) {
  check('toolbar hidden when locked', $('#toolbar').classList.contains('hidden'));
  check('no annotation pencils when locked', $$('.annot-pencil').length === 0);
} else {
  // Inline annotation quick-edit (no edit mode required)
  check('annotation pencils present', $$('.annot-pencil').length > 0);
  const wrap = $('.entry .annot-wrap');
  wrap.querySelector('.annot-pencil').click();
  const ta = wrap.querySelector('.annot-editor textarea');
  check('inline editor opens', !!ta);
  // Regression: Space/Enter typed in the editor must not select the row and kill the editor
  for (const key of [' ', 'Enter']) {
    ta.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }
  check('space/enter in editor does not destroy it', !!document.contains(ta) && !!$('.annot-editor textarea'));
  ta.value = 'INLINE-EDIT-ANNOTATION';
  [...wrap.querySelectorAll('.annot-editor button')].find((b) => b.textContent === 'Save').click();
  check('inline edit saves', $$('.entry-annot').some((n) => n.textContent === 'INLINE-EDIT-ANNOTATION'));
  check('save pill appears after edit', !$('#save-pill').hidden);
  check('toast announced', $('#toast').textContent.includes('download'));
  check('toolbar visible when editable', !$('#toolbar').classList.contains('hidden'));
  $('#btn-edit').click();
  check('edit mode toggles', document.body.classList.contains('editing'));
  check('export button visible', !$('#btn-export').hidden);
  check('entry edit controls exist', $$('.edit-controls .ebtn').length >= entryCount);
  // Round-trip: edit an entry via the dialog
  const editBtn = $('.edit-controls .ebtn');
  editBtn.click();
  check('entry dialog opens', $('#dlg-entry').hasAttribute('open'));
  $('#f-title').value = 'SMOKE-TEST-TITLE';
  $('#dlg-entry').close('save');
  check('entry edit round-trips', $$('.entry-title').some((n) => n.textContent === 'SMOKE-TEST-TITLE'));
  // Export dialog opens
  $('#btn-export').click();
  check('export dialog opens', $('#dlg-export').hasAttribute('open'));
  $('#btn-export-locked').click();
  check('locked export runs without error', errors.length === 0, errors.slice(0, 2).join(' | '));
}

// Round-trip the in-page export: boot the exported file and verify it's locked
// and carries the edit made above.
if (dom.window.__lastExportBlob) {
  const exported = await dom.window.__lastExportBlob.text();
  const dom2 = new JSDOM(exported, {
    runScripts: 'dangerously',
    url: 'file:///test/exported.html',
    virtualConsole: vc,
    beforeParse(window) { window.HTMLElement.prototype.scrollIntoView = function () {}; },
  });
  const doc2 = dom2.window.document;
  check('exported copy renders entries', doc2.querySelectorAll('.entry').length === entryCount,
    String(doc2.querySelectorAll('.entry').length));
  check('exported copy is locked', doc2.querySelector('#toolbar').classList.contains('hidden'));
  check('exported copy carries the edit',
    [...doc2.querySelectorAll('.entry-title')].some((n) => n.textContent === 'SMOKE-TEST-TITLE'));
  check('exported copy keeps snapshots', JSON.parse(doc2.querySelector('#biblio-data').textContent)
    .sections.flatMap((s) => s.entries).some((e) => e.snapshot?.status === 'ok'));
}

check('no JS errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
