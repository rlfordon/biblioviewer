---
name: biblioviewer
description: Convert an annotated bibliography (Word/Markdown/HTML/pasted text with links, citations, and annotations) into a single self-contained HTML viewer file — bibliography sidebar on the left, reading pane on the right, with cached readable copies of each article embedded so embed-blocking and link rot don't break it. Use when the user wants to build, rebuild, edit, or refresh a biblioviewer or bibliography viewer, turn a reading list or research product with links into a shareable readable site, or re-cache/refresh article snapshots in an existing biblioviewer file.
---

# Biblioviewer

Turns any annotated bibliography into ONE self-contained HTML file the user can email or drop in OneDrive. Recipients double-click it — no hosting, no accounts, works offline. The file has: a filterable sidebar of grouped entries (title, tags, citation, annotation), a reading pane showing a cached reader-mode copy of each article (with live-embed and open-in-new-tab fallbacks), keyboard navigation (j/k, /, arrows), dark mode, print styles, and an in-page editor with lock + self-export.

Editing in unlocked (master) copies works at two levels:
- **Quick annotation editing while reading** (the primary authoring flow): hover any annotation in the sidebar or reading pane → ✎ pencil → edit in place (⌘⏎ save, Esc cancel). A floating "Download updated file" pill appears once anything changed.
- **Full edit mode** (Edit button in the sidebar footer): add/edit/reorder/delete entries and sections, edit title/intro/tags, then Export locked and/or master copies.

All tooling lives in this skill directory, whose path depends on the surface —
`~/.claude/skills/biblioviewer/` in Claude Code, `/mnt/skills/user/biblioviewer/` on
claude.ai. Check which exists before running anything; the commands below write `$SKILL`
for it.
- `template.html` — the viewer app with `__BIBLIO_DATA__` / `__BIBLIO_TITLE__` placeholders
- `scripts/fetch_snapshots.mjs` — fetches each URL, extracts readable article HTML (Readability, `<article>`-tag fallback, Markdown conversion for already-extracted input), sanitizes with DOMPurify, writes snapshots into the JSON
- `scripts/build.mjs` — injects JSON into the template → final HTML
- `scripts/extract_data.mjs` — pulls the JSON back out of a built file (for editing/refreshing)
- `scripts/smoke_test.mjs` — headless verification of a built file

## First use

Needs Node 18+. If a script fails with `ERR_MODULE_NOT_FOUND` (git/repo checkout), run `npm install` in the skill directory. The claude.ai upload zip instead ships esbuild-bundled self-contained scripts — no install needed, don't attempt one (rebuild the zip with `bash scripts/make_skill_zip.sh` from a repo checkout).

## Sandboxes without network access (e.g. claude.ai)

If the execution sandbox blocks outbound fetches (claude.ai does):
1. Fetch each article with the web_fetch tool instead and save each to `<dir>/<entry-id>.html`.
2. Run `fetch_snapshots.mjs <bibliography.json> --from-dir <dir>` — it extracts/sanitizes from those files instead of fetching.
3. Build as normal; the output HTML is handed to the user as a downloadable file.

**Save each file complete and verbatim — never abbreviate, summarize, or truncate a long
page.** A partial save still reports `status: "ok"`, so truncation is invisible downstream
and silently ships a half-article to the reader. If a page is too long to write in one go,
write it in successive appends rather than shortening it.

**Expect Markdown, not HTML.** Despite the tool's name, web_fetch on claude.ai returns
pages already reader-extracted and converted to Markdown — asking for "raw HTML" does not
change this. `fetch_snapshots.mjs` detects markup-free input and converts it properly
(front-matter stripped, relative links resolved against the entry URL), tagging the result
`"source": "markdown"` and printing a fidelity warning. That path is lossy by nature: no
images, flattened structure, and whatever the upstream extractor already discarded. Tell
the user their snapshots are reduced-fidelity when it triggers. If real HTML is reachable
by any means, prefer it — the output is materially better.

## Data schema (`bibliography.json`)

```json
{
  "title": "…",
  "intro": ["<p>-less paragraph HTML strings; <strong> etc. allowed"],
  "locked": false,
  "tagDefinitions": [{ "label": "In-depth", "color": "amber" }],
  "sections": [
    { "heading": "…", "entries": [
      { "id": "kebab-unique", "title": "…", "url": "https://…",
        "tags": ["In-depth"], "citation": "Author, Source (Date)",
        "annotation": "2-4 sentence annotation; inline HTML ok",
        "snapshot": { "status": "ok|failed", "fetchedAt": "YYYY-MM-DD", "html": "…",
                      "source": "html|markdown", "...": "written by fetch script — never author by hand" } }
    ] }
  ]
}
```

Tag colors: `amber violet blue green red gray`. Unknown tags get auto-assigned colors at runtime, but prefer declaring them.

## Workflow: new bibliography

1. **Parse the source** (docx/md/html/pasted text) into `bibliography.json` in the working directory, following the schema. Preserve the user's citation style verbatim; strip conversion artifacts (e.g. `[cite: 1]`). Keep their section grouping — the annotation and grouping ARE the research product, don't editorialize them.
2. **Fetch snapshots**: `node $SKILL/scripts/fetch_snapshots.mjs bibliography.json`
   - Exit code 2 = some entries failed; they're marked `status: "failed"` and the viewer falls back gracefully. For failures, check whether the page is JS-only or bot-blocked (`curl -sL <url> | head`); if the content is genuinely there but extraction failed, investigate; otherwise leave the fallback.
   - `--only id1,id2` refetches specific entries; `--force` refetches everything.
3. **Build both copies**:
   - `node $SKILL/scripts/build.mjs bibliography.json <slug>-master.html` (editable — the user keeps this)
   - `node $SKILL/scripts/build.mjs bibliography.json <slug>.html --locked` (clean read-only copy to share)
4. **Verify**: `node $SKILL/scripts/smoke_test.mjs <file>` on both. If the Chrome extension is connected, also open the file visually.
5. Tell the user: master = keep and edit; locked = share. In-page edits are exported via the Edit → Export buttons; snapshots for NEW entries require a rebuild (workflow below).

## Workflow: update/refresh an existing biblioviewer file

1. `node $SKILL/scripts/extract_data.mjs <their-file.html> bibliography.json`
2. Apply requested changes to the JSON (or the user already edited in-browser — extraction preserves their edits).
3. Refetch as needed (`fetch_snapshots.mjs` only fetches entries without an `ok` snapshot by default).
4. Rebuild master + locked, smoke test, deliver.

## Notes and guardrails

- **Copyright posture** (course-pack analogy, per Georgia State e-reserves takeaways): cached full text is appropriate for freely available web content shared privately with a small group, with attribution and a link to the original (the viewer shows both). For paywalled or subscription-gated sources, prefer link-only: delete the snapshot or skip fetching (`--only` the others), so the entry falls back to open-in-new-tab. If the user plans wide/public distribution, suggest they check with their library's copyright office.
- **Locked-file failsafe**: opening a locked copy with `#unlock` appended to the URL reveals the editor (convenience, not security).
- **PDFs are not yet embedded** — a PDF URL entry will snapshot poorly or fail; leave it as link-only and tell the user. (Possible future: pre-extract PDF text or bundle PDF.js.)
- Images in snapshots are hot-linked (lazy-loaded); offline they simply don't render — text is unaffected.
- The file targets modern browsers (`<dialog>`, flexbox). Typical size: ~300 KB for ~25 articles; warn the user if a huge bibliography approaches email-attachment limits (~20 MB).
- Draft edits auto-back-up to the browser's localStorage; the export buttons are the real "save".
