/**
 * Publication leak scan (Track E of `docs/plans/publish-pages.md`).
 *
 * A **pure** function over a rendered bundle's file map. It reports *findings*,
 * never a boolean — each finding carries a stable id so a caller can wave a
 * specific false positive through with `cb pub draft --accept-leak <id>`. The
 * scan is a backstop, not a gate on its own: a publication bundle is treated as
 * fully public regardless of tier (a `secret`/`accounts` tier gates *who* can
 * reach a page, not *what* a viewer does after saving it), so the human
 * file-by-file preview at flip time is the real control. This scan just makes
 * the obvious mistakes loud.
 *
 * ## What it scans
 * Only the **text** entries of the bundle (string values in the `files` map).
 * Binary entries (`Uint8Array` values — emitted images, etc.) are NOT scanned
 * and are returned in `skippedBinaries` so the preview can say "N binary assets
 * not scanned". Patterns:
 *  - **home-dir paths** — the `/(?:Users|home)/<name>/` shape, document-copied
 *    from `bin/path-leak-check.ts:47` (we cannot import across the package
 *    boundary; the sanctioned-copy clause of engineering-principle #8 covers
 *    this — keep the two in sync by hand), minus a small placeholder allowlist.
 *  - **email addresses** other than the publication's own allowlist and the box
 *    owner (both passed in).
 *  - **credential shapes** — a named table (Google/OpenAI/GitHub/Slack keys,
 *    JWTs, and a catch-all long base64/hex run).
 *  - **absolute `http(s)://` references** — the self-containment check, which
 *    doubles as a "the publication CSP (`connect-src 'none'`) will block this"
 *    warning. This is the same scan `render-docs`'s doctest performs inline;
 *    the notion is centralized here.
 *
 * ## Blind spots (plan finding #8 — stated explicitly, on purpose)
 * The scan does NOT meaningfully cover two things, and no regex will:
 *  1. The (future) **view renderer's inlined card JSON** — a large blob of
 *     arbitrary box content that a human skims past; PII or a secret in prose
 *     form won't match a credential-prefix regex.
 *  2. **Binary / image assets** — a screenshot of an API key ships clean; we
 *     skip binaries entirely (regexing binary is meaningless).
 * For both, the **human file-by-file preview is the only real gate**. This scan
 * is a backstop consistent with the Custom-GPTs "assume extractable" lesson,
 * not a guarantee. False positives are expected (a doc legitimately quoting an
 * email); that is exactly what `--accept-leak` is for.
 */

import { createHash } from "node:crypto";

/** The category of a leak finding. A closed set (exhaustively switched on elsewhere). */
export type LeakKind = "home-path" | "email" | "credential" | "external-url";

/** One reported potential leak. `id` is stable across runs for `--accept-leak`. */
export interface LeakFinding {
  /** Stable id = first 12 hex of sha256(kind + file + match). Same input ⇒ same id. */
  id: string;
  kind: LeakKind;
  /** Bundle-relative path of the text file the match was found in. */
  file: string;
  /** The offending substring (the snippet a reviewer eyeballs). */
  match: string;
  /** Human label — the credential pattern name, or a short description. */
  detail: string;
  /** 1-based line number within `file`. */
  line: number;
}

export interface LeakScanResult {
  findings: LeakFinding[];
  /** Text (string) bundle entries that were scanned. */
  scannedFiles: string[];
  /** Binary (`Uint8Array`) bundle entries that were skipped, not scanned. */
  skippedBinaries: string[];
}

export interface LeakScanOptions {
  /** The box owner's email — never a leak when it appears. `null` if unknown. */
  ownerEmail: string | null;
  /** The publication's own viewer allowlist — those emails are expected, not leaks. */
  allowedEmails: string[];
}

// A real home path: `/Users/<name>/` or `/home/<name>/`, capturing the name.
// DOCUMENT-COPIED from `bin/path-leak-check.ts:47` (different package — can't
// import). If that regex changes, change this too. Requires the trailing slash
// so a bare web route like `/home` never matches.
const HOME_PATH = /\/(?:Users|home)\/([\dA-Za-z][\w.-]*)\//g;

// Placeholder / service-account names that are NOT a personal-home leak. Mirrors
// the spirit of `ALLOWED_NAMES` in `bin/path-leak-check.ts:27` (kept short here;
// a bundle should not carry deploy service-account paths at all).
const ALLOWED_HOME_NAMES = new Set(["me", "you", "user", "x"]);

// A pragmatic email matcher — deliberately loose (leans toward false positives,
// which `--accept-leak` clears) rather than risk missing a real address.
const EMAIL_RE = /[\w%+.-]+@[\d.A-Za-z-]+\.[A-Za-z]{2,}/g;

// Absolute http(s) references — the self-containment / CSP-will-block check.
const EXTERNAL_URL_RE = /https?:\/\/[^\s"')<>]+/g;

/**
 * Credential-shape table — a named, commented set so the roster is legible and
 * extensible. Each entry's `re` is applied globally to every text file. These
 * intentionally over-match a little; a genuine false positive is cleared per
 * finding with `--accept-leak`.
 */
const CREDENTIAL_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  // Google API key: literal `AIza` + 35 url-safe base64 chars.
  { name: "Google API key", re: /AIza[\w-]{35}/g },
  // OpenAI-style secret key: `sk-` + a long run (covers `sk-proj-…` too).
  { name: "OpenAI API key", re: /\bsk-[\w-]{20,}/g },
  // GitHub personal-access / app tokens: `ghp_`/`gho_`/`ghs_`/`ghr_` + a run.
  { name: "GitHub token", re: /\bgh[oprsu]_[\dA-Za-z]{20,}/g },
  // Slack bot/user token: `xoxb-`/`xoxp-` + segments.
  { name: "Slack token", re: /\bxox[bp]-[\dA-Za-z-]{10,}/g },
  // JWT: three base64url segments; the header segment starts `eyJ` ({"...).
  { name: "JWT", re: /\b(?:eyJ[\w-]{10,}\.){2}[\w-]{10,}/g },
  // Catch-all high-entropy run: 40+ base64/hex chars. NOISIEST pattern — and
  // `data:` URI payloads are masked out before it runs (see `maskDataUris`), so
  // an inlined image doesn't trip it on every doc bundle.
  { name: "long base64/hex run", re: /\b[\d+/A-Za-z]{40,}={0,2}\b/g },
];

/**
 * Replace `data:` URI payloads with same-length dot runs (newlines preserved),
 * so string offsets and line numbers stay valid while the base64/hex catch-all
 * can't match a legitimately-inlined image. Only the catch-all uses the masked
 * text; the prefix'd credential patterns and every other scan use the original.
 */
function maskDataUris(text: string): string {
  return text.replace(/data:[^\s"'()<>]*/g, (m) => m.replace(/[^\n]/g, "."));
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

function makeId({ kind, file, match }: Pick<LeakFinding, "kind" | "file" | "match">): string {
  return createHash("sha256").update(`${kind}\0${file}\0${match}`).digest("hex").slice(0, 12);
}

/** Push one finding, deduped by id (a repeated match collapses to a single finding). */
function record(
  findings: Map<string, LeakFinding>,
  { kind, file, match, detail, line }: Omit<LeakFinding, "id">,
): void {
  const id = makeId({ kind, file, match });
  if (!findings.has(id)) findings.set(id, { id, kind, file, match, detail, line });
}

function scanText(
  { file, text, opts }: { file: string; text: string; opts: LeakScanOptions },
  findings: Map<string, LeakFinding>,
): void {
  const { ownerEmail, allowedEmails } = opts;
  const allowedLower = new Set([ownerEmail, ...allowedEmails].filter((e): e is string => !!e).map((e) => e.toLowerCase()));

  // Home-dir paths.
  for (const m of text.matchAll(HOME_PATH)) {
    const name = m[1];
    if (name === undefined || ALLOWED_HOME_NAMES.has(name)) continue;
    record(findings, { kind: "home-path", file, match: m[0], detail: "home directory path", line: lineOf(text, m.index) });
  }

  // Foreign email addresses.
  for (const m of text.matchAll(EMAIL_RE)) {
    if (allowedLower.has(m[0].toLowerCase())) continue;
    record(findings, { kind: "email", file, match: m[0], detail: "email address", line: lineOf(text, m.index) });
  }

  // Absolute external URLs (self-containment / CSP).
  for (const m of text.matchAll(EXTERNAL_URL_RE)) {
    record(findings, { kind: "external-url", file, match: m[0], detail: "absolute http(s) reference", line: lineOf(text, m.index) });
  }

  // Credential shapes. The catch-all entropy pattern runs against data-URI-masked
  // text; the prefix'd patterns run against the original.
  const masked = maskDataUris(text);
  for (const { name, re } of CREDENTIAL_PATTERNS) {
    const haystack = name === "long base64/hex run" ? masked : text;
    for (const m of haystack.matchAll(re)) {
      record(findings, { kind: "credential", file, match: m[0], detail: name, line: lineOf(haystack, m.index) });
    }
  }
}

/**
 * Scan a rendered bundle's files for potential leaks. Pure: same inputs ⇒ same
 * findings (stable ids, deterministic order). Text entries are scanned; binary
 * entries are skipped and listed. Findings are sorted by (file, line, kind) for
 * a stable, readable preview.
 */
export function scanBundle(files: Map<string, string | Uint8Array>, opts: LeakScanOptions): LeakScanResult {
  const findings = new Map<string, LeakFinding>();
  const scannedFiles: string[] = [];
  const skippedBinaries: string[] = [];

  for (const [file, content] of files) {
    if (typeof content === "string") {
      scannedFiles.push(file);
      scanText({ file, text: content, opts }, findings);
    } else {
      skippedBinaries.push(file);
    }
  }

  const sorted = [...findings.values()].toSorted(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.kind.localeCompare(b.kind) || a.match.localeCompare(b.match),
  );
  return { findings: sorted, scannedFiles: scannedFiles.toSorted(), skippedBinaries: skippedBinaries.toSorted() };
}
