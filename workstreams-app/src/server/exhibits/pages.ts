// Server-rendered HTML for the exhibits origin.
//
// Listings and error pages are buildless on purpose: they must render when a
// page fails to compile, when a manifest is malformed, and when the store is
// not initialized — exactly the moments the container cannot be trusted to
// boot. The exhibit shell is the one page that hands off to Vite.

import type { ExhibitBoot } from "../../shared/exhibits.js";
import type { ExhibitListing } from "./store.js";

const STYLE = `
:root { color-scheme: light; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
body { margin: 0; padding: 2rem max(1rem, calc((100vw - 60rem) / 2)); color: #292724; background: #fbfaf8; }
h1 { margin: 0 0 .25rem; font-size: 1.6rem; letter-spacing: -.02em; }
p { color: #56524c; }
ul { margin: 1.2rem 0 0; padding: 0; list-style: none; border-top: 1px solid #e1ddd7; }
li { display: flex; align-items: baseline; gap: .75rem; padding: .7rem .2rem; border-bottom: 1px solid #e1ddd7; }
a { color: #315ba8; font-weight: 650; text-decoration: none; }
a:hover { text-decoration: underline; }
.badge { padding: .14rem .5rem; border-radius: 999px; background: #edf0f4; color: #586678; font-size: .76rem; font-weight: 650; }
.badge-decide { background: #dbe7fa; color: #294f99; }
.badge-confirm { background: #fbeab8; color: #765300; }
.badge-react { background: #eee4fb; color: #6543ac; }
.badge-fyi { background: #edf0f4; color: #586678; }
.problem { color: #84351f; }
pre { padding: 1rem; overflow: auto; border: 1px solid #e4c5bd; border-radius: .4rem; background: #fff5f2; color: #84351f; }
code { font-size: .95em; }
`;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>${STYLE}</style>
  </head>
  <body>${body}</body>
</html>
`;
}

export function renderWorkstreamList(options: { workstreams: string[]; hasApps: boolean }): string {
  const rows = options.workstreams
    .map((name) => `<li><a href="/${encodeURIComponent(name)}/">${escapeHtml(name)}</a></li>`)
    .join("\n      ");
  const apps = options.hasApps ? '<li><a href="/apps/">apps</a> <span class="badge">committed</span></li>' : "";
  return layout(
    "Exhibits",
    `
    <h1>Exhibits</h1>
    <p>Workstream exhibits persist with their workstream; committed apps live in the main checkout.</p>
    <ul>
      ${rows}
      ${apps}
    </ul>`,
  );
}

export function renderExhibitList(options: { heading: string; basePath: string; exhibits: ExhibitListing[] }): string {
  const rows = options.exhibits
    .map((exhibit) => {
      const href = `${options.basePath}${encodeURIComponent(exhibit.name)}/`;
      const badge =
        exhibit.askType === null
          ? ""
          : ` <span class="badge badge-${escapeHtml(exhibit.askType)}">${escapeHtml(exhibit.askType)}</span>`;
      const detail =
        exhibit.error === null
          ? escapeHtml(exhibit.title ?? exhibit.name)
          : `<span class="problem">${escapeHtml(exhibit.error)}</span>`;
      return `<li><a href="${escapeHtml(href)}">${escapeHtml(exhibit.name)}</a>${badge} <span>${detail}</span></li>`;
    })
    .join("\n      ");
  const body =
    options.exhibits.length === 0
      ? "<p>No exhibits here yet.</p>"
      : `<ul>
      ${rows}
    </ul>`;
  return layout(
    options.heading,
    `
    <h1>${escapeHtml(options.heading)}</h1>
    <p><a href="/">All workstreams</a></p>
    ${body}`,
  );
}

export function renderManifestError(options: { scope: string; manifestPath: string; issues: string[] }): string {
  const issues = options.issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("\n      ");
  return layout(
    `Invalid manifest: ${options.scope}`,
    `
    <h1 class="problem">This exhibit has no usable manifest</h1>
    <p>Every exhibit states its ask. Fix <code>${escapeHtml(options.manifestPath)}</code>:</p>
    <ul>
      ${issues}
    </ul>
    <p>Manifest shape: <code>{ "title", "ask": { "type", "prose", "options"? }, "created", "figures"? }</code>
    — ask types are <code>decide</code>, <code>confirm</code>, <code>react</code>, <code>fyi</code>.</p>`,
  );
}

export function renderStoreError(options: { storeRoot: string; marker: string }): string {
  return layout(
    "Exhibit store unavailable",
    `
    <h1 class="problem">Exhibit store unavailable</h1>
    <p><code>${escapeHtml(options.storeRoot)}</code> is not an initialized exhibit store: it carries no
    <code>${escapeHtml(options.marker)}</code> marker. Creating a worktree mounts and marks the store; an
    unmarked directory is refused rather than adopted.</p>`,
  );
}

export function renderCompileError(options: { scope: string; message: string }): string {
  return layout(
    `Failed to compile: ${options.scope}`,
    `
    <h1 class="problem">This exhibit failed to compile</h1>
    <p><code>${escapeHtml(options.scope)}/index.tsx</code> did not build:</p>
    <pre>${escapeHtml(options.message)}</pre>`,
  );
}

export function renderNotFound(what: string): string {
  return layout("Not found", `<h1>Not found</h1><p>${escapeHtml(what)}</p>`);
}

/**
 * The container shell. Vite dev serves a direct .css request as a JS module, so
 * there is no <link rel="stylesheet"> here — boot.tsx imports the stylesheet.
 */
export function renderShell(boot: ExhibitBoot): string {
  const payload = JSON.stringify(boot).replace(/</gu, "\\u003c");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(boot.manifest.title)}</title>
  </head>
  <body>
    <div id="root"></div>
    <script>window.__EXHIBIT__ = ${payload};</script>
    <script type="module" src="/boot.tsx"></script>
  </body>
</html>
`;
}
