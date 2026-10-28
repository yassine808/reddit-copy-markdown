/* Popup: edit options (persisted in chrome.storage.sync) and trigger a copy of
   the active tab through the content script. Two modes:
     - normal: honours includeComments / maxDepth / maxComments
     - everything: ignores every limit, copies the whole comment tree in the DOM */

"use strict";

const STORAGE_KEY = "rcm:options";
const DEFAULTS = {
  includeComments: true,
  maxDepth: 5,
  maxComments: 200,
  includeScores: true,
};

const $ = (id) => document.getElementById(id);

function clampInt(value, min, max, fallback) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function loadOptions() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(STORAGE_KEY, (result) => {
      void chrome.runtime.lastError;
      resolve(Object.assign({}, DEFAULTS, (result && result[STORAGE_KEY]) || {}));
    });
  });
}

function setStatus(text, kind) {
  const el = $("status");
  el.textContent = text;
  el.className = "status" + (kind ? " " + kind : "");
}

function readForm() {
  return {
    includeComments: $("includeComments").checked,
    includeScores: $("includeScores").checked,
    maxDepth: clampInt($("maxDepth").value, 1, 20, DEFAULTS.maxDepth),
    maxComments: clampInt($("maxComments").value, 1, 2000, DEFAULTS.maxComments),
  };
}

function persist() {
  const options = readForm();
  // Normalise the inputs so the stored value and the UI never disagree.
  $("maxDepth").value = options.maxDepth;
  $("maxComments").value = options.maxComments;
  chrome.storage.sync.set({ [STORAGE_KEY]: options }, () => {
    void chrome.runtime.lastError;
    setStatus("Options saved.", "ok");
  });
}

function isRedditUrl(url) {
  return /^https:\/\/([a-z0-9-]+\.)?reddit\.com\//i.test(url || "");
}

function setBusy(busy) {
  $("copy").disabled = busy;
  $("copyAll").disabled = busy;
  document.body.classList.toggle("busy", busy);
}

function copyNow(copyEverything) {
  setStatus(copyEverything ? "Copying everything…" : "Copying…", "");
  setBusy(true);

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || !isRedditUrl(tab.url)) {
      setBusy(false);
      setStatus("Open a Reddit thread first.", "err");
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: "COPY_THREAD", all: copyEverything === true }, (response) => {
      setBusy(false);

      if (chrome.runtime.lastError || !response) {
        setStatus("Page not ready — reload the Reddit tab, then retry.", "err");
        return;
      }
      if (response.ok) {
        setStatus(response.message || "Copied.", "ok");
      } else {
        setStatus(response.error || "Copy failed.", "err");
      }
    });
  });
}

/* +/- steppers around the number inputs ---------------------------------- */

function wireSteppers() {
  for (const button of document.querySelectorAll(".step")) {
    button.addEventListener("click", () => {
      const input = $(button.dataset.for);
      if (!input) return;

      const step = parseInt(button.dataset.step, 10) || 1;
      const min = parseInt(input.min, 10);
      const max = parseInt(input.max, 10);
      const current = clampInt(input.value, min, max, DEFAULTS[input.id] || min);
      const next = Math.min(max, Math.max(min, current + step));

      if (next !== current) {
        input.value = next;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
  }
}

function wireShortcutHint() {
  const mac = /mac/i.test(navigator.platform || "");
  const keys = document.querySelectorAll(".shortcut kbd");
  if (mac && keys.length === 3) {
    keys[0].textContent = "⌘";
    keys[1].textContent = "⇧";
  }
}

async function init() {
  wireShortcutHint();
  wireSteppers();

  const options = await loadOptions();
  $("includeComments").checked = options.includeComments !== false;
  $("includeScores").checked = options.includeScores !== false;
  $("maxDepth").value = clampInt(options.maxDepth, 1, 20, DEFAULTS.maxDepth);
  $("maxComments").value = clampInt(options.maxComments, 1, 2000, DEFAULTS.maxComments);

  for (const el of document.querySelectorAll("[data-opt]")) {
    el.addEventListener("change", persist);
  }

  $("copy").addEventListener("click", () => copyNow(false));
  $("copyAll").addEventListener("click", () => copyNow(true));

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || !isRedditUrl(tab.url)) {
      setStatus("Open a Reddit thread to copy.", "err");
    } else {
      setStatus("Ready.");
    }
  });
}

init();
