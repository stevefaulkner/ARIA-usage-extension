/*
 * results.js — renders a report handed over by the background worker.
 *
 * The markup arrives as a string built from the audited page, so it is treated
 * as untrusted: nothing is inserted with innerHTML. Every node is rebuilt here
 * against a small allowlist of the elements and attributes the analyser
 * actually produces, which drops the analyser's stylesheet link along with
 * anything a hostile page might have smuggled into an outerHTML sample.
 */

const ALLOWED_TAGS = new Set([
  "a", "b", "br", "code", "details", "div", "em", "h1", "h2", "h3", "h4",
  "h5", "h6", "hr", "i", "li", "ol", "p", "pre", "span", "strong", "summary",
  "table", "tbody", "td", "th", "thead", "tr", "ul"
]);

const ALLOWED_ATTRS = new Set(["id", "lang", "dir"]);

function sanitizeNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return document.createTextNode(node.nodeValue);
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const tag = node.localName;
  if (!ALLOWED_TAGS.has(tag)) {
    return null;
  }

  const clean = document.createElement(tag);

  for (const { name, value } of node.attributes) {
    if (ALLOWED_ATTRS.has(name)) {
      clean.setAttribute(name, value);
    } else if (name === "href" && tag === "a" && value.startsWith("#")) {
      clean.setAttribute("href", value);
    }
  }

  for (const child of node.childNodes) {
    const cleanChild = sanitizeNode(child);
    if (cleanChild) clean.appendChild(cleanChild);
  }

  return clean;
}

/* ----------------------------------------------------------------- chrome */

function shortenUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return parsed.host + path + parsed.search;
  } catch (error) {
    return url || "an unknown page";
  }
}

function fileStamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    date.getFullYear() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    "-" +
    pad(date.getHours()) +
    pad(date.getMinutes())
  );
}

function showFailure(heading, detail) {
  const report = document.getElementById("report");
  report.textContent = "";

  const wrapper = document.createElement("div");
  wrapper.className = "failure";

  const title = document.createElement("h1");
  title.textContent = heading;

  const body = document.createElement("p");
  body.textContent = detail;

  wrapper.append(title, body);
  report.appendChild(wrapper);
}

async function saveReport(payload) {
  const css = await fetch("results.css").then((response) => response.text());

  const clone = document.documentElement.cloneNode(true);

  clone.querySelectorAll("script, #save").forEach((node) => node.remove());

  const link = clone.querySelector('link[rel="stylesheet"]');
  if (link) {
    const style = document.createElement("style");
    style.textContent = css;
    link.replaceWith(style);
  }

  const html = "<!DOCTYPE html>\n" + clone.outerHTML;
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  let host = "page";
  try {
    host = new URL(payload.pageUrl).hostname || host;
  } catch (error) {
    /* Keep the fallback. */
  }

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `wai-aria-usage-${host}-${fileStamp(
    new Date(payload.ranAt || Date.now())
  )}.html`;
  anchor.click();

  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* ------------------------------------------------------------------- boot */

async function init() {
  const id = new URLSearchParams(location.search).get("id");

  if (!id) {
    showFailure(
      "No report to show",
      "Open this page by running WAI-ARIA Usage from the toolbar button on the page you want to check."
    );
    return;
  }

  const stored = await chrome.storage.session.get(id);
  const payload = stored[id];

  if (!payload) {
    showFailure(
      "This report has expired",
      "Reports are kept only for the current browsing session, and only the eight most recent are held. Run the checks again on the page you want to see."
    );
    return;
  }

  const ranAt = new Date(payload.ranAt || Date.now());

  document.getElementById("source-url").textContent = shortenUrl(payload.pageUrl);
  document.getElementById("source-url").title = payload.pageUrl || "";
  document.getElementById("source-time").textContent = ranAt.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });

  if (payload.error) {
    showFailure("The checks did not finish", payload.error);
    return;
  }

  const parsed = new DOMParser().parseFromString(payload.html, "text/html");
  const fragment = document.createDocumentFragment();

  for (const child of parsed.body.childNodes) {
    const clean = sanitizeNode(child);
    if (clean) fragment.appendChild(clean);
  }

  const report = document.getElementById("report");
  report.textContent = "";
  report.appendChild(fragment);

  const host = shortenUrl(payload.pageUrl).split("/")[0];
  document.title = `WAI-ARIA usage results: ${host}`;

  const save = document.getElementById("save");
  save.hidden = false;
  save.addEventListener("click", () => {
    saveReport(payload).catch(() => {
      save.textContent = "Save failed";
    });
  });

  report.focus();
}

init().catch((error) => {
  showFailure(
    "The report could not be shown",
    error && error.message ? error.message : String(error)
  );
});
