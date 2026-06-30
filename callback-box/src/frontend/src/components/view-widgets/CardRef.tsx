/**
 * <CardRef> — a styled reference to another card, with two controls on one
 * reference: **follow** (open in the current surface) and **expand** (render the
 * card inline, in place). The styled chip *is* its compact form. An author can
 * fully replace the chip by passing a function-child `(resolved) => …`.
 *
 * Part of the public `callback-box/view-widgets` set. Like CardLink, the card
 * reference prop is `cardRef` (React reserves `ref`). Both controls and the
 * inline render come from the view host, so behavior is surface-correct and the
 * same source works in the browser and the `cb view test` node harness.
 */

import { useState, type ReactNode } from "react";
import { useViewHost, type ResolvedRef } from "../../lib/view-host";
import { Badge } from "../ui/Badge";
import { Text } from "../ui/Text";

type CardRefChild = ReactNode | ((resolved: ResolvedRef | null) => ReactNode);

export interface CardRefProps {
  /** Box-relative card path (box-absolute `/…`, relative, or `attach/…`). */
  cardRef: string;
  /** Optional `?view=` viewer override for the followed/expanded card. */
  view?: string;
  /** Optional extra query params. */
  params?: Record<string, string>;
  /**
   * A function-child replaces the default chip entirely, given the resolved
   * ref (null while loading). Non-function children are ignored — the chip is
   * self-contained.
   */
  children?: CardRefChild;
}

export function CardRef({ cardRef, view, params, children }: CardRefProps) {
  const host = useViewHost();
  const resolved = host.useResolvedRef(cardRef);
  const [expanded, setExpanded] = useState(false);

  if (typeof children === "function") {
    return <>{children(resolved)}</>;
  }

  const title = resolved?.title ?? cardRef;
  const missing = resolved !== null && !resolved.exists;

  return (
    <div className="my-2 rounded-lg border border-warm-200 bg-white">
      <div className="flex items-center gap-2 px-3 py-2">
        <Text weight="medium" truncate className="min-w-0 flex-1">{title}</Text>
        {resolved?.type ? <Badge tone="info" size="sm">{resolved.type}</Badge> : null}
        {missing ? <Badge tone="danger" size="sm">missing</Badge> : null}
        <button
          type="button"
          onClick={() => host.openCard(cardRef, { label: title, viewer: view ?? null, params })}
          className="shrink-0 text-sm text-primary hover:underline"
        >
          Open
        </button>
        <button
          type="button"
          onClick={() => setExpanded((x) => !x)}
          aria-expanded={expanded}
          className="shrink-0 text-sm text-warm-600 hover:text-warm-800"
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>
      {expanded ? (
        <div className="border-t border-warm-200 p-3">{host.renderInline(cardRef)}</div>
      ) : null}
    </div>
  );
}
