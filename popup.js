/* Popup: edit options (persisted in chrome.storage.sync) and trigger a copy of
   the active tab through the content script. */

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

function copyNow() {
  setStatus("Copying…", "");
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || !isRedditUrl(tab.url)) {
      setStatus("Open a Reddit thread tab first.", "err");
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: "COPY_THREAD" }, (response) => {
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

async function init() {
  const options = await loadOptions();
  $("includeComments").checked = options.includeComments !== false;
  $("includeScores").checked = options.includeScores !== false;
  $("maxDepth").value = clampInt(options.maxDepth, 1, 20, DEFAULTS.maxDepth);
  $("maxComments").value = clampInt(options.maxComments, 1, 2000, DEFAULTS.maxComments);

  for (const el of document.querySelectorAll("[data-opt]")) {
    el.addEventListener("change", persist);
  }
  $("copy").addEventListener("click", copyNow);
  setStatus("Ready.");
}

init();
