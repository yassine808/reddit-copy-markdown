/* Service worker: routes the context-menu item and the keyboard command to the
   active tab's content script. The content script owns extraction + clipboard. */

"use strict";

const MENU_ID = "rcm-copy-thread";
const MENU_ALL_ID = "rcm-copy-thread-all";

/** Send COPY_THREAD to a tab, swallowing the "no receiver" error. */
function sendCopy(tab, all) {
  if (!tab || typeof tab.id !== "number" || tab.id < 0) return;
  chrome.tabs.sendMessage(tab.id, { type: "COPY_THREAD", all: all === true }, () => {
    // Reading lastError prevents "Unchecked runtime.lastError" noise when the
    // tab is not a Reddit page (no content script) or is still loading.
    void chrome.runtime.lastError;
  });
}

function sendCopyToActiveTab(all) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (chrome.runtime.lastError) return;
    sendCopy(tabs && tabs[0], all);
  });
}

function createMenu() {
  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;
    chrome.contextMenus.create(
      {
        id: MENU_ID,
        title: "Copy thread as Markdown",
        contexts: ["page"],
      },
      () => {
        void chrome.runtime.lastError;
      }
    );
    chrome.contextMenus.create(
      {
        id: MENU_ALL_ID,
        title: "Copy everything as Markdown (no limits)",
        contexts: ["page"],
      },
      () => {
        void chrome.runtime.lastError;
      }
    );
  });
}

chrome.runtime.onInstalled.addListener(createMenu);
chrome.runtime.onStartup.addListener(createMenu);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!info) return;
  if (info.menuItemId === MENU_ID) sendCopy(tab, false);
  else if (info.menuItemId === MENU_ALL_ID) sendCopy(tab, true);
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "copy-thread") sendCopyToActiveTab();
});
