/**
 * See-also tag — nests inside `{% todo %}`, points at supporting context (a
 * person who offered to help, the thread this originated in, …).
 *
 * Renders footnote-style: a small, unobtrusive marker, not a block
 * interruption — the same shape regardless of `node.inline`, since a
 * footnote reads the same whether it sits on its own line or mid-sentence
 * (the Markdoc transform emits a single `SeeAlso` tag, unlike `quote`/
 * `source`'s Inline/Block split).
 *
 * Exactly one of `ref` (in-box, `bbx mv`-tracked) or `href` (external) is
 * required by the tag's `validate()` (`markdoc-config.ts`) — stricter than
 * `{% source %}`'s at-most-one, because a target-less see-also is
 * meaningless where a target-less source legitimately means "the
 * containing document." `ref` → `sourceRef` rename, same as `source`
 * (React reserves `ref`). Body text is the reason for the reference; shown
 * as the marker's title/tooltip.
 */

import { isValidElement, type ReactNode } from "react";
import { externalLabel, refLabel, refToViewTarget } from "../lib/ref-label";
import type { NavigateHint, ViewTarget } from "../lib/view-url";

export interface SeeAlsoLinkContext {
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  /** The host doc's path, so relative / `attach/` refs resolve correctly. */
  basePath: string | undefined;
}

/** Plain text of a React subtree — the see-also's reason. */
function flattenText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return flattenText(node.props.children);
  return "";
}

const MARKER_CLASS =
  "ml-1 align-middle text-xs not-italic text-warm-400 underline decoration-dotted underline-offset-2";

interface SeeAlsoProps {
  sourceRef?: string;
  href?: string;
  children?: ReactNode;
}

export function makeSeeAlsoComponent(linkCtx: SeeAlsoLinkContext): (props: SeeAlsoProps) => ReactNode {
  return function SeeAlso({ sourceRef, href, children }: SeeAlsoProps): ReactNode {
    const reason = flattenText(children).trim();
    if (sourceRef !== undefined && sourceRef !== "") {
      const label = refLabel(sourceRef);
      const title = reason === "" ? `See also: ${sourceRef}` : `${reason} — ${sourceRef}`;
      const target = refToViewTarget(sourceRef, linkCtx.basePath);
      // A ref that escapes the box root has nothing to open — mark it broken
      // (same shape as the missing-target case below) instead of rendering a
      // chip that navigates to a clamped-to-root file the ref never named.
      if (target === null) {
        return (
          <span title={`${title} — escapes the box root`} className={`${MARKER_CLASS} text-danger`}>
            [see also: {label} (unresolvable)]
          </span>
        );
      }
      return (
        <button
          type="button"
          onClick={() => linkCtx.onNavigate(target, { label })}
          title={title}
          className={`${MARKER_CLASS} cursor-pointer hover:text-warm-600`}
        >
          [see also: {label}]
        </button>
      );
    }
    if (href !== undefined && href !== "") {
      const label = externalLabel(href);
      const title = reason === "" ? href : `${reason} — ${href}`;
      return (
        <span title={title} className={MARKER_CLASS}>
          [see also ↗ {label}]
        </span>
      );
    }
    // Both ref and href absent is a validate() error
    // (`see-also-missing-target`) — never reaches transform in a validated
    // body. Render a visible marker rather than silently dropping content so
    // an unvalidated stray tag isn't invisible.
    return (
      <span title={reason === "" ? undefined : reason} className={`${MARKER_CLASS} text-danger`}>
        [see also: missing ref/href]
      </span>
    );
  };
}
