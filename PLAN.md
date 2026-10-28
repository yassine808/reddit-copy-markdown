# Reddit → Markdown Copier — Plan

Chrome (MV3) extension: one click (or shortcut) turns the current Reddit page
into clean Markdown on the clipboard — post header, body, and optionally the
comment tree.

Target sites: `reddit.com` (new UI), `old.reddit.com`, and `reddit.com/r/*/comments/*`.

---

## 1. Goal

I read a Reddit thread, hit the shortcut, and paste a readable Markdown
document into Obsidian / notes. No bundler, no server, no telemetry.

## 2. MVP output shape

```markdown
---
title: "Post title"
subreddit: r/programming
author: u/someone
url: https://reddit.com/r/...
date: 2026-10-28
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

## 3. Scope

**In:** post metadata + body, comment tree with nesting, score, author,
timestamp, copy to clipboard, keyboard shortcut, options popup
(include comments / max depth / max comments / include scores).

**Out (v1):** offline archive, image downloading, saving to file,
multi-page exports, subreddit listing pages (show a clear "not a thread" toast).

## 4. Approach (lazy ladder)

1. **Reuse, don't write:** vendor two proven MIT libs as plain files —
   - `turndown.js` + `turndown-plugin-gfm` for HTML→Markdown
   - `Readability.js` only as a **fallback** extractor
2. **Primary extraction is selector-based**, not Readability, because
   Readability flattens the comment tree and I want structure preserved.
3. **Clipboard:** `navigator.clipboard.writeText()` from the content script
   (has focus + user gesture). Fallback: `document.execCommand('copy')` via a
   temporary textarea. No offscreen document needed in v1.

## 5. File layout

```
reddit-copy-markdown/
  manifest.json          # MV3, activeTab + clipboardWrite + storage, commands
  content.js             # orchestrator: detect page type → extract → convert → copy
  extract-new.js         # new UI (shreddit-* web components)
  extract-old.js         # old.reddit.com tables/divs
  vendor/turndown.js
  vendor/turndown-plugin-gfm.js
  vendor/Readability.js
  popup.html / popup.css / popup.js   # options + "copy now" button
  icons/16|48|128.png
  README.md
  PLAN.md
```

Content scripts load in order: vendors → `extract-old.js` → `extract-new.js` →
`content.js`.

## 6. Milestones

**M1 — New UI, post only**
- [ ] Metadata from `shreddit-post` attributes (`post-title`, `author`,
      `score`, `created-timestamp`, `subreddit-prefix`).
- [ ] Body from `[slot="text-body"]` → Turndown with GFM.
- **Acceptance:** a text post and an image post both produce valid Markdown
  with correct frontmatter.

**M2 — Comment tree (new UI)**
- [ ] Walk `shreddit-comment` elements, honouring `depth` attributes.
- [ ] Respect "load more comments" limit: only what's in the DOM (documented).
- **Acceptance:** 3-level thread nests exactly 3 blockquote levels; scores match
  the page.

**M3 — Clipboard + shortcut**
- [ ] `Ctrl+Shift+M` (via `chrome.commands`) triggers copy on the active tab.
- [ ] Success toast in-page; failure toast with reason.
- **Acceptance:** paste into Obsidian renders headings, quotes, links, code.

**M4 — old.reddit.com support**
- [ ] Separate extractor behind the same interface `extract() → {meta, body, comments[]}`.
- **Acceptance:** same output shape from an equivalent old.reddit thread.

**M5 — Popup options**
- [ ] Toggles persist in `chrome.storage.sync`; a "Copy now" button.
- [ ] "Strip comments" mode for fast link-saving.

## 7. Risks

| Risk | Mitigation |
|---|---|
| New UI uses **shadow DOM** → `querySelector` misses nodes | Traverse `shadowRoot` recursively with a small `deepQuery()` helper |
| Reddit DOM/attribute names change often | Keep selectors in one `SELECTORS` const block, add Readability fallback |
| `navigator.clipboard` rejected without focus | textarea + `execCommand` fallback, plus a "click to copy" prompt |
| Turndown mangles Reddit's `<pre><code>` | Configure `codeBlockStyle: 'fenced'`, test a code-heavy thread |
| Huge threads → slow | Cap comments (default 200) and depth (default 5) in options |

## 8. Open questions (confirm before M1)

1. FireFox too? (MV3 background differences; `commands` works the same.)
2. Should comments default **on** or **off**?
3. Also support saving as `.md` file via download, or clipboard only?
