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
    const depth = Math.max(0, Math.min(64, comment.depth | 0));
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

  /* --------------------------------------------------------- expansion ---- */
  /* The load-more sweep lives in expand.js (window.RedditExpand) so it can be
     tested against a synthetic thread without the rest of the extension. */

  /* --------------------------------------------------------------- toast ---- */

  let toastTimer = null;

  function toast(message, kind) {
    try {
      const existing = document.getElementById(TOAST_ID);
      if (existing) existing.remove();
      if (toastTimer) clearTimeout(toastTimer);

      const error = kind === "error";
      const accent = error ? "#ff6b6b" : "#ff4500";

      const el = document.createElement("div");
      el.id = TOAST_ID;
      el.setAttribute("role", "status");
      el.style.cssText = [
        "position:fixed",
        "top:18px",
        "right:18px",
        "z-index:2147483647",
        "display:flex",
        "align-items:center",
        "gap:10px",
        "max-width:340px",
        "padding:10px 14px 10px 11px",
        "border-radius:12px",
        "background:rgba(22,23,25,.97)",
        "border:1px solid rgba(255,255,255,.09)",
        "box-shadow:0 16px 40px -16px rgba(0,0,0,.85),0 2px 8px rgba(0,0,0,.4)",
        "backdrop-filter:blur(10px)",
        "color:#f2f2f3",
        "font:500 12.5px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
        "pointer-events:none",
        "opacity:0",
        "transform:translateY(-8px) scale(.98)",
        "transition:opacity .18s ease,transform .18s ease",
      ].join(";");

      const badge = document.createElement("span");
      badge.textContent = error ? "!" : "\u2713";
      badge.style.cssText = [
        "flex:0 0 auto",
        "display:grid",
        "place-items:center",
        "width:20px",
        "height:20px",
        "border-radius:50%",
        "font:700 11px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        "color:#fff",
        "background:" + accent,
        "box-shadow:0 0 12px " +
          (error ? "rgba(255,107,107,.5)" : "rgba(255,69,0,.5)"),
      ].join(";");

      const text = document.createElement("span");
      text.textContent = message;
      text.style.cssText = "min-width:0;";

      el.appendChild(badge);
      el.appendChild(text);
      (document.body || document.documentElement).appendChild(el);

      requestAnimationFrame(() => {
        el.style.opacity = "1";
        el.style.transform = "translateY(0) scale(1)";
      });

      toastTimer = setTimeout(() => {
        el.style.opacity = "0";
        el.style.transform = "translateY(-6px) scale(.98)";
        setTimeout(() => el.remove(), 200);
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

  async function copyThread(copyEverything) {
    const extractor = pickExtractor();
    if (!extractor) {
      const reason = "This page is not a Reddit thread.";
      toast(reason, "error");
      return { ok: false, error: reason };
    }

    let options = await getOptions();
    let skippedBranches = 0;

    // "Copy everything" ignores every limit and always keeps comments + scores.
    if (copyEverything === true) {
      options = Object.assign({}, options, {
        unlimited: true,
        includeComments: true,
        includeScores: true,
        maxDepth: Infinity,
        maxComments: Infinity,
      });

      // Reddit only renders a batch of comments at a time: expand the whole
      // tree before extracting, otherwise "everything" means "what is on screen".
      toast("Expanding every comment…", "success");
      const expander = window.RedditExpand;
      const expansion = expander ? await expander.expandAll() : { clicked: 0, skipped: 0 };
      skippedBranches = expansion && expansion.skipped ? expansion.skipped : 0;
    }

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
      (copyEverything === true ? "Copied everything" : "Copied") +
      " · " + markdown.length.toLocaleString() + " chars" +
      (options.includeComments !== false
        ? " · " + count + " comment" + (count === 1 ? "" : "s")
        : "") +
      (skippedBranches
        ? " · " + skippedBranches + " deep branch" + (skippedBranches === 1 ? "" : "es") + " skipped"
        : "");
    toast(message, "success");
    return { ok: true, message: message, chars: markdown.length, comments: count };
  }

  /* ------------------------------------------------------------ listeners ---- */

  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || message.type !== "COPY_THREAD") return undefined;
      copyThread(message.all === true)
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
