# WAI-ARIA Usage — browser extension

The [WAI-ARIA Usage bookmarklet](https://github.com/TetraLogical/WAI-ARIA-Usage)
by TPGi and TetraLogical, packaged as a browser extension. It checks a page's
ARIA against [ARIA in HTML](https://www.w3.org/TR/html-aria/), covering document
conformance requirements for ARIA attributes and allowed roles, states and
properties, then opens the findings in a new tab.

The analyser itself is untouched. `content/vendor/aria-usage.js` is the upstream
file, byte for byte. Everything else in this package exists to run it from a
toolbar button instead of a bookmark, and to render what it produces.

---

## Part 1: Using it

### Install on Chrome, Edge, Brave, Arc and other Chromium browsers

1. Unzip this folder somewhere it can stay. The browser loads it from disk every
   time it starts, so moving or deleting the folder breaks the extension.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Turn on **Developer mode**, top right.
4. Choose **Load unpacked** and select the unzipped folder, the one containing
   `manifest.json`.
5. Pin *WAI-ARIA Usage* to the toolbar so the button is always visible.

To check local files, open the extension's **Details** page and turn on **Allow
access to file URLs**.

### Install on Firefox

1. Delete `manifest.json` and rename `manifest.firefox.json` to `manifest.json`.
   Firefox needs a background script rather than a service worker, and an
   add-on id.
2. Open `about:debugging#/runtime/this-firefox`.
3. Choose **Load Temporary Add-on** and select `manifest.json`.

Firefox drops temporary add-ons when it closes. For an install that persists you
need a signed build through
[addons.mozilla.org](https://addons.mozilla.org/developers/).

### Running a check

Open the page you want to check, then either click the toolbar button or press
**Alt+Shift+A**. Change the shortcut at `chrome://extensions/shortcuts`.

The report opens in a tab immediately to the right of the page. The original
page is left alone: nothing is injected into its layout, and no elements are
added to its DOM.

### Reading the report

**Summary** counts findings by category, with each count linking down to its
section. Valid roles are collapsed behind a disclosure so they stay out of the
way until you want them, listed with an instance count per role.

**Details** lists each finding as a sentence naming the element and the problem,
followed by the offending markup. Groups are ordered as the analyser emits them
and colour-coded by severity:

| Colour  | Meaning              | Categories |
| ------- | -------------------- | ---------- |
| Oxblood | Conformance failures | Invalid roles, non-existent roles, invalid properties, invalid references, invalid descendants, missing parent / child / required state |
| Amber   | Warnings             | Unnecessary roles, deprecated roles, deprecated attributes, unknown elements |
| Blue    | Informational        | DPUB roles |

Severity is carried by the heading wording first. Colour only reinforces it, so
the report is still readable without it.

**Save report** writes a single self-contained HTML file with the styles inlined,
suitable for attaching to a ticket or keeping as a record. The report also prints
cleanly: the toolbar is dropped and finding groups avoid breaking across pages.

### What it can't check

- **Browser pages.** `chrome://`, `about:`, `view-source:` and the extension
  gallery are closed to all extensions. The button shows a dash and explains why
  in its tooltip.
- **Iframes.** Only the top-level document is checked, matching the bookmarklet's
  behaviour. To check a frame, open it in its own tab first.
- **Pages that change while checking.** The analyser walks the DOM synchronously,
  so a page rewriting itself mid-run can produce a partial report. Re-run it.
- **Anything outside this specification.** This is a conformance check against
  one document, not an accessibility audit. ARIA can be perfectly conformant and
  still describe a page badly.

---

## Part 2: How it's constructed

### File map

```
manifest.json              Chromium MV3 manifest: action, command, permissions
manifest.firefox.json      Firefox variant (background script, add-on id)
background.js              Service worker: injection, report storage, tab opening
content/
  capture.js               Pre-shim: redirects window.open to a detached document
  vendor/aria-usage.js     Upstream analyser, unmodified
  report.js                Post-shim: serialises the report, restores window.open
results.html               Report page shell
results.js                 Sanitises and renders the report; save-as-HTML
results.css                Report styling
icons/                     Toolbar icons at 16, 32, 48 and 128px
tools/make-icons.py        Rebuilds those icons from the source artwork
LICENSE-upstream.md        MIT licence for the analyser
```

### Flow of a single run

```
toolbar click / Alt+Shift+A
  │
  ├─ background.js  run(tab)
  │    rejects non-http(s)/file URLs with a badge and tooltip
  │    chrome.scripting.executeScript into the top frame, three files in order:
  │
  │      1. content/capture.js
  │           creates a detached document via createHTMLDocument
  │           replaces window.open with a stub returning { document }
  │           parks state on window.__waiAriaUsage__
  │
  │      2. content/vendor/aria-usage.js
  │           walks the DOM, writes its report into the detached document
  │           (runs synchronously, so it has finished by the next file)
  │
  │      3. content/report.js
  │           restores window.open, clears the namespace
  │           serialises documentElement.outerHTML
  │           chrome.runtime.sendMessage → background
  │
  ├─ background.js  openReportTab
  │    chrome.storage.session.set under a `report:<uuid>` key
  │    prunes to the eight most recent reports
  │    chrome.tabs.create → results.html?id=report:<uuid>
  │
  └─ results.js
       reads the payload from session storage
       parses the markup and rebuilds it against an allowlist
       renders into results.html, wires up Save report
```

### Problem one: the popup

The bookmarklet renders its report by calling `window.open("")` and writing into
the resulting popup. That does not survive being run from a toolbar button. The
click gesture belongs to the extension rather than the page, so the popup blocker
rejects the call, `window.open` returns null, and the analyser dies on the next
line.

Forking a 3,500-line file to change how it renders would mean re-doing that work
on every upstream release. `capture.js` avoids it. It swaps `window.open` for a
stub that hands back a detached `HTMLDocument`, and the analyser writes into that
object exactly as it would a real popup. Cross-document `appendChild` adopts
nodes automatically per the DOM spec, so the analyser's habit of building nodes
with the page's `document` and appending them to the report document works
without changes.

Two details make the swap safe. The override lives only in the content script's
isolated world, so the page's own `window.open` is never affected. And
`report.js` puts it back afterwards, deleting the shadowing property first and
falling back to direct assignment if that does not reveal the native function.

### Problem two: trust

Every finding embeds the offending element's `outerHTML`, so the report string is
markup sourced from the page under test. It is then rendered on an extension
page, which carries extension privileges. Treating it as trusted would let a
hostile page reach into that context.

`results.js` never touches `innerHTML`. It parses the string with `DOMParser`,
then walks the result and rebuilds each node in the results document against an
allowlist of the elements the analyser actually emits. Attributes are limited to
`id`, `lang`, `dir`, and `href` values beginning with `#` so the summary's jump
links keep working. Scripts, event handlers, frames, images, external URLs and
stylesheet links do not survive the rebuild.

That last exclusion fixes a bug rather than causing one. The analyser links its
results window to `juicystudio.com/tpg/ARC/aria-usage.css`, which no longer
serves that file, so the bookmarklet's own output currently renders unstyled.
`results.css` replaces it.

### The styling contract

`results.css` hangs off the ids the analyser generates, since the markup is not
ours to change:

- `#__ARIA_validator_resultsWindow__` wraps the whole report
- `#__ARIA_validator_dlgtitle__` is the report's `h1`
- `#__ARIA_validator_summary__` holds the counts and the valid-roles disclosure
- `div[id$="Container"]`, one per category, named after the analyser's counter
  keys: `invalidContainer`, `unnecessaryContainer`, `missingparentContainer`
  and so on

Empty category containers are created whether or not they have findings, and are
hidden with `:empty`. Each container's "Back to the top" link is emitted directly
after its heading, so it is styled as a small line under the heading rather than
being moved.

### Report lifecycle

Reports live in `chrome.storage.session`, which means they are cleared when the
browser closes and are not written to disk. Only the eight most recent are kept;
older keys are pruned on each new run. Reloading the results tab re-reads the
same key, so refreshing works, but a report from a previous session shows an
expiry message instead.

Passing the markup through storage rather than messaging the tab directly avoids
a race with tab load, and avoids blob and data URLs, which Chromium blocks for
top-level navigation from an extension.

### Permissions

| Permission  | Why |
| ----------- | --- |
| `activeTab` | Read the page you are on, granted only by your click. There is no standing access to any site, and no host permissions are declared. |
| `scripting` | Inject the analyser into the active tab. |
| `storage`   | Hold the report in session storage long enough for the results tab to collect it. |

No network requests, no telemetry, no remotely hosted code. Session storage
defaults to trusted contexts only, so the results page can read reports and
content scripts cannot.

### Icons

The icons are cut from the Juicy Studio campervan illustration, on its own deep
maroon background. `tools/make-icons.py` rebuilds them:

```
python3 tools/make-icons.py path/to/artwork.png
```

Two compositions rather than one. At 128 and 48 the whole van fits, so the logo
and strapline survive intact. At 32 and 16 a straight downscale of the full van
collapses into a smear, so those sizes crop to the front two thirds, where the
nose, windscreen and front wheel still read as a vehicle, with a small contrast
lift to hold the pale body against the maroon. All four get the same rounded
corner, masked at eight times scale and downsampled so the curve stays clean at
16px.

The illustration belongs to Juicy Studio, home of the analyser's author. That is
fine for a locally loaded build. If you publish this to a web store, either get
permission or swap in artwork of your own, since an icon is the one part of an
extension that reads as a claim about who made it.

### Testing

The injection pipeline and the sanitiser were exercised under jsdom against a
fixture page carrying deliberate faults: invalid roles for their element,
non-existent roles, prohibited names, dangling `aria-labelledby` references,
deprecated attributes and unnecessary native roles. A second pass feeds
deliberately hostile markup (inline handlers, `script`, `iframe`, `img onerror`,
external links) through `results.js` to confirm none of it reaches the DOM.

One assumption rests on documented behaviour rather than observation: that
shadowing `window.open` inside Chromium's isolated world does not leak to the
page and does not fail silently. If a report tab ever opens empty, check that
first.

### Updating the analyser

Replace `content/vendor/aria-usage.js` with the current copy from
[the upstream repository](https://github.com/TetraLogical/WAI-ARIA-Usage) and
bump `version` in both manifests. Nothing else needs to change unless upstream
renames the ids listed under *The styling contract*, or stops rendering through
`window.open`.

### Licence

The analyser is MIT licensed, copyright TPGi / Gez Lemon. See
`LICENSE-upstream.md`. The extension wrapper is offered under the same terms.
