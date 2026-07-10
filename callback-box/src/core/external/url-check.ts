/**
 * `cb validate --urls` orchestration: decide which external URLs are *new*
 * (present now but not in the base git version), check them, and persist a
 * gitignored verdict cache so previously-broken URLs keep surfacing and
 * previously-good ones are never re-checked.
 *
 * Detection is git-based (no "seen" ledger): a URL that existed anywhere in the
 * base version is never re-checked. The only persistent state is the broken /
 * pending cache at `.callback-box/url-checks.json` — gitignored so the
 * non-blocking post-commit pass that writes it never dirties the tree.
 *
 * Network lives in `external-url-fetch.ts`; this file owns git + state + report.
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { listBoxCardFiles, listBoxMarkdownFiles } from "../list-cards.js";
import { checkUrls, extractExternalUrls, isCheckableUrl, type UrlVerdict } from "./url-fetch.js";

const execFileP = promisify(execFile);

const CACHE_REL = ".callback-box/url-checks.json";
// POSIX ERE for `git grep` — the same shape as the JS URL regex, minus the
// chars that wrap URLs in markdown. Normalization happens in JS afterward.
const GIT_GREP_PATTERN = "https?://[^[:space:]\"'()<>]+";
const GREP_PATHSPEC = ["*.md", "*.card"];

/** Where the current/base URL sets come from. */
export type UrlCheckMode =
  | { kind: "working" } // base = HEAD, current = working tree
  | { kind: "all" } // base = none, current = every box file
  | { kind: "staged" } // base = HEAD, current = the index
  | { kind: "since"; ref: string }; // base = ref, current = HEAD

interface BrokenEntry {
  status: number | null;
  since: string;
  lastChecked: string;
  detail: string;
}
interface PendingEntry {
  attempts: number;
  lastTried: string;
  detail: string;
}
interface UrlCheckCache {
  version: 1;
  broken: Record<string, BrokenEntry>;
  pending: Record<string, PendingEntry>;
}

function emptyCache(): UrlCheckCache {
  return { version: 1, broken: {}, pending: {} };
}

class MalformedCacheError extends Error {
  constructor(filePath: string) {
    super(`URL-check cache at ${filePath} is malformed (expected { version, broken, pending })`);
    this.name = "MalformedCacheError";
  }
}

async function loadCache(boxRoot: string): Promise<UrlCheckCache> {
  const filePath = path.join(boxRoot, CACHE_REL);
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return emptyCache();
    throw e;
  }
  const parsed = JSON.parse(content) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { broken?: unknown }).broken !== "object" ||
    typeof (parsed as { pending?: unknown }).pending !== "object"
  ) {
    throw new MalformedCacheError(filePath);
  }
  return parsed as UrlCheckCache;
}

async function saveCache(boxRoot: string, cache: UrlCheckCache): Promise<void> {
  const filePath = path.join(boxRoot, CACHE_REL);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const sortKeys = (rec: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(rec).toSorted()) out[key] = rec[key];
    return out;
  };
  const ordered = { version: cache.version, broken: sortKeys(cache.broken), pending: sortKeys(cache.pending) };
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(ordered, null, 2) + "\n");
  await fs.rename(tmp, filePath);
}

/** Run `git grep` for URLs at a ref / the index / the working tree. */
async function gitGrepUrls(boxRoot: string, source: "WORKTREE" | "INDEX" | string): Promise<Set<string>> {
  const args = ["grep", "-hoIE", GIT_GREP_PATTERN];
  if (source === "INDEX") args.push("--cached");
  else if (source !== "WORKTREE") args.push(source);
  args.push("--", ...GREP_PATHSPEC);
  let stdout: string;
  try {
    ({ stdout } = await execFileP("git", args, { cwd: boxRoot, maxBuffer: 32 * 1024 * 1024 }));
  } catch (e) {
    // git grep exits 1 with no output when nothing matches — that's an empty set,
    // not an error. Any other failure (not a repo, bad ref) re-throws.
    const err = e as { code?: number; stdout?: string };
    if (err.code === 1 && (err.stdout ?? "") === "") return new Set();
    throw e;
  }
  const out = new Set<string>();
  for (const line of stdout.split("\n")) {
    for (const url of extractExternalUrls(line)) out.add(url);
  }
  return out;
}

/** Scan every box markdown/card file on disk for URLs (used by `--all`). */
async function filesystemUrls(boxRoot: string): Promise<Set<string>> {
  const files = [...(await listBoxMarkdownFiles(boxRoot)), ...(await listBoxCardFiles(boxRoot))];
  const out = new Set<string>();
  await Promise.all(
    files.map(async (file) => {
      const text = await fs.readFile(file, "utf-8");
      for (const url of extractExternalUrls(text)) out.add(url);
    })
  );
  return out;
}

/** Compute the current + base URL sets for a mode. */
async function urlSetsForMode(boxRoot: string, mode: UrlCheckMode): Promise<{ current: Set<string>; base: Set<string> }> {
  switch (mode.kind) {
    case "all":
      return { current: await filesystemUrls(boxRoot), base: new Set() };
    case "working":
      return { current: await gitGrepUrls(boxRoot, "WORKTREE"), base: await gitGrepUrls(boxRoot, "HEAD") };
    case "staged":
      return { current: await gitGrepUrls(boxRoot, "INDEX"), base: await gitGrepUrls(boxRoot, "HEAD") };
    case "since":
      return { current: await gitGrepUrls(boxRoot, "HEAD"), base: await gitGrepUrls(boxRoot, mode.ref) };
  }
}

export interface BrokenUrl {
  url: string;
  status: number | null;
  detail: string;
  /** Box-relative files that reference the URL, for the report. */
  referrers: string[];
}
export interface UrlCheckReport {
  /** URLs actually hit over the network this run. */
  checked: number;
  /** Currently-referenced URLs whose latest verdict is hard-broken. */
  broken: BrokenUrl[];
  /** Inconclusive this run (timeout/5xx/DNS-temp) — will retry next run. */
  transient: string[];
}

/** Box-relative files that contain a literal URL (for the broken-URL report). */
async function referrersOf(boxRoot: string, url: string): Promise<string[]> {
  try {
    const { stdout } = await execFileP("git", ["grep", "-lFI", url, "--", ...GREP_PATHSPEC], {
      cwd: boxRoot,
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout.split("\n").filter((l) => l !== "");
  } catch (_e) {
    // No match (exit 1) or non-repo — referrers are a nice-to-have, not load-bearing.
    return [];
  }
}

/**
 * Fold this run's verdicts into the cache: ok clears any prior state, broken is
 * recorded (or refreshed), transient parks the URL in pending unless it's already
 * known-broken (we don't downgrade a confirmed break on a flaky run).
 */
function applyVerdicts(cache: UrlCheckCache, { verdicts, now }: { verdicts: UrlVerdict[]; now: string }): void {
  for (const v of verdicts) {
    if (v.reason === "ok") {
      delete cache.broken[v.url];
      delete cache.pending[v.url];
    } else if (v.reason === "broken") {
      const since = cache.broken[v.url]?.since ?? now;
      cache.broken[v.url] = { status: v.status, since, lastChecked: now, detail: v.detail };
      delete cache.pending[v.url];
    } else if (!(v.url in cache.broken)) {
      const attempts = (cache.pending[v.url]?.attempts ?? 0) + 1;
      cache.pending[v.url] = { attempts, lastTried: now, detail: v.detail };
    }
  }
}

/** Drop cache entries for URLs no longer referenced anywhere in the box. */
function pruneUnreferenced(cache: UrlCheckCache, current: Set<string>): void {
  for (const url of Object.keys(cache.broken)) if (!current.has(url)) delete cache.broken[url];
  for (const url of Object.keys(cache.pending)) if (!current.has(url)) delete cache.pending[url];
}

/**
 * Run the external-URL check for `mode`, update the gitignored cache, and return
 * a report of currently-referenced broken URLs. `now` is injected so callers
 * (and tests) control the timestamp.
 */
export async function checkExternalUrls(
  boxRoot: string,
  { mode, now, check }: { mode: UrlCheckMode; now: string; check?: (urls: string[]) => Promise<UrlVerdict[]> }
): Promise<UrlCheckReport> {
  // The real network checker; tests inject a deterministic stub so the git-based
  // detection + cache behavior is exercised offline (the SSRF guard would block a
  // localhost test server anyway).
  const checkFn = check ?? ((urls: string[]) => checkUrls(urls, {}));
  const { current, base } = await urlSetsForMode(boxRoot, mode);
  const cache = await loadCache(boxRoot);

  // New = present now, absent from base. Plus re-check anything we still consider
  // broken or pending that's still referenced (to catch a fix / settle a flake).
  const toCheck = new Set<string>();
  for (const url of current) if (!base.has(url) && isCheckableUrl(url)) toCheck.add(url);
  for (const url of [...Object.keys(cache.broken), ...Object.keys(cache.pending)]) {
    if (current.has(url) && isCheckableUrl(url)) toCheck.add(url);
  }

  const verdicts = await checkFn([...toCheck]);
  applyVerdicts(cache, { verdicts, now });
  pruneUnreferenced(cache, current);
  await saveCache(boxRoot, cache);

  const broken: BrokenUrl[] = [];
  const sortedBrokenEntries = Object.entries(cache.broken).toSorted(([a], [b]) => a.localeCompare(b));
  for (const [url, entry] of sortedBrokenEntries) {
    broken.push({ url, status: entry.status, detail: entry.detail, referrers: await referrersOf(boxRoot, url) });
  }
  const transient = verdicts.filter((v) => v.reason === "transient").map((v) => v.url).toSorted();
  return { checked: verdicts.length, broken, transient };
}

/** Render a report as the human-readable warning block (or null when clean). */
export function formatUrlReport(report: UrlCheckReport, { colors }: { colors: boolean }): string | null {
  if (report.broken.length === 0 && report.transient.length === 0) return null;
  const ESC = "";
  const red = colors ? (s: string) => `${ESC}[31m${s}${ESC}[0m` : (s: string) => s;
  const dim = colors ? (s: string) => `${ESC}[2m${s}${ESC}[0m` : (s: string) => s;
  const lines: string[] = [];
  for (const b of report.broken) {
    const where = b.referrers.length > 0 ? `  ${dim(`(${b.referrers.join(", ")})`)}` : "";
    lines.push(`${red("broken")}  ${b.url}  [${b.detail}]${where}`);
  }
  for (const url of report.transient) {
    lines.push(`${dim("transient")}  ${url}  ${dim("(unreachable this run — will retry)")}`);
  }
  if (report.broken.length > 0) {
    const word = report.broken.length === 1 ? "URL" : "URLs";
    lines.push(
      `\n${String(report.broken.length)} broken external ${word} ` +
        "(warning — not blocking; fix or remove the link)"
    );
  }
  return lines.join("\n");
}
