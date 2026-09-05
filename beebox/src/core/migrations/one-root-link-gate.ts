/**
 * The hard link gate — Track E step 6 (`docs/plans/one-root-box-layout.md`).
 * Normal `bbx validate` treats a broken ref as a WARNING (`card-lint.ts`'s
 * `lintFrontmatterCard`; box-wide markdown link scan in
 * `validate-markdown.ts`'s `boxWideLinkWarnings`) — legitimate moves/archives
 * make broken refs common enough that erroring on every one would block
 * routine commits. The migration is different: every ref in the box was just
 * rewritten in one shot, so a dangling ref left afterward USUALLY means the
 * rewriter (`one-root-ref-rewrite.ts`) missed a form. Refusing to commit is
 * the backstop for that miss.
 *
 * Reuses the same box-wide scanners `bbx validate` uses — the "error mode" is
 * just this module's own decision to treat their (normally warning-level)
 * findings as fatal, not a separate checker. A symlinked card/doc the
 * migration deliberately left byte-untouched (Finding 1, round 4 hardening)
 * is excluded from both the card and markdown scans at their SOURCE
 * (`markdown-lint-rules.ts`'s `noBrokenInternalLinks` skips a symlinked leaf
 * outright; a `.card` file's ref problems are warning-only regardless), so
 * this module needs no special-casing of its own for that case.
 *
 * Round-9 hardening (aged-box rehearsal, 2026-09): a real aged box carries
 * refs that were ALREADY dangling before the migration ran — stale job-card
 * refs to long-consumed content, most commonly. The "any dangling ref means
 * the rewriter missed a form" assumption above only holds for refs that
 * genuinely resolved pre-migration; blocking on one that was already broken
 * makes a real box unmigratable without first deleting its history. The
 * caller (`one-root-run.ts`) hands in `preBroken` — the set of (path, ref)
 * pairs the ref rewriter itself already determined were pre-existing
 * dangling refs (`one-root-ref-rescue.ts`) — and this module filters
 * matching findings out of the blocking count, reporting them separately as
 * carried through instead.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { lintCardsDispatch } from "../card-lint.js";
import { listBoxCardFiles, listBoxViewFiles } from "../list-cards.js";
import { buildLoadContext } from "../load-context.js";
import { boxWideLinkFindings, formatMarkdownResults } from "../../cli/commands/validate-markdown.js";
import { extractViewRefs } from "../views/refs.js";
import { resolveRefExists } from "../ref-exists.js";
import { isExternalRef } from "../../shared/ref-path.js";
import { isInBoxNamespace } from "../../lib/box-namespace.js";
import { extractDependencyGlobs, staticGlobPrefix } from "./one-root-view-dependencies.js";

export interface OneRootLinkGateResult {
  ok: boolean;
  /** Human-readable report of every broken ref found, empty when `ok`. */
  report: string;
  /** Broken refs matched against `preBroken` — already dangling before this
   * migration, carried through rather than counted as blocking. */
  carriedThroughCount: number;
}

/** Composite key identifying one (path, ref) pair, shared between
 * `one-root-run.ts` (which builds the `preBroken` set from the ref
 * rewriter's own pre-broken tracking) and this module (which checks
 * membership against it). One function so the two can never format the key
 * differently. */
export function preBrokenRefKey(relPath: string, ref: string): string {
  return JSON.stringify([relPath, ref]);
}

const REF_MSG_PREFIX = "Broken reference at ";
const REF_MSG_SUFFIX = " does not exist";

/** Pull the ref value back out of a `"Broken reference at <locator>: <ref>
 * does not exist"` message (`card-lint.ts`, `views/refs.ts`'s shared
 * phrasing). `null` for any other message shape (e.g. a resolution
 * exception) — those are never pre-broken candidates, they always block. */
function parseBrokenReferenceMessage(message: string): { ref: string } | null {
  if (!message.startsWith(REF_MSG_PREFIX) || !message.endsWith(REF_MSG_SUFFIX)) return null;
  const middle = message.slice(REF_MSG_PREFIX.length, message.length - REF_MSG_SUFFIX.length);
  const sepIdx = middle.indexOf(": ");
  if (sepIdx === -1) return null;
  return { ref: middle.slice(sepIdx + 2) };
}

const BROKEN_LINK_DETAIL_PREFIX = "Broken link: ";

/** Same extraction for a markdownlint `errorDetail` (`markdown-lint-rules.ts`'s
 * BBX002); `null` for anything else (e.g. "Link points outside the box: …",
 * an escape rather than a dangling target — never a pre-broken candidate). */
function extractBrokenLinkUrl(detail: string | null | undefined): string | null {
  if (detail === null || detail === undefined || !detail.startsWith(BROKEN_LINK_DETAIL_PREFIX)) return null;
  return detail.slice(BROKEN_LINK_DETAIL_PREFIX.length);
}

function relOf(boxRoot: string, absPath: string): string {
  return path.relative(boxRoot, absPath).split(path.sep).join("/");
}

interface CountedLines {
  lines: string[];
  carriedThroughCount: number;
}

/** Broken card ref warnings (`lintCardsDispatch`'s `type: "reference"`),
 * filtered against `preBroken`. */
async function collectBrokenCardRefLines(boxRoot: string, preBroken: ReadonlySet<string>): Promise<CountedLines> {
  const ctx = await buildLoadContext(boxRoot);
  const cardPaths = await listBoxCardFiles(boxRoot);
  const cardSummary = await lintCardsDispatch(cardPaths, { boxRoot, ctx });

  let carriedThroughCount = 0;
  const lines: string[] = [];
  for (const result of cardSummary.results) {
    const relPath = relOf(boxRoot, result.path);
    for (const warning of result.warnings) {
      if (warning.type !== "reference") continue;
      const parsed = parseBrokenReferenceMessage(warning.message);
      // An external URL in a ref field is not a box path — the migration
      // neither moved nor could break it. Normal validate only WARNS on
      // these, so aged boxes carry them (a record card's source URL); the
      // gate must not turn that history into a migration blocker.
      if (parsed !== null && isExternalRef(parsed.ref)) {
        carriedThroughCount++;
        continue;
      }
      if (parsed !== null && preBroken.has(preBrokenRefKey(relPath, parsed.ref))) {
        carriedThroughCount++;
        continue;
      }
      lines.push(`  ${result.path}: ${warning.message}`);
    }
  }
  return { lines, carriedThroughCount };
}

interface MarkdownReport extends CountedLines {
  report: string | null;
}

/** Box-wide broken markdown link findings (`boxWideLinkFindings`), filtered
 * against `preBroken` and reformatted. */
async function collectBrokenMarkdownReport(boxRoot: string, preBroken: ReadonlySet<string>): Promise<MarkdownReport> {
  const findings = await boxWideLinkFindings(boxRoot);
  let carriedThroughCount = 0;
  const filteredErrors: typeof findings.errors = {};
  let total = 0;
  let filesWithErrors = 0;
  for (const [file, errors] of Object.entries(findings.errors)) {
    const relPath = relOf(boxRoot, file);
    const kept = errors.filter((e) => {
      const url = extractBrokenLinkUrl(e.errorDetail);
      if (url !== null && preBroken.has(preBrokenRefKey(relPath, url))) {
        carriedThroughCount++;
        return false;
      }
      return true;
    });
    if (kept.length > 0) {
      filteredErrors[file] = kept;
      total += kept.length;
      filesWithErrors++;
    }
  }
  const report =
    total === 0
      ? null
      : `${formatMarkdownResults({ ...findings, errors: filteredErrors, totalErrors: total, filesWithErrors }, { colors: false })}\n\n` +
        `${String(total)} broken internal link(s) in ${String(filesWithErrors)} file(s) ` +
        "(warning — not blocking the commit; fix with `bbx mv` or by correcting the link)";
  return { report, lines: [], carriedThroughCount };
}

/** Broken view `cardRef` warnings (mirrors `views/refs.ts`'s `lintViewRefs`),
 * filtered against `preBroken`. */
async function collectBrokenViewLines(params: {
  viewPaths: string[];
  boxRoot: string;
  preBroken: ReadonlySet<string>;
}): Promise<CountedLines> {
  const { viewPaths, boxRoot, preBroken } = params;
  let carriedThroughCount = 0;
  const lines: string[] = [];
  for (const viewPath of viewPaths) {
    const lst = await fs.lstat(viewPath).catch(() => null);
    if (lst?.isSymbolicLink() === true) continue; // same skip as `views/refs.ts`'s `lintViewRefs`
    const source = await fs.readFile(viewPath, "utf-8").catch(() => null);
    if (source === null) continue;
    const relPath = relOf(boxRoot, viewPath);
    for (const { path: refPath, ref } of extractViewRefs(source)) {
      const qIdx = ref.indexOf("?");
      const refPathOnly = qIdx === -1 ? ref : ref.slice(0, qIdx);
      const exists = await resolveRefExists({ ref: refPathOnly, fromPath: "", boxRoot });
      if (exists) continue;
      if (preBroken.has(preBrokenRefKey(relPath, ref))) {
        carriedThroughCount++;
        continue;
      }
      lines.push(`  ${relPath}: Broken reference at ${refPath}: ${ref} does not exist`);
    }
  }
  return { lines, carriedThroughCount };
}

const NO_PRE_BROKEN: ReadonlySet<string> = new Set();

/**
 * Scan the whole box for broken refs (cards' frontmatter/body refs, and
 * `.md` dossiers' inline links) and fail closed on any hit NOT matched in
 * `preBroken` (default: none — every hit blocks, the pre-round-9 behavior).
 */
export async function runOneRootLinkGate(
  boxRoot: string,
  options?: { preBroken: ReadonlySet<string> },
): Promise<OneRootLinkGateResult> {
  const preBroken = options?.preBroken ?? NO_PRE_BROKEN;

  const cardRefs = await collectBrokenCardRefLines(boxRoot, preBroken);
  const markdown = await collectBrokenMarkdownReport(boxRoot, preBroken);
  const viewPaths = await listBoxViewFiles(boxRoot);
  const viewRefs = await collectBrokenViewLines({ viewPaths, boxRoot, preBroken });
  const dependencyWarnings = await collectViewDependencyWarnings(viewPaths, boxRoot);
  const carriedThroughCount = cardRefs.carriedThroughCount + markdown.carriedThroughCount + viewRefs.carriedThroughCount;

  if (cardRefs.lines.length === 0 && markdown.report === null && viewRefs.lines.length === 0 && dependencyWarnings.length === 0) {
    return { ok: true, report: "", carriedThroughCount };
  }

  const lines: string[] = [
    "one-root migration: hard link gate found broken references after the ref rewrite — refusing to commit.",
  ];
  if (cardRefs.lines.length > 0) {
    lines.push(`${String(cardRefs.lines.length)} broken card reference(s):`, ...cardRefs.lines);
  }
  if (markdown.report !== null) {
    lines.push("Broken markdown links:", markdown.report);
  }
  if (viewRefs.lines.length > 0) {
    lines.push(`${String(viewRefs.lines.length)} broken view reference(s):`, ...viewRefs.lines);
  }
  if (dependencyWarnings.length > 0) {
    lines.push(`${String(dependencyWarnings.length)} unmigrated view dependency glob(s):`);
    for (const warning of dependencyWarnings) lines.push(`  ${warning}`);
  }
  if (carriedThroughCount > 0) {
    lines.push(`(${String(carriedThroughCount)} pre-existing broken reference(s) carried through, not counted above)`);
  }
  return { ok: false, report: lines.join("\n"), carriedThroughCount };
}

/**
 * Round-7 hardening finding 4's backstop: {@link rewriteOneRootViewDependencies}
 * (`one-root-ref-rewrite.ts`) already fails the migration closed on an
 * unmappable dependency glob, but that check runs against the OLD v2 table —
 * it can't see whether the v3 area it produced is one the box namespace
 * actually recognizes today. Re-derive each view's (already rewritten)
 * dependency globs and flag any whose static prefix's first path segment
 * isn't an underscore area, the same class of gap the hard link gate exists
 * to catch for every other ref form.
 */
async function collectViewDependencyWarnings(viewPaths: string[], boxRoot: string): Promise<string[]> {
  const warnings: string[] = [];
  for (const viewPath of viewPaths) {
    const lst = await fs.lstat(viewPath).catch(() => null);
    if (lst === null || lst.isSymbolicLink()) continue; // same skip as collectViewRefWarnings
    const text = await fs.readFile(viewPath, "utf-8");
    const relPath = path.relative(boxRoot, viewPath);
    for (const glob of extractDependencyGlobs(text, relPath)) {
      const { prefix } = staticGlobPrefix(glob);
      // A prefixless, box-wide glob is layout-agnostic — the runtime loader
      // restricts it to the box namespace; same exemption the rewriter gives
      // it (one-root-view-dependencies.ts).
      if (prefix === "" && glob.startsWith("*")) continue;
      const firstSegment = prefix.split("/", 1)[0] ?? "";
      if (!isInBoxNamespace(firstSegment)) {
        warnings.push(`${relPath}: dependency glob "${glob}" does not resolve into a box area`);
      }
    }
  }
  return warnings;
}
