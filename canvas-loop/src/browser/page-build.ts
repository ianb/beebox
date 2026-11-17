// `cli page <sketch.ts>… [--name n]`: type-check the sketches, bundle them into
// one live page (live-page.ts) and write it to the repo's ignored
// dev/canvas-loop-pages/<name>.html, which the dev router serves at
// /<worktree>/dev/canvas-loop-pages/<name>.html.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { CliError } from "../headless/errors.js";
import { checkSketchTypes, formatSketchTypeError } from "../headless/sketch-types.js";
import { bundleEntry, htmlPage } from "./bundle.js";

const HERE = import.meta.dirname;
/** The monorepo root: canvas-loop's parent. */
const REPO_ROOT = resolve(HERE, "../../..");
const SKETCH_SUFFIX = "-tea.ts";

/** The live page's own styles (live-page.ts); the figure's come from figure.css, inlined beside them. */
const LIVE_PAGE_CSS = `
body { margin: 0; background: #f4f1ea; color: #222; font: 14px system-ui, sans-serif; }
nav { padding: 10px 16px; display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; }
nav a { color: #245; }
nav a[aria-current] { font-weight: 600; color: #000; text-decoration: none; }
.fps { margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 600; }
.costs { padding: 0 16px; height: 16px; line-height: 16px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 12px; opacity: .7; font-variant-numeric: tabular-nums; }
.errors { margin: 0; padding: 0 16px 0 32px; color: #b91c1c; }
main { padding: 8px 16px 16px; }
@media (prefers-color-scheme: dark) {
  body { background: #1d1c1a; color: #ddd; }
  nav a { color: #9bd; }
  nav a[aria-current] { color: #fff; }
  .errors { color: #fca5a5; }
}
`;

/** One sketch file's place on the page. */
export interface PageEntry {
  key: string;
  label: string;
  path: string;
}

/**
 * Keys and labels for the sketch files, in order. A `sketch-tea.ts` is named
 * by its directory (a multi-file sketch; a `v<n>` directory with its parent);
 * any other file by its name without `-tea.ts`. Repeated names get `-2`, `-3`.
 */
export function pageEntries(paths: readonly string[]): PageEntry[] {
  const seen = new Map<string, number>();
  return paths.map((path) => {
    const file = basename(path);
    const dir = basename(dirname(path));
    // A version directory (`v3/`) says little alone: name it with its parent.
    const named = /^v\d+$/u.test(dir) ? `${basename(dirname(dirname(path)))} ${dir}` : dir;
    const label = file === `sketch${SKETCH_SUFFIX}` ? named : file.replace(/(?:-tea)?\.tsx?$/u, "");
    const base = label.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "sketch";
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { key: n === 1 ? base : `${base}-${String(n)}`, label, path };
  });
}

/** The page's entry module: import each sketch, then start the page. */
export function entrySource(entries: readonly PageEntry[], livePagePath: string): string {
  const imports = entries.map((e, i) => `import * as s${String(i)} from ${JSON.stringify(e.path)};`);
  const list = entries.map((e, i) => `  { key: ${JSON.stringify(e.key)}, label: ${JSON.stringify(e.label)}, module: s${String(i)} },`);
  return [`import { livePage } from ${JSON.stringify(livePagePath)};`, ...imports, "livePage([", ...list, "]);", ""].join("\n");
}

/**
 * The dev-router URL of a file under `repoRoot/dev/`, or undefined for a
 * checkout the router does not know: a managed worktree is served under its
 * directory name, the main checkout (directory `beebox`) as `main`.
 */
export function devUrl(repoRoot: string, relInDev: string): string | undefined {
  const checkout = basename(dirname(repoRoot)) === "beebox-worktrees" ? basename(repoRoot) : basename(repoRoot) === "beebox" ? "main" : undefined;
  return checkout === undefined ? undefined : `http://localhost:3210/${checkout}/dev/${relInDev}`;
}

export interface BuiltPage {
  file: string;
  url: string | undefined;
}

/** Type-check, bundle and write the page; refuses (CliError) on a type error. */
export async function buildLivePage(args: { sketches: readonly string[]; name: string | undefined }): Promise<BuiltPage> {
  if (args.sketches.length === 0) throw new CliError({ detail: "usage: cli page <sketch.ts>… [--name page-name]" });
  const entries = pageEntries(args.sketches.map((s) => resolve(s)));
  const errors = await checkSketchTypes(entries.map((e) => e.path));
  if (errors.length > 0) {
    throw new CliError({ detail: `the sketches do not type-check; no page written:\n${errors.map((e) => formatSketchTypeError(e, process.cwd())).join("\n")}` });
  }
  const name = args.name ?? (entries.length === 1 ? entries[0]?.key : undefined) ?? "page";
  if (!/^[\w-]+$/u.test(name)) throw new CliError({ detail: `--name must be letters, digits, - or _, got "${name}"` });
  const temp = mkdtempSync(join(tmpdir(), "canvas-loop-page-"));
  try {
    const entry = join(temp, "entry.ts");
    writeFileSync(entry, entrySource(entries, join(HERE, "live-page.ts")));
    const css = `${LIVE_PAGE_CSS}\n${readFileSync(join(HERE, "figure.css"), "utf8")}`;
    const html = htmlPage({ title: `${name} · canvas-loop`, css, js: await bundleEntry(entry) });
    const dir = join(REPO_ROOT, "dev/canvas-loop-pages");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${name}.html`);
    writeFileSync(file, html);
    return { file, url: devUrl(REPO_ROOT, `canvas-loop-pages/${name}.html`) };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
