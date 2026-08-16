/**
 * Source tag — provenance for content that wasn't your own synthesis.
 *
 * `{% source ref="..." usage="..." %}content{% /source %}` marks a span as
 * from somewhere. Distinct from `{% quote %}` (which marks the *user's own*
 * verbatim words): `source` answers *where*, optionally *how* it was
 * derived. The two compose — a `{% source %}` wrapping a `{% quote %}`
 * reads as "the user's verbatim words, from there." A bare `{% source %}`
 * (no inner `{% quote %}`) holds content *from* the source in its body — a
 * verbatim excerpt (e.g. a commentary anchor), a paraphrase, or a summary,
 * per `usage`.
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

import { isValidElement, type ReactNode } from "react";
import { externalLabel, refLabel, refToViewTarget } from "../lib/ref-label";
import type { NavigateHint, ViewTarget } from "../lib/view-url";

export interface SourceLinkContext {
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  /** The host doc's path, so relative / `attach/` refs resolve correctly. */
  basePath: string | undefined;
  /**
   * Optional: jump to this source's verbatim span in a sibling pane (the saved
   * page beside a commentary). Returns true if it scrolled there; false → fall
   * back to navigating to the target doc.
   */
  onJumpToQuote: ((quoteText: string) => Promise<boolean>) | undefined;
}

/** Plain text of a React subtree — the verbatim words inside a {% quote %}. */
function flattenText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return flattenText(node.props.children);
  return "";
}

/** Box-ref citation: a clickable chip that navigates to the in-box target. */
function CitationChip({
  sourceRef,
  usage,
  quoteText,
  linkCtx,
}: {
  sourceRef: string;
  usage: string | undefined;
  quoteText: string;
  linkCtx: SourceLinkContext;
}): ReactNode {
  const label = refLabel(sourceRef);
  const title = usage === undefined || usage === ""
    ? `Source: ${sourceRef}`
    : `${usage} — ${sourceRef}`;
  const target = refToViewTarget(sourceRef, linkCtx.basePath);
  // A ref that escapes the box root points at no in-box document. Render the
  // citation as an inert, visibly-broken marker rather than a chip that opens
  // whatever a clamped-to-root path happened to hit.
  if (target === null) {
    return (
      <span title={`${title} — escapes the box root`} className="not-italic text-danger text-xs ml-1">
        [→ {label} (unresolvable)]
      </span>
    );
  }
  const navigate = (): void => linkCtx.onNavigate(target, { label });
  // Prefer jumping to the verbatim span in the sibling pane (commentary →
  // saved page); fall back to navigating to the target doc when there's no
  // jump handler or the text isn't found there.
  const handleClick = (): void => {
    const jump = linkCtx.onJumpToQuote;
    if (jump !== undefined && quoteText !== "") {
      void jump(quoteText).then((handled) => {
        if (!handled) navigate();
      });
      return;
    }
    navigate();
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      title={title}
      className="not-italic text-warm-500 hover:text-warm-700 underline-offset-2 hover:underline cursor-pointer text-xs ml-1"
    >
      [→ {label}{usage !== undefined && usage !== "" ? <span className="italic">{`: ${usage}`}</span> : null}]
    </button>
  );
}

/**
 * Container citation: a ref-free anchor targets the *containing document* (the
 * page that owns this commentary's attach scope). There's no separate doc to
 * navigate to — clicking only jumps to the verbatim span in the page body.
 */
function ContainerChip({
  quoteText,
  linkCtx,
}: {
  quoteText: string;
  linkCtx: SourceLinkContext;
}): ReactNode {
  const handleClick = (): void => {
    const jump = linkCtx.onJumpToQuote;
    if (jump !== undefined && quoteText !== "") void jump(quoteText);
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      title="Jump to this passage on the page"
      className="not-italic text-warm-500 hover:text-warm-700 underline-offset-2 hover:underline cursor-pointer text-xs ml-1"
    >
      [→]
    </button>
  );
}

/** External (href) citation: a static chip — the target lives outside the box. */
function ExternalChip({ href, version }: { href: string; version: string | undefined }): ReactNode {
  const title = version === undefined || version === "" ? href : `${href} @ ${version}`;
  return (
    <span className="not-italic text-warm-500 text-xs ml-1" title={title}>
      [↗ {externalLabel(href)}]
    </span>
  );
}

interface SourceProps {
  sourceRef?: string;
  href?: string;
  usage?: string;
  version?: string;
  pos?: string;
  placement?: string;
  children?: ReactNode;
}

export function makeSourceComponents(linkCtx: SourceLinkContext): {
  SourceInline: (props: SourceProps) => ReactNode;
  SourceBlock: (props: SourceProps) => ReactNode;
} {
  function Citation({ sourceRef, href, usage, version, children }: SourceProps): ReactNode {
    const quoteText = flattenText(children);
    if (sourceRef !== undefined && sourceRef !== "") {
      return <CitationChip sourceRef={sourceRef} usage={usage} quoteText={quoteText} linkCtx={linkCtx} />;
    }
    if (href !== undefined && href !== "") {
      return <ExternalChip href={href} version={version} />;
    }
    return <ContainerChip quoteText={quoteText} linkCtx={linkCtx} />;
  }

  function SourceInline(props: SourceProps) {
    const refValue = props.sourceRef === undefined ? "" : props.sourceRef;
    return (
      <span data-source-ref={refValue} data-source-href={props.href}>
        {props.children}
        <Citation {...props} />
      </span>
    );
  }

  function SourceBlock(props: SourceProps) {
    const refValue = props.sourceRef === undefined ? "" : props.sourceRef;
    return (
      <figure
        className="my-3 border-l-2 border-warm-300 bg-warm-50/50 pl-4 pr-3 py-2 rounded-r"
        data-source-ref={refValue}
        data-source-href={props.href}
      >
        <div className="text-warm-800 [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
          {props.children}
        </div>
        <figcaption className="text-xs text-warm-500 mt-1">
          <Citation {...props} />
        </figcaption>
      </figure>
    );
  }

  return { SourceInline, SourceBlock };
}
