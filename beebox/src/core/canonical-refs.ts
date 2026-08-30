/**
 * Canonical-form checking for box refs — the detection half of
 * `bbx validate --canonical` (`docs/implemented-plans/box-root-paths.md`, Track F).
 *
 * A ref is **canonical** when it addresses its target from the box root
 * (`/store/notes/Plan.doc.card`), or is the one sanctioned exception: a card's
 * own `attach/…` scope. A document-relative ref (`../people/Dana.person.card`,
 * `Plan.doc.card`) still resolves — liberal resolution is permanent, see
 * `src/shared/ref-path.ts` — but it is non-canonical: it means something
 * different depending on where the document lives, which is exactly what breaks
 * when an agent copies a ref between documents.
 *
 * **Off by default, on purpose.** A box carries legacy relative refs by the
 * hundred; warning about them in the default walk would bury the broken-ref
 * signal that actually needs acting on. `--canonical` is opt-in reporting and
 * `--canonical --fix` (`canonicalize-refs.ts`) is the one-command migration.
 *
 * All ref algebra comes from `src/shared/ref-path.ts`; this module only decides
 * which form a ref is written in and how to phrase the finding.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { isAttachRef } from "../shared/attach-path.js";
import {
  formatRefSuffix,
  isExternalRef,
  parseRef,
  resolveRefPath,
  type RefKind,
} from "../shared/ref-path.js";
import { extractInlineLinks, resolveInternalLink } from "./markdown-lint-rules.js";
import { resolveRefExists } from "./ref-exists.js";
import { extractViewRefs } from "./views/refs.js";
import { fileExists } from "../lib/file-exists.js";
import { assertNever } from "../lib/invariant.js";

/**
 * The verdict on one ref:
 *  - `canonical` — box-root-absolute, a card's `attach/…`, or external/empty
 *    (nothing in the box to re-express)
 *  - `rewritable` — document-relative and resolvable; `canonical` is the
 *    box-root form it should be written as
 *  - `escapes` — document-relative but climbing out of the box, so there is no
 *    box-root form to offer (reported, never rewritten)
 */
export type CanonicalCheck =
  | { status: "canonical" }
  | { status: "rewritable"; canonical: string }
  | { status: "escapes" };

export interface CanonicalRefInput {
  /** The raw ref as written, suffix and all. */
  ref: string;
  /** Box-relative path of the document holding the ref (a file path). */
  fromPath: string;
  kind: RefKind;
}

/**
 * The verdict once the filesystem has been consulted — what `--fix` will
 * actually do, and therefore what the report previews:
 *  - `rewritable` — the ref resolves as written; rewriting it to `canonical`
 *    keeps the same target
 *  - `repairable` — the ref is DANGLING read document-relative, but the same
 *    bare path names an existing file read from the box root. Old system code
 *    wrote refs with box-root intent (`people/Dana.person.card` in a card that
 *    lives three directories down); `canonical` is that box-root form, and
 *    writing it turns a broken ref into a working one
 *  - `ambiguous` — BOTH readings name existing files. The document-relative
 *    reading is what resolves at runtime today, so this ref works; rewriting it
 *    either way risks silently retargeting a working ref, so it is left alone
 *    and reported for a human
 *  - `dangling` — neither reading names anything; left alone, as before
 */
export type CanonicalPlan =
  | { status: "canonical" }
  | { status: "escapes" }
  | { status: "rewritable"; canonical: string }
  | { status: "repairable"; canonical: string }
  | { status: "ambiguous"; canonical: string; rootForm: string }
  | { status: "dangling"; canonical: string };

/**
 * Whether a ref names an existing file, resolved the way the surface holding it
 * resolves refs (cards/views through `resolveRefExists`, dossiers through the
 * markdown link resolver). The planner probes twice: once with the ref as
 * written, once with its box-root reading.
 */
export type RefExistsProbe = (ref: string) => Promise<boolean>;

/** Classify one ref's form. Pure — no filesystem access (existence is the fixer's gate). */
export function checkCanonicalRef({ ref, fromPath, kind }: CanonicalRefInput): CanonicalCheck {
  if (isExternalRef(ref)) return { status: "canonical" };
  const parsed = parseRef(ref);
  if (parsed.path === "") return { status: "canonical" };
  if (parsed.path.startsWith("/")) return { status: "canonical" };
  // `attach/…` is the deliberate exception to box-root addressing — it names
  // the card's OWN scope and travels with the card, so it is already canonical.
  if (kind === "card" && isAttachRef(parsed.path)) return { status: "canonical" };
  const resolved = resolveRefPath({ fromPath, ref: parsed.path, kind });
  if (resolved === null) return { status: "escapes" };
  return { status: "rewritable", canonical: `/${resolved}${formatRefSuffix(parsed)}` };
}

/**
 * The bare ref read from the BOX ROOT instead of from its document — the
 * box-root-intent reading old system code meant when it wrote
 * `people/Dana.person.card` into a card three directories down. `null` when
 * there is no such reading (an escaping or empty ref).
 */
function boxRootReading({ ref, kind }: { ref: string; kind: RefKind }): string | null {
  const parsed = parseRef(ref);
  const resolved = resolveRefPath({ fromPath: undefined, ref: parsed.path, kind });
  return resolved === null ? null : `/${resolved}${formatRefSuffix(parsed)}`;
}

/**
 * The full decision for one ref: its form, plus what the filesystem says about
 * each reading. The single classifier behind BOTH `--canonical` reporting and
 * `--canonical --fix`, so the report can't preview a rewrite the fixer wouldn't
 * make (or hide one it would).
 */
export async function planCanonicalRef(
  { ref, fromPath, kind }: CanonicalRefInput,
  { exists }: { exists: RefExistsProbe }
): Promise<CanonicalPlan> {
  const check = checkCanonicalRef({ ref, fromPath, kind });
  if (check.status !== "rewritable") return check;
  const relExists = await exists(ref);
  const rootForm = boxRootReading({ ref, kind });
  // A document at the box root reads both ways identically — there is nothing
  // to be ambiguous about, and nothing to repair.
  if (rootForm === null || rootForm === check.canonical) {
    return relExists ? check : { status: "dangling", canonical: check.canonical };
  }
  const rootExists = await exists(rootForm);
  if (relExists) {
    return rootExists ? { status: "ambiguous", canonical: check.canonical, rootForm } : check;
  }
  return rootExists
    ? { status: "repairable", canonical: rootForm }
    : { status: "dangling", canonical: check.canonical };
}

/** How cards and views resolve a ref: the same check the broken-ref walk runs. */
export function cardRefProbe({ absPath, boxRoot }: { absPath: string; boxRoot: string }): RefExistsProbe {
  return (ref) => resolveRefExists({ ref, fromPath: absPath, boxRoot });
}

/** How a `.md` dossier resolves a link: the same check BBX002 runs. */
export function dossierLinkProbe({ absPath, boxRoot }: { absPath: string; boxRoot: string }): RefExistsProbe {
  const fileDir = path.dirname(absPath);
  return async (ref) => {
    const resolution = resolveInternalLink(ref, { fileDir, boxRoot });
    return resolution.inside && (await fileExists(resolution.resolved));
  };
}

/**
 * The reported message for a non-canonical ref. It names the rewrite so the
 * report doubles as a preview of what `--fix` would write. Returns `null` for a
 * canonical ref so callers can filter and format in one pass.
 */
export function canonicalIssueMessage(
  input: { locator: string; ref: string },
  plan: CanonicalPlan
): string | null {
  const { locator, ref } = input;
  const head = `Non-canonical ref at ${locator}: ${ref}`;
  switch (plan.status) {
    case "canonical":
      return null;
    // `dangling` reads the same as `rewritable`: both name the box-root form of
    // the ref as written. `--fix` only writes the first, which the summary line
    // (and its skipped count) says.
    case "rewritable":
    case "dangling":
      return `${head} → ${plan.canonical}`;
    case "repairable":
      return `${head} → ${plan.canonical} (repairs dangling ref)`;
    case "ambiguous":
      return `${head} resolves both ways — ${plan.canonical} (document-relative, what runs today) and ${plan.rootForm} (from the box root); ambiguous, left alone`;
    case "escapes":
      return `${head} escapes the box — no box-root form, fix it by hand`;
    default:
      return assertNever(plan);
  }
}

/**
 * The referring document's path as the shared algebra wants its `fromPath`:
 * box-relative, forward slashes. `null` when the document lies outside the box.
 */
export function boxRelativeDoc(boxRoot: string, absPath: string): string | null {
  const rel = path.relative(path.resolve(boxRoot), path.resolve(absPath));
  if (rel === "" || rel === ".." || rel.startsWith(".." + path.sep)) return null;
  return rel.split(path.sep).join("/");
}

/**
 * Non-canonical `cardRef="…"` findings across box-authored views, each prefixed
 * with the view's box-relative path. Views aren't cards, but their refs are
 * resolved as card refs (`views/refs.ts`), so they are classified the same way
 * and counted in the card-ref bucket.
 *
 * A view has no document-relative base inside the box, so its refs resolve from
 * the box root (`fromPath: ""`) regardless of whether the source file lives at
 * the legacy in-box path or the v2 package-side path.
 */
export async function collectViewCanonicalWarnings(
  viewPaths: string[],
  boxRoot: string
): Promise<string[]> {
  const out: string[] = [];
  for (const viewPath of viewPaths) {
    const label = path.relative(boxRoot, viewPath).split(path.sep).join("/");
    const fromPath = "";
    let source: string;
    try {
      source = await fs.readFile(viewPath, "utf-8");
    } catch (_e) {
      // An unreadable view is the compile-check's concern, not this walk's.
      continue;
    }
    const exists: RefExistsProbe = (ref) => resolveRefExists({ ref, fromPath, boxRoot });
    for (const { path: locator, ref } of extractViewRefs(source)) {
      const plan = await planCanonicalRef({ ref, fromPath, kind: "card" }, { exists });
      const message = canonicalIssueMessage({ locator, ref }, plan);
      if (message !== null) out.push(`${label}: ${message}`);
    }
  }
  return out;
}

/**
 * Non-canonical `[text](path)` findings in plain `.md` dossiers — the second
 * summary bucket. Same link walk BBX002 uses (`extractInlineLinks`), so the
 * canonical report covers exactly the links validate already checks; `kind:
 * "markdown"` because a dossier owns no attach scope.
 */
export async function collectDossierCanonicalWarnings(
  mdPaths: string[],
  boxRoot: string
): Promise<string[]> {
  const out: string[] = [];
  for (const mdPath of mdPaths) {
    const fromPath = boxRelativeDoc(boxRoot, mdPath);
    if (fromPath === null) continue;
    let text: string;
    try {
      text = await fs.readFile(mdPath, "utf-8");
    } catch (_e) {
      // An unreadable dossier is already an error in the markdownlint pass.
      continue;
    }
    const exists = dossierLinkProbe({ absPath: mdPath, boxRoot });
    for (const link of extractInlineLinks(text.split("\n"))) {
      const plan = await planCanonicalRef({ ref: link.url, fromPath, kind: "markdown" }, { exists });
      const message = canonicalIssueMessage(
        { locator: `line ${String(link.lineNumber)}`, ref: link.url },
        plan
      );
      if (message !== null) out.push(`${fromPath}: ${message}`);
    }
  }
  return out;
}

/**
 * The two-bucket summary line. Card refs (frontmatter, body Markdoc, body
 * links, view `cardRef=`) and `.md` dossier links are reported distinctly —
 * they are different surfaces with different fixers, and collapsing them would
 * hide which one a box's drift lives in.
 */
export function formatCanonicalSummary(
  counts: { refs: number; dossierLinks: number },
  { colors }: { colors: boolean }
): string {
  const { refs, dossierLinks } = counts;
  const ESC = "";
  const yellow = colors ? (s: string) => `${ESC}[33m${s}${ESC}[0m` : (s: string) => s;
  if (refs === 0 && dossierLinks === 0) {
    return "Canonical refs: all refs are box-root-canonical.";
  }
  const refPart = `${String(refs)} non-canonical ref${refs === 1 ? "" : "s"}`;
  const linkPart = `${String(dossierLinks)} non-canonical dossier link${dossierLinks === 1 ? "" : "s"}`;
  return (
    `Canonical refs: ${yellow(refPart)}, ${yellow(linkPart)} ` +
    "— rerun with `--canonical --fix` to rewrite the ones whose target exists"
  );
}
