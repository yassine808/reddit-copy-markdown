/* Extractor for the current ("new") Reddit UI: shreddit-* web components.

   Public interface (consumed by content.js):
     window.RedditExtractNew = { matches(), extract(options) }
     extract() -> { ok: true, meta, body, comments: [{ depth, author, score, text }] }

   Selector/attribute names live in SELECTORS below because Reddit changes them
   fairly often; this is the one block to edit when the page markup moves. */

/* global TurndownService, turndownPluginGfm */
(function () {
  "use strict";

  const SELECTORS = {
    post: "shreddit-post",
    postTitle: 'h1, [slot="title"]',
    textBody: '[slot="text-body"]',
    comment: "shreddit-comment",
    commentBody: '[slot="comment"]',
    commentMarkdown: ".md",
    fullPostLink: 'a[slot="full-post-link"]',
    time: "time[datetime]",
  };

  const THREAD_PATH = /^\/r\/[^/]+\/comments\//;

  /* ---------------------------------------------------------------- DOM ---- */

  /** First match, descending into open shadow roots. */
  function deepQuery(root, selector) {
    if (!root) return null;
    if (typeof root.querySelector === "function") {
      const direct = root.querySelector(selector);
      if (direct) return direct;
    }
    if (typeof root.querySelectorAll !== "function") return null;
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) {
        const found = deepQuery(el.shadowRoot, selector);
        if (found) return found;
      }
    }
    return null;
  }

  /** All matches, descending into open shadow roots (light DOM matches first). */
  function deepQueryAll(root, selector, out) {
    const acc = out || [];
    if (!root) return acc;
    if (typeof root.querySelectorAll === "function") {
      acc.push.apply(acc, root.querySelectorAll(selector));
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) deepQueryAll(el.shadowRoot, selector, acc);
      }
    }
    return acc;
  }

  function textOf(root, selector) {
    const el = deepQuery(root, selector);
    return el ? (el.textContent || "").trim() : "";
  }

  /* --------------------------------------------------------- conversion ---- */

  let turndownService = null;

  function turndown() {
    if (turndownService) return turndownService;
    if (typeof TurndownService === "undefined") {
      throw new Error("Turndown is not loaded");
    }
    turndownService = new TurndownService({
      codeBlockStyle: "fenced",
      headingStyle: "atx",
      bulletListMarker: "-",
      emDelimiter: "*",
      strongDelimiter: "**",
      hr: "---",
    });
    if (typeof turndownPluginGfm !== "undefined" && turndownPluginGfm.gfm) {
      turndownService.use(turndownPluginGfm.gfm);
    }
    // Never let page chrome ("Reply", "Share", icons) leak into the Markdown.
    turndownService.remove(["script", "style", "noscript", "button", "svg"]);
    return turndownService;
  }

  function absoluteUrl(value) {
    if (!value) return value;
    try {
      return new URL(value, location.href).href;
    } catch (err) {
      return value;
    }
  }

  /** Resolve relative href/src so pasted Markdown links work outside Reddit. */
  function absolutize(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const a of doc.querySelectorAll("a[href]")) {
      a.setAttribute("href", absoluteUrl(a.getAttribute("href")));
    }
    for (const img of doc.querySelectorAll("img[src]")) {
      img.setAttribute("src", absoluteUrl(img.getAttribute("src")));
    }
    return doc.body.innerHTML;
  }

  function htmlToMarkdown(html) {
    const source = (html || "").trim();
    if (!source) return "";
    return turndown().turndown(absolutize(source)).trim();
  }

  /* ----------------------------------------------------------- metadata ---- */

  function normalizeDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (!isNaN(date.getTime())) return date.toISOString().slice(0, 10);
    const match = String(value).match(/\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : "";
  }

  function parseScore(value) {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim().replace(/,/g, "");
    if (!raw) return null;
    const match = raw.match(/^(-?\d+(?:\.\d+)?)\s*([kKmM])?$/);
    if (!match) {
      const digits = raw.match(/-?\d+/);
      return digits ? parseInt(digits[0], 10) : null;
    }
    let score = parseFloat(match[1]);
    if (match[2]) score *= /k/i.test(match[2]) ? 1000 : 1000000;
    return Math.round(score);
  }

  function normalizeSubreddit(value) {
    const raw = String(value || "").trim().replace(/^\/+/, "");
    if (!raw) return "";
    return /^r\//i.test(raw) ? raw : "r/" + raw;
  }

  function normalizeAuthor(value) {
    const raw = String(value || "").trim().replace(/^\/?u\//i, "");
    return raw ? "u/" + raw : "";
  }

  function depthOf(el) {
    const raw = parseInt(el.getAttribute("depth"), 10);
    if (Number.isFinite(raw)) return raw;
    let depth = 0;
    let parent = el.parentElement;
    while (parent) {
      if (parent.tagName && parent.tagName.toLowerCase() === SELECTORS.comment) depth += 1;
      parent = parent.parentElement;
    }
    return depth;
  }

  /* --------------------------------------------------------------- body ---- */

  function mediaImages(post) {
    const urls = [];
    for (const img of deepQueryAll(post, "img")) {
      const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
      if (!src || /^(data|blob):/i.test(src)) continue;
      if (/(avatar|icon|snoo|emoji|favicon)/i.test(src)) continue;
      const resolved = absoluteUrl(src);
      if (urls.indexOf(resolved) === -1) urls.push(resolved);
    }
    return urls;
  }

  function externalLink(post) {
    const candidates = [post.getAttribute("content-href"), post.getAttribute("url")];
    const linkEl = deepQuery(post, SELECTORS.fullPostLink);
    if (linkEl && linkEl.getAttribute("href")) candidates.push(linkEl.getAttribute("href"));
    for (const candidate of candidates) {
      if (!candidate) continue;
      const resolved = absoluteUrl(candidate);
      if (/\/r\/[^/]+\/comments\//.test(resolved)) continue;
      return resolved;
    }
    return "";
  }

  function extractBody(post) {
    const bodyEl = deepQuery(post, SELECTORS.textBody);
    if (bodyEl && bodyEl.innerHTML && bodyEl.innerHTML.trim()) {
      const text = htmlToMarkdown(bodyEl.innerHTML);
      if (text) return text;
    }

    // Image / gallery / link post: synthesise something useful.
    const chunks = [];
    const link = externalLink(post);
    if (link) chunks.push("[" + link + "](" + link + ")");
    for (const url of mediaImages(post)) chunks.push("![](" + url + ")");
    return chunks.join("\n\n");
  }

  /* ----------------------------------------------------------- comments ---- */

  function extractComments(options) {
    const unlimited = options.unlimited === true;
    const maxDepth = unlimited
      ? Infinity
      : Number.isFinite(options.maxDepth)
        ? options.maxDepth
        : 5;
    const maxComments = unlimited
      ? Infinity
      : Number.isFinite(options.maxComments)
        ? options.maxComments
        : 200;

    const comments = [];
    for (const node of deepQueryAll(document, SELECTORS.comment)) {
      if (comments.length >= maxComments) break;
      const depth = depthOf(node);
      if (depth < 0 || depth >= maxDepth) continue;

      const author = (node.getAttribute("author") || "").trim();
      const normalizedAuthor = normalizeAuthor(author);
      const isDeleted = /^u\/\[(deleted|removed)\]$/i.test(normalizedAuthor) || !author;
      if (isDeleted && !options.includeDeleted) continue;

      const bodyEl = deepQuery(node, SELECTORS.commentBody);
      let text = "";
      if (bodyEl) {
        const markdownEl = deepQuery(bodyEl, SELECTORS.commentMarkdown) || bodyEl;
        text = htmlToMarkdown(markdownEl.innerHTML);
      }
      if (!text && !options.includeDeleted) continue;

      comments.push({
        depth: depth,
        author: normalizedAuthor || "u/[unknown]",
        score: parseScore(node.getAttribute("score")),
        text: text || "_[removed]_",
      });
    }
    return comments;
  }

  /* ------------------------------------------------------------- public ---- */

  function matches() {
    const host = location.hostname;
    if (host !== "reddit.com" && host !== "www.reddit.com") return false;
    return THREAD_PATH.test(location.pathname);
  }

  function extract(options) {
    const opts = options || {};
    const post = deepQuery(document, SELECTORS.post);
    if (!post) {
      return { ok: false, error: "No post found on this page (Reddit markup may have changed)." };
    }

    const title =
      (post.getAttribute("post-title") || "").trim() ||
      textOf(post, SELECTORS.postTitle) ||
      (document.title || "").replace(/\s*[:\-]\s*r\/.*$/i, "").trim();

    const subreddit =
      normalizeSubreddit(post.getAttribute("subreddit-prefix")) ||
      normalizeSubreddit((location.pathname.match(/^\/r\/([^/]+)/) || [])[1] || "");

    const timestamp =
      post.getAttribute("created-timestamp") ||
      (deepQuery(post, SELECTORS.time) || {}).dateTime ||
      "";

    const meta = {
      title: title,
      subreddit: subreddit,
      author: normalizeAuthor(post.getAttribute("author")),
      url: location.href,
      date: normalizeDate(timestamp),
      score: parseScore(post.getAttribute("score")),
    };

    return {
      ok: true,
      meta: meta,
      body: extractBody(post),
      comments: opts.includeComments === false ? [] : extractComments(opts),
    };
  }

  window.RedditExtractNew = {
    matches: matches,
    extract: extract,
    // Exposed for debugging in the page console.
    deepQuery: deepQuery,
    deepQueryAll: deepQueryAll,
  };
})();
