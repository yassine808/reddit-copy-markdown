/* Orchestrator: pick the right extractor, assemble Markdown, copy, toast, and
   answer COPY_THREAD messages from the service worker and the popup. */

(function () {
  "use strict";

  const STORAGE_KEY = "rcm:options";
  const DEFAULT_OPTIONS = {
    includeComments: true,
    maxDepth: 5,
    maxComments: 200,
    includeScores: true,
  };
  const TOAST_ID = "rcm-toast";
  const TOAST_MS = 2500;

  /* ------------------------------------------------------------ options ---- */

  function getOptions() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(STORAGE_KEY, (result) => {
          void chrome.runtime.lastError;
          const saved = (result && result[STORAGE_KEY]) || {};
          resolve(Object.assign({}, DEFAULT_OPTIONS, saved));
        });
      } catch (err) {
        resolve(Object.assign({}, DEFAULT_OPTIONS));
      }
    });
  }

  /* ---------------------------------------------------------- rendering ---- */

  function yamlString(value) {
    const text = String(value === null || value === undefined ? "" : value)
      .replace(/\r?\n/g, " ")
      .trim();
    return '"' + text.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }

  function frontmatter(meta) {
    const lines = ["---"];
    lines.push("title: " + yamlString(meta.title || "(untitled)"));
    if (meta.subreddit) lines.push("subreddit: " + yamlString(meta.subreddit));
    if (meta.author) lines.push("author: " + yamlString(meta.author));
    if (meta.url) lines.push("url: " + yamlString(meta.url));
    if (meta.date) lines.push("date: " + yamlString(meta.date));
    if (Number.isFinite(meta.score)) lines.push("score: " + meta.score);
    lines.push("---");
    return lines.join("\n");
  }

  /** depth 0 -> ">", depth 1 -> "> >", ... i.e. depth + 1 markers, always. */
  function commentBlock(comment, includeScores) {
    const depth = Math.max(0, Math.min(20, comment.depth | 0));
    const marker = "> ".repeat(depth + 1).trimEnd();
    const header =
      "**" + comment.author + "**" +
      (includeScores && Number.isFinite(comment.score) ? " · " + comment.score + " points" : "");

    const lines = [header].concat(String(comment.text || "").split(/\r?\n/));
    return lines
      .map((line) => (line.trim() ? marker + " " + line : marker))
      .join("\n");
  }

  function buildMarkdown(data, options) {
    const meta = data.meta || {};
    const parts = [frontmatter(meta), (data.body || "").trim()];
    const comments = data.comments || [];

    if (options.includeComments !== false && comments.length) {
      parts.push("## Comments");
      parts.push(
        comments
          .map((comment) => commentBlock(comment, options.includeScores !== false))
          .join("\n\n")
      );
    }

    return parts.filter((part) => part && part.trim()).join("\n\n") + "\n";
  }

  /* ----------------------------------------------------------- clipboard ---- */

  function legacyCopy(text) {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0;";
    (document.body || document.documentElement).appendChild(area);
    const previousFocus = document.activeElement;
    area.select();
    area.setSelectionRange(0, area.value.length);
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (err) {
      ok = false;
    }
    area.remove();
    if (previousFocus && typeof previousFocus.focus === "function") {
      try {
        previousFocus.focus();
      } catch (err) {
        /* ignore */
      }
    }
    return ok;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      return legacyCopy(text);
    }
  }

  /* --------------------------------------------------------------- toast ---- */

  let toastTimer = null;

  function toast(message, kind) {
    try {
      const existing = document.getElementById(TOAST_ID);
      if (existing) existing.remove();
      if (toastTimer) clearTimeout(toastTimer);

      const el = document.createElement("div");
      el.id = TOAST_ID;
      el.textContent = message;
      el.setAttribute("role", "status");
      el.style.cssText = [
        "position:fixed",
        "top:16px",
        "right:16px",
        "z-index:2147483647",
        "max-width:320px",
        "padding:10px 14px",
        "border-radius:8px",
        "background:#1a1a1b",
        "color:#f2f2f2",
        "font:500 13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
        "box-shadow:0 6px 24px rgba(0,0,0,.45)",
        "border-left:3px solid " + (kind === "error" ? "#ff585b" : "#ff4500"),
        "pointer-events:none",
        "transition:opacity .15s ease",
      ].join(";");

      (document.body || document.documentElement).appendChild(el);
      toastTimer = setTimeout(() => {
        el.remove();
        toastTimer = null;
      }, TOAST_MS);
    } catch (err) {
      // A toast failing must never break the copy itself.
      console.warn("[reddit-to-markdown] toast failed:", err);
    }
  }

  /* ---------------------------------------------------------------- main ---- */

  function pickExtractor() {
    const candidates = [window.RedditExtractNew, window.RedditExtractOld];
    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        if (candidate.matches()) return candidate;
      } catch (err) {
        /* ignore a broken extractor and try the next */
      }
    }
    return null;
  }

  async function copyThread() {
    const extractor = pickExtractor();
    if (!extractor) {
      const reason = "This page is not a Reddit thread.";
      toast(reason, "error");
      return { ok: false, error: reason };
    }

    const options = await getOptions();

    let data;
    try {
      data = extractor.extract(options);
    } catch (err) {
      const reason = "Extraction failed: " + (err && err.message ? err.message : String(err));
      toast(reason, "error");
      return { ok: false, error: reason };
    }

    if (!data || data.ok === false) {
      const reason = (data && data.error) || "Could not read this thread.";
      toast(reason, "error");
      return { ok: false, error: reason };
    }

    let markdown;
    try {
      markdown = buildMarkdown(data, options);
    } catch (err) {
      const reason = "Markdown conversion failed: " + (err && err.message ? err.message : String(err));
      toast(reason, "error");
      return { ok: false, error: reason };
    }

    const copied = await copyText(markdown);
    if (!copied) {
      const reason = "Copy failed — the clipboard is blocked on this page.";
      toast(reason, "error");
      return { ok: false, error: reason };
    }

    const count = (data.comments || []).length;
    const message =
      "Copied " + markdown.length.toLocaleString() + " chars" +
      (options.includeComments !== false ? " · " + count + " comment" + (count === 1 ? "" : "s") : "");
    toast(message, "success");
    return { ok: true, message: message, chars: markdown.length, comments: count };
  }

  /* ------------------------------------------------------------ listeners ---- */

  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || message.type !== "COPY_THREAD") return undefined;
      copyThread()
        .then(sendResponse)
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true; // keep the channel open for the async response
    });
  } catch (err) {
    console.warn("[reddit-to-markdown] could not register message listener:", err);
  }

  // Exposed so the extractor can be debugged from the page console.
  window.RedditCopyMarkdown = { copyThread: copyThread, buildMarkdown: buildMarkdown };
})();
