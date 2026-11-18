/*
 * background.js — wires the toolbar button and keyboard shortcut to the
 * analyser, and turns the report it sends back into a tab.
 */

const INJECTED_FILES = [
  "content/capture.js",
  "content/vendor/aria-usage.js",
  "content/report.js"
];

const RESULTS_PAGE = "results.html";
const STORE_PREFIX = "report:";
const MAX_STORED_REPORTS = 8;

/* ------------------------------------------------------------------ running */

function isInjectable(url) {
  return typeof url === "string" && /^(https?|file):/.test(url);
}

async function flagUnsupported(tabId, message) {
  try {
    await chrome.action.setBadgeText({ tabId, text: "—" });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#6c0000" });
    await chrome.action.setTitle({ tabId, title: message });
  } catch (error) {
    /* The tab may already be gone. */
  }
}

async function clearFlag(tabId) {
  try {
    await chrome.action.setBadgeText({ tabId, text: "" });
    await chrome.action.setTitle({ tabId, title: "Evaluate WAI-ARIA usage" });
  } catch (error) {
    /* Ignore. */
  }
}

async function run(tab) {
  if (!tab || typeof tab.id !== "number") return;

  if (!isInjectable(tab.url)) {
    await flagUnsupported(
      tab.id,
      "WAI-ARIA Usage only runs on http, https and local file pages. " +
        "Browser pages and the extension gallery are off limits."
    );
    return;
  }

  await clearFlag(tab.id);

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false },
      files: INJECTED_FILES
    });
  } catch (error) {
    await openReportTab(
      {
        error:
          "The checks could not run on this page. " +
          (error && error.message ? error.message : String(error)),
        pageUrl: tab.url,
        pageTitle: tab.title,
        ranAt: Date.now()
      },
      tab
    );
  }
}

chrome.action.onClicked.addListener(run);

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "run-aria-usage") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await run(tab);
});

/* ----------------------------------------------------------- handing it off */

function newReportId() {
  return STORE_PREFIX + crypto.randomUUID();
}

async function pruneStore() {
  const all = await chrome.storage.session.get(null);
  const keys = Object.keys(all)
    .filter((key) => key.startsWith(STORE_PREFIX))
    .sort((a, b) => (all[a].ranAt || 0) - (all[b].ranAt || 0));

  const excess = keys.length - MAX_STORED_REPORTS;
  if (excess > 0) {
    await chrome.storage.session.remove(keys.slice(0, excess));
  }
}

async function openReportTab(payload, tab) {
  const id = newReportId();

  try {
    await chrome.storage.session.set({ [id]: payload });
    await pruneStore();
  } catch (error) {
    await chrome.storage.session.set({
      [id]: {
        error:
          "The report was too large to pass to the results tab. " +
          "Try a smaller page, or a single frame of this one.",
        pageUrl: payload.pageUrl,
        pageTitle: payload.pageTitle,
        ranAt: payload.ranAt
      }
    });
  }

  const url = `${chrome.runtime.getURL(RESULTS_PAGE)}?id=${encodeURIComponent(id)}`;

  await chrome.tabs.create({
    url,
    index: tab && typeof tab.index === "number" ? tab.index + 1 : undefined,
    openerTabId: tab && typeof tab.id === "number" ? tab.id : undefined,
    active: true
  });
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || typeof message.type !== "string") return;

  if (message.type === "aria-usage-report") {
    openReportTab(
      {
        html: message.html,
        pageUrl: message.pageUrl,
        pageTitle: message.pageTitle,
        ranAt: message.ranAt,
        durationMs: message.durationMs
      },
      sender.tab
    );
    return;
  }

  if (message.type === "aria-usage-error") {
    openReportTab(
      {
        error: message.reason,
        pageUrl: sender.tab && sender.tab.url,
        pageTitle: sender.tab && sender.tab.title,
        ranAt: Date.now()
      },
      sender.tab
    );
  }
});
