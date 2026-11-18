/*
 * report.js — runs immediately after the vendored bookmarklet.
 *
 * The analyser is synchronous, so by the time this file executes the detached
 * document set up by capture.js holds the finished report. Serialise it, put
 * window.open back the way we found it, and pass the markup to the background
 * worker to be opened in a tab.
 */
(() => {
  const NS = "__waiAriaUsage__";
  const state = window[NS];

  if (!state) {
    chrome.runtime.sendMessage({
      type: "aria-usage-error",
      reason: "The analyser did not start. Reload the page and try again."
    });
    return;
  }

  // Put the page's own window.open back.
  try {
    if (window.open === state.openStub) {
      delete window.open;
      if (window.open !== state.nativeOpen) {
        window.open = state.nativeOpen;
      }
    }
  } catch (error) {
    /* Leaving the stub in place is harmless: it only exists in this world. */
  }

  delete window[NS];

  const rendered = state.report.getElementById("__ARIA_validator_resultsWindow__");

  if (!rendered) {
    chrome.runtime.sendMessage({
      type: "aria-usage-error",
      reason:
        "The analyser ran but produced no report. This page may block the " +
        "checks, or the page may have changed while they were running."
    });
    return;
  }

  chrome.runtime.sendMessage({
    type: "aria-usage-report",
    html: state.report.documentElement.outerHTML,
    pageUrl: state.pageUrl,
    pageTitle: state.pageTitle,
    ranAt: Date.now(),
    durationMs: Date.now() - state.startedAt
  });
})();
