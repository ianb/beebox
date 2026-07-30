/**
 * The normalizer half of `cb validate --canonical --fix`: rewrite every
 * document-relative ref in a box to its box-root form. Detection and the
 * two-bucket vocabulary live in `canonical-refs.ts`; this module only decides
 * *which* findings are safe to write and performs the write.
 *
 * **Only refs that resolve are rewritten.** A ref whose target doesn't exist is
 * reported, never rewritten — re-expressing a dangling relative ref from the
 * box root would invent a path nobody can verify, turning a visible broken-ref
 * warning into a confident lie. Same for a ref that escapes the box: there is
 * no box-root form to write.
 *
 * **Text-surgical, never parse-reserialize.** Cards are rewritten through `cb
 * mv`'s scan machinery (`rewrite-card-refs.ts`), which splices a replacement
 * into the matched span of the raw text. Parsing and reserializing a card would
 * reorder its frontmatter keys to schema order (see CLAUDE.md) — an
 * unacceptable diff for a tool whose whole job is a mechanical one-line-per-ref
 * change. Dossier links are patched in place on their own line.
 *
 * The scan machinery matches ref-bearing *syntax* (`ref:` lines, `ref=`/
 * `cardRef=` attributes, `[…](…)`), a slightly wider net than the report's
 * structured extractors. Over-matching is harmless: every replacement is gated
 * on the target existing, so a non-ref token is left alone (and counted as
 * skipped). The one deliberate narrowing is fenced code — this fixer scans
 * cards with `skipFencedCode: true`, unlike `cb mv`, because a fenced example
 * may be teaching the legacy relative form on purpose.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { boxRelativeDoc, checkCanonicalRef } from "./canonical-refs.js";
import { listBoxCardFiles, listBoxMarkdownFiles, listBoxViewFiles } from "./list-cards.js";
import { extractInlineLinks, resolveInternalLink } from "./markdown-lint-rules.js";
import { resolveRefExists } from "./ref-exists.js";
import {
  collectCardRefTokens,
  collectViewRefTokens,
  rewriteCardRefTokens,
  rewriteViewRefTokens,
} from "./rewrite-card-refs.js";
import { fileExists } from "../lib/file-exists.js";
import { isTrashedCard } from "../lib/paths.js";
import type { ValidationIgnore } from "./validation-ignore.js";

export interface CanonicalizeReport {
  /** Card/view refs rewritten to their box-root form. */
  refsRewritten: number;
  /** `.md` dossier links rewritten to their box-root form. */
  dossierLinksRewritten: number;
  /** Files whose text changed. */
  filesChanged: number;
  /** Non-canonical refs left alone: the target doesn't exist, or the ref escapes the box. */
  skipped: number;
}

/** A per-file outcome, summed into the box-wide report. */
interface FileOutcome {
  rewritten: number;
  skipped: number;
}

const NOTHING: FileOutcome = { rewritten: 0, skipped: 0 };

/**
 * Rewrite every resolvable document-relative ref in the box to its box-root
 * form. Walks the same surfaces the `--canonical` report walks: cards (minus
 * trash and `cb-validate.ignore`d paths), box-authored views, and `.md`
 * dossiers.
 */
export async function canonicalizeBox(
  boxRoot: string,
  { ignore }: { ignore: ValidationIgnore }
): Promise<CanonicalizeReport> {
  const report: CanonicalizeReport = {
    refsRewritten: 0,
    dossierLinksRewritten: 0,
    filesChanged: 0,
    skipped: 0,
  };

  const cardPaths = (await listBoxCardFiles(boxRoot)).filter(
    (p) => !isTrashedCard(p) && !ignore.isIgnored(p)
  );
  for (const cardPath of cardPaths) {
    const outcome = await canonicalizeTokenFile(cardPath, { boxRoot, form: "card" });
    accumulate(report, { outcome, bucket: "refs" });
  }

  for (const viewPath of await listBoxViewFiles(boxRoot)) {
    const outcome = await canonicalizeTokenFile(viewPath, { boxRoot, form: "view" });
    accumulate(report, { outcome, bucket: "refs" });
  }

  const mdPaths = (await listBoxMarkdownFiles(boxRoot)).filter((p) => !ignore.isIgnored(p));
  for (const mdPath of mdPaths) {
    const outcome = await canonicalizeDossier(mdPath, boxRoot);
    accumulate(report, { outcome, bucket: "dossierLinks" });
  }

  return report;
}

function accumulate(
  report: CanonicalizeReport,
  { outcome, bucket }: { outcome: FileOutcome; bucket: "refs" | "dossierLinks" }
): void {
  report.skipped += outcome.skipped;
  if (outcome.rewritten === 0) return;
  report.filesChanged += 1;
  if (bucket === "refs") report.refsRewritten += outcome.rewritten;
  else report.dossierLinksRewritten += outcome.rewritten;
}

/**
 * Cards and views: collect the raw ref tokens, decide each one (form + target
 * existence), then replay the decision through the same scan. Two passes
 * because the decision is async and the scan's transform is sync.
 */
async function canonicalizeTokenFile(
  absPath: string,
  { boxRoot, form }: { boxRoot: string; form: "card" | "view" }
): Promise<FileOutcome> {
  const fromPath = boxRelativeDoc(boxRoot, absPath);
  if (fromPath === null) return NOTHING;
  let text: string;
  try {
    text = await fs.readFile(absPath, "utf-8");
  } catch (e) {
    console.warn(`canonicalize: cannot read ${absPath}`, e);
    return NOTHING;
  }

  // `skipFencedCode` is the one place the canonical fixer's scan differs from
  // `cb mv`'s (see `BodyScanOptions`): a fenced example may deliberately show
  // the legacy relative form, and normalizing it would erase what it teaches.
  // Collect and replay must pass the same flag or the replay drifts.
  const tokens =
    form === "card"
      ? collectCardRefTokens({ text, skipFencedCode: true })
      : collectViewRefTokens(text);
  const replacements = new Map<string, string>();
  let skipped = 0;
  for (const token of tokens) {
    // Views hold card refs (`views/refs.ts` resolves them as such), so both
    // forms classify with `kind: "card"`.
    const check = checkCanonicalRef({ ref: token, fromPath, kind: "card" });
    if (check.status === "canonical") continue;
    if (check.status === "escapes") {
      skipped += 1;
      continue;
    }
    if (!(await resolveRefExists({ ref: token, fromPath: absPath, boxRoot }))) {
      skipped += 1;
      continue;
    }
    replacements.set(token, check.canonical);
  }
  if (replacements.size === 0) return { rewritten: 0, skipped };

  const result =
    form === "card"
      ? rewriteCardRefTokens({ text, replacements, skipFencedCode: true })
      : rewriteViewRefTokens({ text, replacements });
  if (result.count > 0) await fs.writeFile(absPath, result.text);
  return { rewritten: result.count, skipped };
}

/**
 * Dossiers: patch each `[text](url)` in place on its own line, right-to-left so
 * earlier offsets stay valid. The replacement is spliced into the matched
 * link span at the url's own position, which preserves whatever whitespace or
 * label text surrounded it.
 */
async function canonicalizeDossier(absPath: string, boxRoot: string): Promise<FileOutcome> {
  const fromPath = boxRelativeDoc(boxRoot, absPath);
  if (fromPath === null) return NOTHING;
  let text: string;
  try {
    text = await fs.readFile(absPath, "utf-8");
  } catch (e) {
    console.warn(`canonicalize: cannot read ${absPath}`, e);
    return NOTHING;
  }

  const lines = text.split("\n");
  const fileDir = path.dirname(absPath);
  let rewritten = 0;
  let skipped = 0;
  for (const link of extractInlineLinks(lines).toReversed()) {
    const check = checkCanonicalRef({ ref: link.url, fromPath, kind: "markdown" });
    if (check.status === "canonical") continue;
    if (check.status === "escapes") {
      skipped += 1;
      continue;
    }
    const resolution = resolveInternalLink(link.url, { fileDir, boxRoot });
    if (!resolution.inside || !(await fileExists(resolution.resolved))) {
      skipped += 1;
      continue;
    }
    const line = lines[link.lineNumber - 1];
    if (line === undefined) continue;
    const patched = spliceUrl(line, { link, newUrl: check.canonical });
    if (patched === null) continue;
    lines[link.lineNumber - 1] = patched;
    rewritten += 1;
  }
  if (rewritten === 0) return { rewritten: 0, skipped };
  await fs.writeFile(absPath, lines.join("\n"));
  return { rewritten, skipped };
}

/**
 * Replace one link's url inside its own `[…](…)` span. The url is located from
 * the END of the span so a self-titled link (`[notes.md](notes.md)`) patches the
 * target, not the label. `null` when the span no longer holds the url (it can't
 * happen for a freshly-extracted link, but a miss must not corrupt the line).
 */
function spliceUrl(
  line: string,
  { link, newUrl }: { link: { index: number; length: number; url: string }; newUrl: string }
): string | null {
  const span = line.slice(link.index, link.index + link.length);
  const at = span.lastIndexOf(link.url);
  if (at === -1) return null;
  const newSpan = span.slice(0, at) + newUrl + span.slice(at + link.url.length);
  return line.slice(0, link.index) + newSpan + line.slice(link.index + link.length);
}

/** One-line human summary of a `--fix` run. */
export function formatCanonicalizeReport(report: CanonicalizeReport): string {
  const { refsRewritten, dossierLinksRewritten, filesChanged, skipped } = report;
  const skippedPart =
    skipped === 0
      ? ""
      : `; ${String(skipped)} left unrewritten (target missing or ref escapes the box)`;
  return (
    `Canonicalized ${String(refsRewritten)} ref${refsRewritten === 1 ? "" : "s"} and ` +
    `${String(dossierLinksRewritten)} dossier link${dossierLinksRewritten === 1 ? "" : "s"} ` +
    `in ${String(filesChanged)} file${filesChanged === 1 ? "" : "s"}${skippedPart}`
  );
}
