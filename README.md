# Reddit → Markdown

A tiny Chrome (Manifest V3) extension that turns the Reddit thread you are
reading into clean Markdown on your clipboard — post frontmatter, post body,
and (optionally) the comment tree with real blockquote nesting.

No bundler, no build step, no network calls, no telemetry. The only third-party
code is vendored as plain files in `vendor/`.

## What it does

- Reads post metadata from the page: title, subreddit, author, URL, date, score.
- Converts the post body HTML to Markdown with
  [Turndown](https://github.com/mixmark-io/turndown) + the GFM plugin, so
  headings, lists, links, tables and fenced code blocks survive.
- Walks the comment tree in document order and renders nesting as repeated
  `>` markers (depth 0 → one `>`, depth 1 → `> >`, …).
- Copies everything to the clipboard and shows a short in-page toast.

## Install (unpacked)

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder (`reddit-copy-markdown`).
4. Open a Reddit thread and press `Ctrl+Shift+M` (`Cmd+Shift+M` on macOS).

If the shortcut is taken by another extension, Chrome silently leaves it
unbound — check `chrome://extensions/shortcuts` and set a different combo there.
The context menu and the popup button always work.

## Usage

Three ways to copy the current thread:

| Method | How |
|---|---|
| Keyboard | `Ctrl+Shift+M` (custom command, handled by the service worker) |
| Context menu | Right-click the page → **Copy thread as Markdown** |
| Popup | Click the toolbar icon → **Copy this thread** |

Paste into Obsidian, Notion, GitHub, or any Markdown editor.

## Options

Stored in `chrome.storage.sync` under the key `rcm:options`; edited in the
popup and saved on change.

| Option | Default | Meaning |
|---|---|---|
| `includeComments` | `true` | Append the `## Comments` section. Turn off for fast link-saving. |
| `includeScores` | `true` | Include `· N points` in each comment header. |
| `maxDepth` | `5` | Maximum nesting levels kept (depth 0–4). Comments deeper than this are skipped. |
| `maxComments` | `200` | Hard cap on the number of comments converted. |

## Output example

```markdown
---
title: "Post title"
subreddit: "r/programming"
author: "u/someone"
url: "https://www.reddit.com/r/programming/comments/abc123/post_title/"
date: "2026-10-28"
score: 1420
---

Post body in **Markdown**, images as `![](url)`, links preserved.

## Comments

> **u/commenter** · 512 points
>
> Comment text as a quote…

> > **u/replier** · 88 points
> >
> > Nested reply (blockquote depth = nesting depth)…
```

Every line of a comment — including its header and blank separator lines — is
prefixed with exactly `depth + 1` blockquote markers, so a 3-level thread
(`depth` 0, 1, 2) yields 1, 2 and 3 markers respectively.

## File layout

```
manifest.json              MV3 manifest, commands, content-script order
background.js              service worker: context menu + command → COPY_THREAD
extract-new.js             new UI (shreddit-* web components)
extract-old.js             old.reddit.com (table / div.thing)
content.js                 orchestration, Markdown assembly, clipboard, toast
popup.html / .css / .js    options + "copy now"
vendor/turndown.js         Turndown 7.2.0 (MIT)
vendor/turndown-plugin-gfm.js  turndown-plugin-gfm 1.0.2 (MIT)
icons/16|48|128.png        toolbar icons
```

Both extractors expose the same interface:

```js
window.RedditExtractX = {
  matches(),        // is this the page type I handle?
  extract(options), // -> { ok: true, meta, body, comments: [{ depth, author, score, text }] }
};
```

## Known limitations

- **Only comments already in the DOM.** Reddit paginates comments and hides
  deeply nested ones behind "load more" / "continue this thread" links. This
  extension does not fetch more; what you see after expanding is what you get.
- **No Readability fallback.** The original plan included it as a safety net.
  It was intentionally dropped: Readability flattens the comment tree, which
  defeats the point, and adds ~120 KB of vendored code for a path that would
  rarely produce better output. If Reddit changes its markup, the extractors
  return a clear error toast rather than silently emitting junk.
- **Reddit's DOM and attribute names change often.** All selectors and
  attribute names are centralised in the `SELECTORS` block at the top of each
  extractor. Update those first when extraction breaks.
- **Open shadow DOM only.** `deepQuery()` recurses into `shadowRoot`, but a
  closed shadow root cannot be reached from a content script.
- **Only `reddit.com`, `www.reddit.com` and `old.reddit.com` are matched.**
  Other subdomains (`new.reddit.com`, `sh.reddit.com`) load the content script
  but no extractor claims them, so you get a "not a Reddit thread" toast.
  Subreddit listings and other non-thread pages behave the same way.
- **Clipboard needs a focused document.** Copying normally happens while the
  page has focus. When triggered from the popup, the popup holds focus, so the
  `navigator.clipboard` write may be rejected and the `execCommand` fallback is
  used instead; success is reported only if one of the two actually worked.
- **Huge threads are slow.** Converts on the main thread; keep `maxComments`
  low on enormous threads.
- **Not verified in a browser.** The code was statically checked and the
  Markdown assembly traced by hand, but it has not been exercised against live
  Reddit pages from this environment.

## Licence

Extension code: MIT (see `LICENSE`). Vendored libraries keep their own MIT
licences, copyrighted by their respective authors.
