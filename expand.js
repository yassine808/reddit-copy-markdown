/*
 * Thread expansion for "Copy everything".
 *
 * Reddit only renders a batch of comments at a time: the rest sits behind
 * "N more replies" / "view more comments" buttons and behind infinite scroll.
 * Clicking is the only reliable way to materialise the tree without the API
 * (which rejects unauthenticated bulk reads).
 *
 * Everything here is label-driven on purpose: class names and component names
 * change with every Reddit release, the labels have been stable for years.
 *
 * Exposes: window.RedditExpand = { expandAll, candidates, countDeepBranches }
 */
(function () {
  "use strict";

  const MORE_RE =
    /(view|load|show)?\s*(\d+\s+)?more\s+(repl|comment)|view\s+more\s+comments|load\s+more\s+comments|show\s+more\s+replies|more\s+replies/i;
  const NAVIGATE_RE = /continue\s+this\s+thread|single\s+comment\s+thread|view\s+all\s+comments/i;
  const EXPAND_DEADLINE_MS = 90000;
  const EXPAND_MAX_CLICKS = 600;
  const QUIET_MS = 800;
  const QUIET_HARD_MS = 3000;

  function commentRoot() {
    return (
      document.querySelector("shreddit-comment-tree") ||
      document.querySelector("#comment-tree") ||
      document.querySelector(".commentarea") ||
      document.body
    );
  }

  /** querySelectorAll that also walks open shadow roots. */
  function deepCollect(root, selector, out) {
    if (!root) return out;
    if (root.querySelectorAll) {
      for (const el of root.querySelectorAll(selector)) out.push(el);
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) deepCollect(el.shadowRoot, selector, out);
      }
    }
    return out;
  }

  function labelOf(el) {
    return (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function candidates() {
    const out = [];
    const root = commentRoot();
    if (!root) return out;

    for (const el of deepCollect(root, 'button, a, [role="button"]', [])) {
      const label = labelOf(el);
      if (!label || label.length > 64) continue;
      if (NAVIGATE_RE.test(label)) continue; // navigates away / loses context
      if (!MORE_RE.test(label)) continue;
      if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;

      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) continue; // hidden or not rendered

      out.push(el);
    }
    return out;
  }

  function countDeepBranches() {
    const root = commentRoot();
    if (!root) return 0;
    let count = 0;
    for (const el of deepCollect(root, "a, button", [])) {
      if (NAVIGATE_RE.test(labelOf(el))) count += 1;
    }
    return count;
  }

  /** Resolve after the DOM has been quiet for `quietMs` (or `hardMs` at most). */
  function waitForQuiet(quietMs, hardMs) {
    return new Promise((resolve) => {
      let timer = null;
      let hard = null;
      let done = false;
      const observer = new MutationObserver(() => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(finish, quietMs);
      });

      function finish() {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        if (hard) clearTimeout(hard);
        observer.disconnect();
        resolve();
      }

      try {
        observer.observe(document.body, { childList: true, subtree: true });
      } catch (err) {
        finish();
        return;
      }

      timer = setTimeout(finish, quietMs);
      hard = setTimeout(finish, hardMs);
    });
  }

  async function expandAll() {
    const deadline = Date.now() + EXPAND_DEADLINE_MS;
    let clicked = 0;
    let idleRounds = 0;

    // Synthetic clicks on old.reddit's "load more" anchors would navigate the
    // tab if the site's handler is missing. Block the default action while still
    // letting Reddit's own AJAX handler run.
    const guard = (event) => {
      const link = event.target && event.target.closest ? event.target.closest("a") : null;
      if (!link) return;
      const label = labelOf(link);
      if (MORE_RE.test(label) && !NAVIGATE_RE.test(label)) event.preventDefault();
    };
    document.addEventListener("click", guard, true);

    try {
      for (let round = 0; round < 120 && Date.now() < deadline; round++) {
        const batch = candidates();

        if (!batch.length) {
          // Lazy batches usually appear only after reaching the end of the page.
          window.scrollTo(0, document.body.scrollHeight);
          await waitForQuiet(700, 2500);

          if (!candidates().length) {
            idleRounds += 1;
            if (idleRounds >= 2) break;
          } else {
            idleRounds = 0;
          }
          continue;
        }

        idleRounds = 0;
        for (const el of batch.slice(0, 50)) {
          try {
            el.click();
            clicked += 1;
            if (clicked >= EXPAND_MAX_CLICKS) break;
          } catch (err) {
            /* one bad button must not stop the sweep */
          }
        }

        await waitForQuiet(QUIET_MS, QUIET_HARD_MS);
        if (clicked >= EXPAND_MAX_CLICKS) break;
      }
    } finally {
      document.removeEventListener("click", guard, true);
    }

    return { clicked, skipped: countDeepBranches() };
  }

  window.RedditExpand = {
    expandAll,
    candidates,
    countDeepBranches,
  };
})();
