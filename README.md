# biblioviewer

Turn an annotated bibliography into a **single self-contained HTML file**: your bibliography in a sidebar on the left, a reading pane on the right, with clean cached copies of every linked article embedded in the file itself.

Send the file to anyone — they double-click it and read. No hosting, no accounts, no broken embeds, no link rot. Works offline.

## Why

Annotated bibliographies are research products, but as documents they read poorly: a wall of links that scatter your readers across paywalls, embed-blocked sites, and eventually dead URLs. Biblioviewer makes the bibliography itself the reading interface:

- **Sidebar**: grouped entries with title, citation, tags, and your annotation, filterable (`/`), keyboard-navigable (`↑`/`↓`, `j`/`k`)
- **Reading pane**: a reader-mode snapshot of each article (Mozilla Readability, sanitized with DOMPurify), captured at build time — with a "view original" link and live-embed / open-in-new-tab fallbacks
- **Inline editing**: hover an annotation → ✎ → edit in place while you read; a "Download updated file" button exports your revised copy
- **Edit mode + lock**: full structural editing (add/reorder/delete entries and sections), then export a locked read-only copy for distribution
- Dark mode, print stylesheet, responsive down to phones. One file, zero runtime dependencies.

## Use as a Claude skill (recommended)

This repo is an [Agent Skill](https://code.claude.com/docs/en/skills) for Claude Code / claude.ai. Install:

```bash
git clone https://github.com/rlfordon/biblioviewer ~/.claude/skills/biblioviewer
npm install --prefix ~/.claude/skills/biblioviewer
```

Then in any Claude Code session, hand over a bibliography in any format ("turn this into a biblioviewer") and Claude parses it, fetches snapshots, builds master + locked copies, and runs the test suite.

### On claude.ai: works, but not usefully

The skill can be packaged for claude.ai — run `bash scripts/make_skill_zip.sh` and upload the resulting zip at [claude.ai/customize/skills](https://claude.ai/customize/skills). (Bundle the zip that way rather than zipping the folder yourself: claude.ai rejects archives containing `@` in paths, which rules out shipping `node_modules`. The script esbuild-bundles each script instead, so no install is needed in the sandbox.)

**But snapshot caching is impractical there, and that is most of the point of this tool.** Tested 2026-07-19: claude.ai's sandbox blocks outbound fetches, so each article has to arrive as a `web_fetch` result and leave again as output tokens to reach disk — roughly twice its size in context. A three-entry bibliography ran for several minutes and exhausted the conversation without finishing. Batching across conversations doesn't fix a per-entry cost that high.

Two smaller findings from the same test: `web_fetch` returns pages already converted to Markdown, not raw HTML, even when raw HTML is requested (the fetch script detects this and converts properly, flagging the snapshot `"source": "markdown"`, but fidelity is reduced); and the skill lands at `/mnt/skills/user/biblioviewer/` rather than `~/.claude/skills/`.

Use Claude Code, where the bytes go URL → disk without passing through a context window and article count is irrelevant. The *output* file needs nothing installed — that's the part to share with non-technical colleagues.

## Use by hand

Requires Node 18+.

```bash
npm install

# 1. Write your bibliography as JSON (schema in SKILL.md)
# 2. Capture article snapshots into it:
node scripts/fetch_snapshots.mjs bibliography.json

# 3. Build:
node scripts/build.mjs bibliography.json my-biblio-master.html            # editable master (keep)
node scripts/build.mjs bibliography.json my-biblio.html --locked          # read-only copy (share)

# Verify:
node scripts/smoke_test.mjs my-biblio.html

# Later: pull the data back out of a built file to refresh or extend it
node scripts/extract_data.mjs my-biblio-master.html bibliography.json
```

`fetch_snapshots.mjs` flags: `--only id1,id2` (refetch specific entries), `--force` (refetch all), `--status` (report progress, fetch nothing), `--limit N` (cap a run to N pending entries), `--max-chars N` (store only a preview of each article), `--from-dir dir` (offline mode: extract from pre-downloaded `<entry-id>.html` files instead of fetching).

## A note on cached copies

Snapshots embed the full text of linked articles in the file. That's appropriate for freely available web content shared privately with a small group (attribution and a link to the original are always displayed) — the same posture as course e-reserves. For paywalled or licensed content, skip the snapshot and let the entry fall back to a link. If you plan wide or public distribution of a built file, talk to your library's copyright office first; and don't commit built files or `bibliography.json` to public repos (this repo's `.gitignore` already prevents it).

## License

MIT
