/**
 * Bring a `ViewTarget.fragment` into view once the file view has rendered it.
 *
 * `FileView` calls this for every renderer, so any view that renders the card
 * body (or a markdown file) through the shared Markdown renderer gets section
 * jumps with no per-view code (`lib/fragment-target.ts` resolves by DOM id
 * and heading `data-line`).
 *
 * Renderers load lazily behind their own Suspense fallback, so the headings
 * may appear after the data does. The hook tries at once, then on each DOM
 * change under the root, and gives up after `WAIT_MS`. It makes one attempt
 * per fragment value: a live edit of the card never scrolls the reader, and
 * re-picking the same section while the tab already holds it does not jump
 * again (accepted; a different fragment, or a fresh mount, does).
 *
 * Returns whether the last attempt missed, for the view's one-line notice.
 */

import { useEffect, useState } from "react";
import { resolveFragment, type FragmentResolution } from "../lib/fragment-target";

const WAIT_MS = 2000;

export function useFragmentJump({ root, fragment, source, path }: {
  /** The view's fragment root element (`data-fragment-root`), once mounted. */
  root: HTMLElement | null;
  /** Undefined: nothing to jump to. */
  fragment: string | undefined;
  /** The text the view renders (`FileData.body ?? FileData.content`); null until loaded. */
  source: string | null;
  path: string;
}): boolean {
  const [attempted, setAttempted] = useState<{ key: string; missed: boolean } | null>(null);
  const key = fragment === undefined ? null : `${path}#${fragment}`;

  useEffect(() => {
    // A plain open clears the fragment; picking the same section again then jumps again.
    if (key === null) {
      if (attempted !== null) setAttempted(null);
      return;
    }
    if (fragment === undefined || attempted?.key === key) return;
    if (root === null || source === null) return;
    const watch: { observer: MutationObserver | null; timer: number | undefined } = { observer: null, timer: undefined };
    const stop = (): void => {
      watch.observer?.disconnect();
      window.clearTimeout(watch.timer);
    };
    const finish = (result: FragmentResolution): void => {
      stop();
      if (result.kind === "element") result.element.scrollIntoView({ block: "start" });
      else if (result.kind === "top") root.scrollIntoView({ block: "start" });
      else console.warn(`[fragment] no section "${fragment}" in ${path} (${result.kind === "missing" ? "not in the source" : "nothing matched in time"})`);
      setAttempted({ key, missed: result.kind === "missing" || result.kind === "pending" });
    };
    const attempt = (final: boolean): boolean => {
      const result = resolveFragment(root, { fragment, source });
      if (result.kind === "pending" && !final) return false;
      finish(result);
      return true;
    };
    if (attempt(false)) return stop;
    watch.observer = new MutationObserver(() => { attempt(false); });
    watch.observer.observe(root, { childList: true, subtree: true });
    watch.timer = window.setTimeout(() => { attempt(true); }, WAIT_MS);
    return stop;
  }, [root, fragment, key, source, path, attempted]);

  return key !== null && attempted?.key === key && attempted.missed;
}
