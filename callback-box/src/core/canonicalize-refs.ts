/**
 * The normalizer half of `cb validate --canonical --fix`: rewrite every
 * document-relative ref in a box to its box-root form. Detection and the
 * two-bucket vocabulary live in `canonical-refs.ts`; this module only decides
 * *which* findings are safe to write and performs the write.
 *
 * **Only refs that resolve are rewritten.** A ref whose target doesn't exist
 * under EITHER reading is reported, never rewritten — re-expressing a dangling
 * relative ref from the box root would invent a path nobody can verify, turning
 * a visible broken-ref warning into a confident lie. Same for a ref that
 * escapes the box: there is no box-root form to write.
 *
 * **The one rescue: box-root intent.** Old system code wrote bare refs meaning
 * them from the box root (`people/Dana.person.card` in a card three
 * directories down). Read document-relative they dangle, but the same bare path
 * names a real file read from the root, so `--fix` writes that `/`-leading form
 * — a repair, counted separately from an ordinary canonicalization because it
 * changes the ref's target (from nothing to something). If BOTH readings name
 * an existing file the ref is left alone and reported as ambiguous: the
 * document-relative reading is what resolves at runtime today, so the ref
 * works, and guessing at intent would silently retarget it.
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
import {
  boxRelativeDoc,
  cardRefProbe,
  dossierLinkProbe,
  planCanonicalRef,
} from "./canonical-refs.js";
import { listBoxCardFiles, listBoxMarkdownFiles, listBoxViewFiles } from "./list-cards.js";
import { extractInlineLinks } from "./markdown-lint-rules.js";
import {
  collectCardRefTokens,
  collectViewRefTokens,
  rewriteCardRefTokens,
  rewriteViewRefTokens,
} from "./rewrite-card-refs.js";
import { assertNever } from "../lib/invariant.js";
import { isTrashedCard } from "../lib/paths.js";
import type { ValidationIgnore } from "./validation-ignore.js";

export interface CanonicalizeReport {
  /** Card/view refs rewritten to their box-root form, same target as before. */
  refsRewritten: number;
  /** `.md` dossier links rewritten to their box-root form, same target as before. */
  dossierLinksRewritten: number;
  /** Dangling card/view refs rewritten to the box-root reading that DOES resolve. */
  refsRepaired: number;
  /** Dangling dossier links rewritten to the box-root reading that DOES resolve. */
  dossierLinksRepaired: number;
  /** Refs whose two readings BOTH resolve — left alone rather than retargeted. */
  ambiguous: number;
  /** Files whose text changed. */
  filesChanged: number;
  /** Non-canonical refs left alone: neither reading resolves, or the ref escapes the box. */
  skipped: number;
}

/** A per-file outcome, summed into the box-wide report. */
interface FileOutcome {
  /** Rewrites that keep the ref's current target. */
  canonicalized: number;
  /** Rewrites that turn a dangling ref into a working one. */
  repaired: number;
  ambiguous: number;
  skipped: number;
}

const NOTHING: FileOutcome = { canonicalized: 0, repaired: 0, ambiguous: 0, skipped: 0 };

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
    refsRepaired: 0,
    dossierLinksRepaired: 0,
    ambiguous: 0,
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
  report.ambiguous += outcome.ambiguous;
  if (bucket === "refs") {
    report.refsRewritten += outcome.canonicalized;
    report.refsRepaired += outcome.repaired;
  } else {
    report.dossierLinksRewritten += outcome.canonicalized;
    report.dossierLinksRepaired += outcome.repaired;
  }
  if (outcome.canonicalized + outcome.repaired > 0) report.filesChanged += 1;
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
  const exists = cardRefProbe({ absPath, boxRoot });
  const sameTarget = new Map<string, string>();
  const repairs = new Map<string, string>();
  let ambiguous = 0;
  let skipped = 0;
  for (const token of tokens) {
    // Views hold card refs (`views/refs.ts` resolves them as such), so both
    // forms classify with `kind: "card"`.
    const plan = await planCanonicalRef({ ref: token, fromPath, kind: "card" }, { exists });
    switch (plan.status) {
      case "canonical":
        break;
      case "rewritable":
        sameTarget.set(token, plan.canonical);
        break;
      case "repairable":
        repairs.set(token, plan.canonical);
        break;
      case "ambiguous":
        ambiguous += 1;
        break;
      case "escapes":
      case "dangling":
        skipped += 1;
        break;
      default:
        return assertNever(plan);
    }
  }
  if (sameTarget.size === 0 && repairs.size === 0) {
    return { canonicalized: 0, repaired: 0, ambiguous, skipped };
  }

  // Two replay passes, one per bucket, so each rewrite is attributed to the
  // outcome it belongs to (the scan reports a total count, not per-token). The
  // passes can't interfere: every pass-1 replacement is `/`-leading, and every
  // pass-2 key is a bare relative ref.
  const replay = (input: string, replacements: Map<string, string>) =>
    form === "card"
      ? rewriteCardRefTokens({ text: input, replacements, skipFencedCode: true })
      : rewriteViewRefTokens({ text: input, replacements });
  const canonicalized = replay(text, sameTarget);
  const repaired = replay(canonicalized.text, repairs);
  if (canonicalized.count + repaired.count > 0) await fs.writeFile(absPath, repaired.text);
  return { canonicalized: canonicalized.count, repaired: repaired.count, ambiguous, skipped };
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
  const exists = dossierLinkProbe({ absPath, boxRoot });
  let canonicalized = 0;
  let repaired = 0;
  let ambiguous = 0;
  let skipped = 0;
  for (const link of extractInlineLinks(lines).toReversed()) {
    const plan = await planCanonicalRef({ ref: link.url, fromPath, kind: "markdown" }, { exists });
    let newUrl: string;
    switch (plan.status) {
      case "canonical":
        continue;
      case "ambiguous":
        ambiguous += 1;
        continue;
      case "escapes":
      case "dangling":
        skipped += 1;
        continue;
      case "rewritable":
      case "repairable":
        newUrl = plan.canonical;
        break;
      default:
        return assertNever(plan);
    }
    const line = lines[link.lineNumber - 1];
    if (line === undefined) continue;
    const patched = spliceUrl(line, { link, newUrl });
    if (patched === null) continue;
    lines[link.lineNumber - 1] = patched;
    if (plan.status === "repairable") repaired += 1;
    else canonicalized += 1;
  }
  if (canonicalized + repaired === 0) return { canonicalized: 0, repaired: 0, ambiguous, skipped };
  await fs.writeFile(absPath, lines.join("\n"));
  return { canonicalized, repaired, ambiguous, skipped };
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

/** `n thing` / `n things`. */
function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * One-line human summary of a `--fix` run. The three outcomes are named
 * separately because they mean different things to a boxholder: a
 * canonicalization changes only how a working ref is written, a repair turns a
 * broken ref into a working one, and an ambiguous ref is a decision left for a
 * human. The repair and ambiguity clauses are omitted when they're zero — most
 * boxes have neither.
 */
export function formatCanonicalizeReport(report: CanonicalizeReport): string {
  const { refsRewritten, dossierLinksRewritten, refsRepaired, dossierLinksRepaired } = report;
  const { ambiguous, filesChanged, skipped } = report;
  const parts = [
    `Canonicalized ${plural(refsRewritten, "ref")} and ` +
      `${plural(dossierLinksRewritten, "dossier link")} in ${plural(filesChanged, "file")}`,
  ];
  if (refsRepaired + dossierLinksRepaired > 0) {
    parts.push(
      `repaired ${plural(refsRepaired, "dangling ref")} and ` +
        `${plural(dossierLinksRepaired, "dossier link")} that resolve from the box root`
    );
  }
  if (ambiguous > 0) parts.push(`${plural(ambiguous, "ref")} ambiguous (both readings exist) left alone`);
  if (skipped > 0) parts.push(`${String(skipped)} left unrewritten (target missing or ref escapes the box)`);
  return parts.join("; ");
}
