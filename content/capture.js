/*
 * capture.js — runs immediately before the vendored bookmarklet.
 *
 * The original bookmarklet renders its report by calling window.open("") and
 * writing into that popup. That does not survive being run from a toolbar
 * button: the click gesture belongs to the extension, not the page, so the
 * popup blocker rejects it.
 *
 * Rather than fork the 3,500-line analyser, this shim swaps window.open for a
 * stand-in that hands back a detached document. The analyser writes its report
 * into that document exactly as before; report.js then serialises it and passes
 * it to the extension, which opens it as a normal tab.
 *
 * Only the content script's isolated world sees the override — the page's own
 * window.open is untouched.
 */
(() => {
  const NS = "__waiAriaUsage__";

  const report = document.implementation.createHTMLDocument("");
  const fakeWindow = { document: report, closed: false, focus() {}, close() {} };

  const openStub = () => fakeWindow;
  const nativeOpen = window.open;

  let overridden = false;
  try {
    Object.defineProperty(window, "open", {
      value: openStub,
      writable: true,
      configurable: true
    });
    overridden = window.open === openStub;
  } catch (error) {
    overridden = false;
  }

  if (!overridden) {
    try {
      window.open = openStub;
      overridden = window.open === openStub;
    } catch (error) {
      overridden = false;
    }
  }

  window[NS] = {
    report,
    overridden,
    openStub,
    nativeOpen,
    pageUrl: location.href,
    pageTitle: document.title,
    startedAt: Date.now()
  };
})();
