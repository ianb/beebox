/**
 * Canonical-form checking for box refs — the detection half of
 * `cb validate --canonical` (`docs/implemented-plans/box-root-paths.md`, Track F).
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
import { extractInlineLinks } from "./markdown-lint-rules.js";
import { extractViewRefs } from "./views/refs.js";
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
 * The reported message for a non-canonical ref. It names the rewrite so the
 * report doubles as a preview of what `--fix` would write. Returns `null` for a
 * canonical ref so callers can filter and format in one pass.
 */
export function canonicalIssueMessage(
  input: { locator: string; ref: string },
  check: CanonicalCheck
): string | null {
  const { locator, ref } = input;
  switch (check.status) {
    case "canonical":
      return null;
    case "rewritable":
      return `Non-canonical ref at ${locator}: ${ref} → ${check.canonical}`;
    case "escapes":
      return `Non-canonical ref at ${locator}: ${ref} escapes the box — no box-root form, fix it by hand`;
    default:
      return assertNever(check);
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
 * A view that lies OUTSIDE the box root is skipped: on a v2 box views live at
 * `<packageRoot>/src/views/`, so there is no `fromPath` to resolve a relative
 * ref against — the shared algebra fails closed there exactly as
 * `resolveRefExists` already does for the same files.
 */
export async function collectViewCanonicalWarnings(
  viewPaths: string[],
  boxRoot: string
): Promise<string[]> {
  const out: string[] = [];
  for (const viewPath of viewPaths) {
    const fromPath = boxRelativeDoc(boxRoot, viewPath);
    if (fromPath === null) continue;
    let source: string;
    try {
      source = await fs.readFile(viewPath, "utf-8");
    } catch (_e) {
      // An unreadable view is the compile-check's concern, not this walk's.
      continue;
    }
    for (const { path: locator, ref } of extractViewRefs(source)) {
      const message = canonicalIssueMessage(
        { locator, ref },
        checkCanonicalRef({ ref, fromPath, kind: "card" })
      );
      if (message !== null) out.push(`${fromPath}: ${message}`);
    }
  }
  return out;
}

/**
 * Non-canonical `[text](path)` findings in plain `.md` dossiers — the second
 * summary bucket. Same link walk CB002 uses (`extractInlineLinks`), so the
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
    for (const link of extractInlineLinks(text.split("\n"))) {
      const message = canonicalIssueMessage(
        { locator: `line ${String(link.lineNumber)}`, ref: link.url },
        checkCanonicalRef({ ref: link.url, fromPath, kind: "markdown" })
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
