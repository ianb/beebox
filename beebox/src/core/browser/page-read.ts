/**
 * Reading the whole page from the box browser for `bbx webpage --browser`
 * (docs/plans/webpage-capture-tools.md, Track C).
 *
 * One evaluation returns the URL and the HTML, so they always come from one
 * page, even with a person using the browser. Script elements are left out:
 * they are the bulk of a modern page, and neither the text nor the saved HTML
 * needs them.
 */

import { z } from "zod";

export const PAGE_READ_ARGS = [
  "eval",
  "(()=>{const c=document.documentElement.cloneNode(true);for(const e of c.querySelectorAll('script'))e.remove();return JSON.stringify({url:location.href,html:'<!DOCTYPE html>'+c.outerHTML})})()",
];

export const PAGE_READ = z.object({ url: z.string(), html: z.string() });
export type PageRead = z.infer<typeof PAGE_READ>;

/** The page in `eval`'s output, or null for output that is cut off or not this shape. */
export function parsePageRead(stdout: string): PageRead | null {
  try {
    const outer: unknown = JSON.parse(stdout);
    if (typeof outer !== "string") return null;
    const page = PAGE_READ.safeParse(JSON.parse(outer));
    return page.success ? page.data : null;
  } catch (_e) {
    return null;
  }
}
