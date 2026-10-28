/* Extractor for old.reddit.com (table / div.thing markup).

   Same interface as extract-new.js:
     window.RedditExtractOld = { matches(), extract(options) }
     extract() -> { ok: true, meta, body, comments: [{ depth, author, score, text }] } */

/* global TurndownService, turndownPluginGfm */
(function () {
  "use strict";

  const SELECTORS = {
    post: "#siteTable div.thing, #siteTable .thing",
    postTitle: "a.title",
    postBody: ".usertext-body .md",
    comments: "div.commentarea div.thing.comment",
    commentBody: ".entry .usertext-body .md, .usertext-body .md",
  };

  const THREAD_PATH = /^\/r\/[^/]+\/comments\//;

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
    if (value === null || value === undefined || value === "") return "";
    const numeric = Number(value);
    const date = Number.isFinite(numeric) && String(value).trim() !== ""
      ? new Date(numeric * 1000) // old.reddit data-timestamp is Unix seconds
      : new Date(value);
    if (!isNaN(date.getTime())) return date.toISOString().slice(0, 10);
    const match = String(value).match(/\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : "";
  }

  function parseScore(value) {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim().replace(/,/g, "");
    if (!raw) return null;
    const match = raw.match(/^(-?\d+)\s*([kKmM])?$/);
    if (!match) {
      const digits = raw.match(/-?\d+/);
      return digits ? parseInt(digits[0], 10) : null;
    }
    let score = parseInt(match[1], 10);
    if (match[2]) score *= /k/i.test(match[2]) ? 1000 : 1000000;
    return score;
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

  function attr(el, name) {
    return el && el.getAttribute ? (el.getAttribute(name) || "").trim() : "";
  }

  /* --------------------------------------------------------------- body ---- */

  function extractBody(post) {
    const bodyEl = post.querySelector(SELECTORS.postBody);
    if (bodyEl) {
      const text = htmlToMarkdown(bodyEl.innerHTML);
      if (text) return text;
    }

    // Link post: the title anchor points at the destination.
    const titleLink = post.querySelector(SELECTORS.postTitle);
    const href = titleLink ? absoluteUrl(titleLink.getAttribute("href")) : "";
    if (href && !/\/r\/[^/]+\/comments\//.test(href)) {
      return "[" + href + "](" + href + ")";
    }

    // Image post: the expando preview links to (or renders) the image.
    const image = post.querySelector(".expando img.preview, .media-preview img, a.thumbnail img");
    if (image) {
      const src = absoluteUrl(image.getAttribute("src"));
      if (src) return "![](" + src + ")";
    }
    return "";
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
    for (const node of document.querySelectorAll(SELECTORS.comments)) {
      if (comments.length >= maxComments) break;

      const rawDepth = parseInt(attr(node, "data-depth"), 10);
      const depth = Number.isFinite(rawDepth) ? rawDepth : 0;
      if (depth < 0 || depth >= maxDepth) continue;

      const author = normalizeAuthor(attr(node, "data-author"));
      const isDeleted = /^u\/\[(deleted|removed)\]$/i.test(author) || !author;
      if (isDeleted && !options.includeDeleted) continue;

      const bodyEl = node.querySelector(SELECTORS.commentBody);
      const text = bodyEl ? htmlToMarkdown(bodyEl.innerHTML) : "";
      if (!text && !options.includeDeleted) continue;

      comments.push({
        depth: depth,
        author: author || "u/[unknown]",
        score: parseScore(attr(node, "data-score")),
        text: text || "_[removed]_",
      });
    }
    return comments;
  }

  /* ------------------------------------------------------------- public ---- */

  function matches() {
    return location.hostname === "old.reddit.com" && THREAD_PATH.test(location.pathname);
  }

  function extract(options) {
    const opts = options || {};
    const post = document.querySelector(SELECTORS.post);
    if (!post) {
      return { ok: false, error: "No post found on this page (old.reddit markup may have changed)." };
    }

    const titleLink = post.querySelector(SELECTORS.postTitle);
    const title = titleLink ? (titleLink.textContent || "").trim() : "";

    const meta = {
      title: title || (document.title || "").replace(/\s*[:\-]\s*r\/.*$/i, "").trim(),
      subreddit:
        normalizeSubreddit(attr(post, "data-subreddit-prefix")) ||
        normalizeSubreddit((location.pathname.match(/^\/r\/([^/]+)/) || [])[1] || ""),
      author: normalizeAuthor(attr(post, "data-author")),
      url: location.href,
      date: normalizeDate(attr(post, "data-timestamp")),
      score: parseScore(attr(post, "data-score")),
    };

    return {
      ok: true,
      meta: meta,
      body: extractBody(post),
      comments: opts.includeComments === false ? [] : extractComments(opts),
    };
  }

  window.RedditExtractOld = {
    matches: matches,
    extract: extract,
  };
})();
