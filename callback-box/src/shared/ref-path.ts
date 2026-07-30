/**
 * THE single home for box ref/path algebra: splitting a raw ref into its
 * path/query/fragment parts, and resolving that path against the document it
 * was written in.
 *
 * A "ref" is any in-box pointer a human or an agent writes — a card's
 * `ref:`/`refs:` frontmatter, a Markdoc `ref="…"` attribute, a view's
 * `cardRef=`, a markdown link/image href. It is NOT a URL: external detection
 * (`scheme:`, `//host`) is the caller's job, because the callers that can
 * receive an external value already have to branch on it for other reasons.
 *
 * **The 3-form rule** (`resolveRefPath`):
 *  - leading `/` → box-root-absolute, `fromPath` ignored
 *  - `attach/…` (or bare `attach`) → the referring card's `<basename>.attach/`
 *    scope — the one deliberate exception to box-root addressing, and legal
 *    only for `kind: "card"`
 *  - anything else → relative to `fromPath`'s directory (box root when
 *    `fromPath` is empty/undefined)
 *
 * **Fail closed.** A ref that climbs out of the box with `..` resolves to
 * `null` — everywhere, in every consumer. It is never clamped back to the root
 * (the frontend did that until 2026-07-30, which silently rendered a *different*
 * file than the ref named). `null` means "broken ref": callers must degrade
 * visibly, never substitute a guess.
 *
 * Pure string operations — no Node deps (the `attach-path.ts` precedent), so
 * the backend (relative `../shared/ref-path.js`) and the frontend
 * (`@shared/ref-path`) share one implementation.
 *
 * Consumers: `core/ref-exists.ts` (validate-side existence + the
 * `BoxRelativePath` producer), `frontend/src/lib/view-url.ts` (markdown
 * links/images, view targets), `core/rewrite-card-refs.ts` (`cb mv`'s
 * resolution-based rewriter), `core/markdown-lint-rules.ts` (CB002 + `cb
 * relink`, as `kind: "markdown"`), `core/landmark/resolve.ts` +
 * `webapp/trpc/routers/landmarks.ts` (landmark link/symbol rendering).
 * Anything else that needs to turn a ref into a path imports this module —
 * never a hand-rolled `path.resolve`, segment split, or `#`/`?` strip.
 */

import { isAttachRef, resolveAttachRef } from "./attach-path.js";
import { boxRelativePath } from "./box-path.js";
import { assertNever } from "./invariant.js";

/** A raw ref split into its addressable parts. `path` may be empty (a bare `#frag`). */
export interface ParsedRef {
  /** The path portion — what `resolveRefPath` resolves. */
  path: string;
  /** Everything after `?` and before any `#` (no leading `?`), when present. */
  query?: string;
  /** Everything after the first `#` (no leading `#`), when present. */
  fragment?: string;
}

/**
 * What the referring document is, which decides whether the `attach/` virtual
 * prefix is legal:
 *  - `card` — a `.card` file, which owns a `<basename>.attach/` scope
 *  - `markdown` — a plain `.md` dossier: it owns no attach scope, so
 *    `attach/x` is a literal relative directory segment
 *  - `write-target` — a path a command is about to CREATE (no attach form,
 *    plain path only); containment is the point of resolving it at all
 */
export type RefKind = "card" | "markdown" | "write-target";

export interface ResolveRefPathInput {
  /**
   * Box-relative path of the document the ref was written in, treated as a
   * *file* (its last segment is stripped). A directory base must carry a
   * trailing slash so the strip is a no-op. Empty/undefined resolves from the
   * box root.
   */
  fromPath: string | undefined;
  /** The ref's path portion — run it through {@link parseRef} first if it may carry `?`/`#`. */
  ref: string;
  kind: RefKind;
}

/**
 * Split a raw ref into path, query, and fragment.
 *
 * Follows URL convention for robustness even though a ref is not a URL: the
 * fragment starts at the FIRST `#` and runs to the end (so a `?` inside it is
 * fragment text), and the query is taken from what remains before it.
 *
 * `parseRef("store/Plan.doc.card#risks")` → `{ path, fragment: "risks" }`
 * `parseRef("chart.figure.card?view=ledger")` → `{ path, query: "view=ledger" }`
 */
export function parseRef(raw: string): ParsedRef {
  let rest = raw;
  let fragment: string | undefined;
  const fragmentAt = rest.indexOf("#");
  if (fragmentAt !== -1) {
    fragment = rest.slice(fragmentAt + 1);
    rest = rest.slice(0, fragmentAt);
  }
  let query: string | undefined;
  const queryAt = rest.indexOf("?");
  if (queryAt !== -1) {
    query = rest.slice(queryAt + 1);
    rest = rest.slice(0, queryAt);
  }
  return {
    path: rest,
    ...(query === undefined ? {} : { query }),
    ...(fragment === undefined ? {} : { fragment }),
  };
}

/**
 * Whether a raw ref names something *outside* the box, so there is no path to
 * resolve: any URL scheme (`http:`, `mailto:`, `data:`, the retired `view:`),
 * a protocol-relative `//host/…`, a bare `#anchor` within the current
 * document, or the empty string.
 *
 * External detection is deliberately NOT folded into `resolveRefPath` (a caller
 * holding an external value branches on it for its own reasons — rendering an
 * `<a>`, skipping a rewrite), but the *test* lives here so every caller agrees
 * on what counts as external.
 */
export function isExternalRef(raw: string): boolean {
  if (raw === "") return true;
  if (raw.startsWith("#")) return true;
  if (raw.startsWith("//")) return true;
  return /^[A-Za-z][\d+.A-Za-z-]*:/.test(raw);
}

/**
 * Resolve a ref's path against the document it was written in, per the 3-form
 * rule above. Returns the canonical internal form — box-relative, forward
 * slashes, no leading slash, `..`-free — or `null` when the ref escapes the
 * box root.
 */
export function resolveRefPath({ fromPath, ref, kind }: ResolveRefPathInput): string | null {
  if (ref.startsWith("/")) return joinSegments("", boxRelativePath(ref));

  const base = fromPath === undefined ? "" : fromPath;
  if (base !== "" && attachFormAllowed(kind) && isAttachRef(ref)) {
    const attached = resolveAttachRef(base, ref);
    if (attached !== null) return joinSegments("", attached);
  }

  return joinSegments(dirOf(base), ref);
}

/** Whether the `attach/` virtual prefix is meaningful for a document of this kind. */
function attachFormAllowed(kind: RefKind): boolean {
  switch (kind) {
    case "card":
      return true;
    case "markdown":
      return false;
    case "write-target":
      return false;
    default:
      return assertNever(kind);
  }
}

/**
 * Join a base directory and a relative path, collapsing `.`/empty segments and
 * applying `..`. Returns `null` if a `..` would climb above the box root.
 */
function joinSegments(baseDir: string, rel: string): string | null {
  const out: string[] = [];
  for (const part of [...baseDir.split("/"), ...rel.split("/")]) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

/** The directory portion of a file path (`""` when there is no separator). */
function dirOf(filePath: string): string {
  const i = filePath.lastIndexOf("/");
  return i === -1 ? "" : filePath.slice(0, i);
}
