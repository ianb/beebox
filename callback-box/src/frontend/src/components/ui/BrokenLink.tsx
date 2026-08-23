import type { ReactNode } from "react";

/**
 * A link that leads nowhere: a retired `view:` link (removable once all
 * controlled boxes are migrated off the scheme), a path that escapes the box
 * root, or a `control:` pointer whose control is not on this screen. Renders as
 * a visibly-disabled marker with the reason in its tooltip, so the content reads
 * as broken-on-sight rather than as a silently-inert `<a href="view:…">` or a
 * link to some other file.
 *
 * Shared rather than private to `Markdown.tsx` because `ControlPointer` needs
 * the same treatment for a *live* failure — the same link is fine while the
 * control is mounted and broken after the user navigates away.
 */
export function BrokenLink({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <span className="cursor-not-allowed text-danger-dark line-through decoration-dotted opacity-80" title={title}>
      {children}
    </span>
  );
}
