/**
 * Source tag — provenance for content that wasn't your own synthesis.
 *
 * `{% source ref="..." as="..." %}content{% /source %}` marks a span as
 * derived from somewhere. Distinct from `{% quote %}` (which marks
 * verbatim words from a person): `source` answers *where*, optionally
 * *how* it was derived. The two compose — a `{% source %}` wrapping a
 * `{% quote %}` reads as "verbatim words from there." Bare `{% source %}`
 * without an inner `{% quote %}` is paraphrased / summarized / inferred
 * content with a cited origin.
 *
 * Inline form: the wrapped span is rendered as-is followed by a small
 * citation chip `[→ Label]`. Block form: a styled figure with a caption
 * below. Click the chip / caption to navigate to the source via the
 * surrounding `onNavigate` context.
 *
 * Stale-ref behaviour: the chip always renders. If the target was
 * archived/renamed/deleted between when the ref was written and when
 * the doc is read, click navigates anyway — the router shows the
 * target's missing state. Future tweak after dogfooding if the silent
 * 404 feels invisible.
 *
 * Note on prop naming: the Markdoc-side attribute is `ref`, but React
 * reserves that name for forwarding refs to the DOM. The Markdoc
 * config's `source` transform renames it to `sourceRef` before
 * handing the tag to React.
 */

import type { ReactNode } from "react";
import type { NavigateHint, ViewTarget } from "../lib/view-url";

export interface SourceLinkContext {
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
}

/**
 * Derive a short human label from a ref path:
 *   `/box/inbox/Voice_2026-03-15.memo.card`     → "Voice 2026-03-15"
 *   `box/people/dana.person.card`               → "dana"
 *   `box/chats/Mar15.chat-thread.card#m12`      → "Mar15"
 *
 * Strips leading `/`, drops directory prefix, drops the
 * `.<type>.card` suffix, strips a trailing `#fragment`, then replaces
 * `_`/`-` with spaces. If anything goes empty along the way, falls
 * back to the original ref so the chip is never blank.
 */
function sourceLabel(sourceRef: string): string {
  if (sourceRef === "") return "(missing ref)";
  const noFrag = sourceRef.split("#")[0] ?? sourceRef;
  const noLead = noFrag.replace(/^\/+/, "");
  const basename = noLead.includes("/")
    ? noLead.slice(noLead.lastIndexOf("/") + 1)
    : noLead;
  const stripped = basename.replace(/\.[^.]+\.card$/, "");
  const humanised = stripped.replace(/[_-]+/g, " ").trim();
  return humanised === "" ? sourceRef : humanised;
}

/**
 * Resolve a ref to a `ViewTarget` for navigation. Mirrors the
 * absolute-vs-relative resolution rule used by cardworks' ref system:
 * leading `/` is box-root-absolute (strip the `/`); anything else is
 * already box-root-relative for navigation purposes. Fragments after
 * `#` are dropped from the path; the router doesn't take them today.
 */
function refToViewTarget(sourceRef: string): ViewTarget {
  const noFrag = sourceRef.split("#")[0] ?? sourceRef;
  const path = noFrag.replace(/^\/+/, "");
  return { path, viewer: null, params: {}, zoom: false };
}

function CitationChip({
  sourceRef,
  as,
  linkCtx,
}: {
  sourceRef: string;
  as: string | undefined;
  linkCtx: SourceLinkContext;
}): ReactNode {
  const label = sourceLabel(sourceRef);
  const title = as === undefined || as === ""
    ? `Source: ${sourceRef}`
    : `${as} — ${sourceRef}`;
  return (
    <button
      type="button"
      onClick={() => linkCtx.onNavigate(refToViewTarget(sourceRef), { label })}
      title={title}
      className="not-italic text-warm-500 hover:text-warm-700 underline-offset-2 hover:underline cursor-pointer text-xs ml-1"
    >
      [→ {label}{as !== undefined && as !== "" ? <span className="italic">{`: ${as}`}</span> : null}]
    </button>
  );
}

export function makeSourceComponents(linkCtx: SourceLinkContext): {
  SourceInline: (props: { sourceRef?: string; as?: string; children?: ReactNode }) => ReactNode;
  SourceBlock: (props: { sourceRef?: string; as?: string; children?: ReactNode }) => ReactNode;
} {
  function SourceInline({ sourceRef, as, children }: { sourceRef?: string; as?: string; children?: ReactNode }) {
    const refValue = sourceRef === undefined ? "" : sourceRef;
    return (
      <span data-source-ref={refValue}>
        {children}
        <CitationChip sourceRef={refValue} as={as} linkCtx={linkCtx} />
      </span>
    );
  }

  function SourceBlock({ sourceRef, as, children }: { sourceRef?: string; as?: string; children?: ReactNode }) {
    const refValue = sourceRef === undefined ? "" : sourceRef;
    return (
      <figure
        className="my-3 border-l-2 border-warm-300 bg-warm-50/50 pl-4 pr-3 py-2 rounded-r"
        data-source-ref={refValue}
      >
        <div className="text-warm-800 [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
          {children}
        </div>
        <figcaption className="text-xs text-warm-500 mt-1">
          <CitationChip sourceRef={refValue} as={as} linkCtx={linkCtx} />
        </figcaption>
      </figure>
    );
  }

  return { SourceInline, SourceBlock };
}
