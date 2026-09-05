/**
 * Box paths come in two forms, and conflating them caused a class of bugs
 * (e.g. a card opened in the companion pane silently stopped live-updating):
 *
 *  - **Authoring / ref form** — used in card bodies, agent output, and `view:`
 *    links. A leading slash like `/_bookkeeping/archive/Foo.card` means
 *    "box-root-absolute"; a bare `foo.md` is document-relative (resolved
 *    against the containing card's directory). The leading slash is meaningful
 *    HERE, and resolving the relative case is `resolveRelativePath`'s job.
 *
 *  - **Internal box-relative form** — `_bookkeeping/archive/Foo.card`: no leading
 *    slash, forward slashes. This is what the file watcher emits
 *    (`path.relative(boxRoot, …)`), what the `/api/files`, `card.get`, and
 *    `status.browse` boundaries expect, what `ViewTarget.path` is, and what
 *    `file-change` events are compared against for equality.
 *
 * `boxRelativePath` converts the absolute-ref form (or an already-relative
 * path) into the canonical internal form by stripping leading slashes. Use it
 * at **emit** boundaries to PRODUCE the canonical form, and at **consume**
 * boundaries to TOLERATE either form before comparing or looking up (Postel's
 * law). It deliberately does no document-relative resolution — that's a
 * different concern owned by `resolveRelativePath`.
 */
export function boxRelativePath(path: string): string {
  return path.replace(/^\/+/, "");
}
