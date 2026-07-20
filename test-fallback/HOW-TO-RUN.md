# Sandbox fallback test (claude.ai)

> **This test has been run — 2026-07-19. Results below; kept as a record and in
> case the sandbox's behavior changes later.**
>
> 1. **web_fetch returns Markdown, not HTML**, even when raw HTML is explicitly
>    requested. No tags at all: links as `[text](url)`, footnotes as `[[1]](…)`,
>    plus a leading metadata block on some sources.
> 2. **Nothing failed loudly.** Readability accepted the Markdown, wrapped it in
>    a `<div>`, and every entry reported `status: "ok"` at near-full length while
>    the reading pane showed the literal Markdown syntax. `fetch_snapshots.mjs`
>    now sniffs for markup and converts Markdown properly instead.
> 3. **It does not scale.** A second three-entry run exhausted the conversation's
>    context without finishing, after several minutes. Each article costs roughly
>    twice its size in tokens — in as a fetch result, out as a file write — and
>    batching doesn't rescue that. The claude.ai path is documented as a fallback
>    for two or three entries, not a way to build a real bibliography.
> 4. Claude also truncated one long page rather than failing, which reported
>    `"ok"` too. `SKILL.md` now requires complete verbatim saves via successive
>    appends.

Goal: find out what claude.ai's web-fetch tool actually hands back when the
skill asks for page HTML — real markup, or text that's already been flattened.

`SKILL.md` currently instructs Claude to fetch "raw page HTML" and save it for
`fetch_snapshots.mjs --from-dir` to process. That instruction has never been
verified. This test settles it.

**Why it matters:** `fetch_snapshots.mjs` runs Mozilla Readability over the
saved files. Readability needs a DOM. If the fetch tool returns flattened text,
there is no DOM to work on and the whole `--from-dir` path is broken — in which
case the fix is to skip Readability entirely and write the returned text into
`snapshot.html` as paragraph markup.

Whatever is true here is almost certainly true in Cowork, which shares the
same sandbox constraints.

## Setup

1. Make sure the biblioviewer skill is installed and enabled at
   [claude.ai/customize/skills](https://claude.ai/customize/skills), and that
   code execution is on under Settings → Capabilities.
2. Start a new chat and attach `bibliography.json` from this folder.
3. Paste the prompt below.

## The prompt

> I've attached a small bibliography.json. Please build it into a biblioviewer,
> following the "Sandboxes without network access" workflow in the skill.
>
> Before you run fetch_snapshots.mjs, I need to inspect what your web fetch
> actually returned. After you've saved the fetched pages to disk, stop and
> show me:
>
> 1. The exact byte size of each saved file.
> 2. The first 40 lines of the Wikipedia one, verbatim, in a code block — do
>    not summarize, reformat, or clean it up. I need to see the literal file
>    contents, including whatever tags or lack of tags are in there.
>
> Then continue with the build and tell me whether each entry ended up with
> snapshot status "ok" or "failed".

The "verbatim, do not summarize" wording is load-bearing. Without it Claude
will tend to describe the file instead of showing it, and description is
exactly what this test cannot use.

## Reading the result

Look at those first 40 lines and score it:

| What you see | Verdict | What it means |
|---|---|---|
| `<!DOCTYPE html>`, `<head>`, `<script>`, nav markup | **Raw HTML** | `SKILL.md` is correct as written. No change needed. |
| `<p>`, `<h2>`, `<a href>` but no page chrome | **Pre-extracted HTML** | Good enough — Readability will still work. Consider noting it. |
| Markdown (`## Heading`, `[text](url)`) | **Flattened** | `--from-dir` is broken. Add the text-to-paragraphs mode. |
| Prose with no markup at all | **Flattened** | Same as above. |

Cross-check with the snapshot statuses: if all three come back `"failed"`,
that corroborates a flattened return regardless of what the file head looked
like.

Also worth noting as you go:

- Did Claude try to run `npm install` at any point? It shouldn't — the release
  zip ships bundled scripts. If it did, `SKILL.md:23` needs to be firmer.
- Did the final HTML come back as a real download?
- Roughly how long did the whole thing take? Three entries is small; if it's
  painfully slow, a 25-entry bibliography may not be practical on this surface.

## Report back

The first 40 lines and the three snapshot statuses are enough for me to decide
whether `SKILL.md` needs the third mode, and to finish the README install
section with an accurate description of how this surface behaves.

## Note on the URLs

The three sources were picked for structural variety, not subject. If any of
them 404 or get bot-blocked, swap in any freely available page — the
diagnostic doesn't depend on these specific URLs, though keeping one
Wikipedia-style page is useful since heavy markup makes flattening obvious.
