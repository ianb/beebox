/**
 * Helpers for the `.attach/` directory convention.
 *
 * Every card may have a sibling directory named `<basename>.attach/`. Files
 * placed in that directory belong to the card. Refs from the card to its
 * attached files use the virtual prefix `attach/<file>`; the resolver expands
 * the prefix against the card's attach scope.
 *
 * Pure string operations — no Node deps. Lives in `src/shared/` so both the
 * backend (CLI, connectors, webapp; relative `../shared/attach-path.js`) and
 * the frontend (`@shared/attach-path`) import the one source of truth.
 */

/** Suffix that marks a directory as a card's attach scope. */
export const ATTACH_SUFFIX = ".attach";

/** Virtual prefix used in ref values pointing into the current card's attach scope. */
const ATTACH_PREFIX = "attach/";

/**
 * Card basename — the part of the filename before `.<type>.card`.
 *
 * `Foo.image.card` → `Foo`
 * `Voice_Memo.memo.card` → `Voice_Memo`
 * `scan-001.capture-session.card` → `scan-001`
 *
 * Returns the filename unchanged if it doesn't end with `.card` or has no type
 * segment before `.card`.
 */
export function cardBasename(cardFileNameOrPath: string): string {
  const name = lastSegment(cardFileNameOrPath);
  if (!name.endsWith(".card")) return name;
  const withoutCard = name.slice(0, -".card".length);
  const lastDot = withoutCard.lastIndexOf(".");
  if (lastDot === -1) return withoutCard;
  return withoutCard.slice(0, lastDot);
}

/**
 * Compute the attach directory path for a given card. The returned path is in
 * the same directory as the card, with name `<basename>.attach`.
 *
 * Works with absolute or relative paths — uses the input's directory.
 */
export function attachDirFor(cardPath: string): string {
  const dir = dirSegment(cardPath);
  const base = cardBasename(cardPath);
  const suffix = base + ATTACH_SUFFIX;
  return dir === "" ? suffix : dir + "/" + suffix;
}

/**
 * Compute the path of an attached file under a card's scope.
 *
 * `attachmentPath("inbox/Foo.image.card", "photo-001.jpg")`
 *   → `"inbox/Foo.attach/photo-001.jpg"`
 *
 * `fileName` is a path *within* the attach scope — may itself contain
 * subdirectories (`"attachments/foo.pdf"`, `"sub/scan.image.card"`).
 */
export function attachmentPath(cardPath: string, fileName: string): string {
  const dir = attachDirFor(cardPath);
  return dir + "/" + fileName;
}

/**
 * Test whether a ref value uses the `attach/` virtual prefix. The prefix is
 * only meaningful as the first path segment.
 */
export function isAttachRef(ref: string): boolean {
  if (ref.startsWith(ATTACH_PREFIX)) return true;
  if (ref === "attach") return true;
  return false;
}

/**
 * Return the portion of a ref after the `attach/` prefix, or `null` if the ref
 * doesn't use the prefix.
 *
 * `splitAttachRef("attach/photo-001.jpg")` → `"photo-001.jpg"`
 * `splitAttachRef("attach/sub/scan.image.card")` → `"sub/scan.image.card"`
 * `splitAttachRef("_content/x.attach/y.jpg")` → `null` (mid-path occurrence is literal)
 */
export function splitAttachRef(ref: string): string | null {
  if (!isAttachRef(ref)) return null;
  if (ref === "attach") return "";
  return ref.slice(ATTACH_PREFIX.length);
}

/**
 * Resolve a ref value that uses the `attach/` prefix to a filesystem path
 * (in the same path-style as `cardPath`).
 *
 * `resolveAttachRef("inbox/Foo.image.card", "attach/photo-001.jpg")`
 *   → `"inbox/Foo.attach/photo-001.jpg"`
 *
 * Returns `null` if the ref doesn't use the prefix.
 */
export function resolveAttachRef(cardPath: string, ref: string): string | null {
  const rest = splitAttachRef(ref);
  if (rest === null) return null;
  if (rest === "") return attachDirFor(cardPath);
  return attachDirFor(cardPath) + "/" + rest;
}

/**
 * True when the given basename is exactly `attach` (no extension). Used by the
 * lint rule that forbids the literal name `attach` outside an attach scope.
 */
export function isLiteralAttachName(name: string): boolean {
  return name === "attach";
}

/**
 * True when the given basename ends with `.attach` (the suffix that marks a
 * card's attach scope).
 */
export function isAttachDirName(name: string): boolean {
  return name.endsWith(ATTACH_SUFFIX) && name.length > ATTACH_SUFFIX.length;
}

/**
 * If `dirName` is `<basename>.attach`, return `<basename>`. Otherwise null.
 */
export function attachDirOwnerBasename(dirName: string): string | null {
  if (!isAttachDirName(dirName)) return null;
  return dirName.slice(0, -ATTACH_SUFFIX.length);
}

/**
 * Test whether a path lies inside an attach scope — any descendant of a
 * `<basename>.attach/` directory.
 *
 * Used by lint rules: the exact-name `attach` ban only applies outside attach
 * scopes (attachments may have a subdirectory named `attach` if a user
 * really wants — unusual but not forbidden).
 */
export function isInsideAttachScope(relativePath: string): boolean {
  const segments = relativePath.split("/");
  for (const segment of segments) {
    if (isAttachDirName(segment)) return true;
  }
  return false;
}

function lastSegment(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

function dirSegment(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}
