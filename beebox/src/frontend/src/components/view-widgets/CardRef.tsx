/**
 * <CardRef> — a styled reference to another card, with two controls on one
 * reference: **follow** (open in the current surface) and **expand** (render the
 * card inline, in place). The styled chip *is* its compact form. An author can
 * fully replace the chip by passing a function-child `(resolved) => …`.
 *
 * Part of the public `beebox/view-widgets` set. Like CardLink, the card
 * reference prop is `cardRef` (React reserves `ref`). Both controls and the
 * inline render come from the view host, so behavior is surface-correct and the
 * same source works in the browser and the `bbx view check` node harness.
 */

import { useState, type ReactNode } from "react";
import { refWithQuery, useViewHost, type ResolvedRef } from "../../lib/view-host";
import { Badge } from "../ui/Badge";
import { InlineAction } from "../ui/InlineAction";
import { Text } from "../ui/Text";
import { MaterialContext } from "../ui/material";

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
  /**
   * Render the card frameless and inline, in place of the chip, as a Markdown
   * image embed does. `cardRef` stays a literal attribute, so `bbx mv` tracks it.
   */
  embed?: boolean;
  /** Text shown with an embedded card (the embed's caption). Only with `embed`. */
  caption?: string;
}

export function CardRef({ cardRef, view, params, children, embed, caption }: CardRefProps) {
  const host = useViewHost();
  const resolved = host.useResolvedRef(cardRef);
  const [expanded, setExpanded] = useState(false);
  const inlineRef = refWithQuery(cardRef, {
    ...(view === undefined ? {} : { view }),
    ...(params === undefined ? {} : { params }),
  });

  if (embed === true) {
    return (
      <div data-card-embed="" className="contents">
        {host.renderInline(inlineRef, caption === undefined || caption === "" ? undefined : { caption })}
      </div>
    );
  }

  if (typeof children === "function") {
    return <>{children(resolved)}</>;
  }

  const title = resolved?.title ?? cardRef;
  const missing = resolved !== null && !resolved.exists;

  return (
    // A white app panel: its text keeps app ink, and the card it embeds sets its own.
    <MaterialContext.Provider value={false}>
    <div className="my-2 rounded-lg border border-warm-200 bg-white">
      <div className="flex items-center gap-2 px-3 py-2">
        <Text weight="medium" truncate className="min-w-0 flex-1">{title}</Text>
        {resolved?.type ? <Badge tone="info" size="sm">{resolved.type}</Badge> : null}
        {missing ? <Badge tone="danger" size="sm">missing</Badge> : null}
        <InlineAction onClick={() => host.openCard(cardRef, { label: title, viewer: view ?? null, params })} className="shrink-0 text-sm">
          Open
        </InlineAction>
        <InlineAction intent="subtle" onClick={() => setExpanded((x) => !x)} expanded={expanded} className="shrink-0 text-sm">
          {expanded ? "Collapse" : "Expand"}
        </InlineAction>
      </div>
      {expanded ? (
        <div className="border-t border-warm-200 p-3">{host.renderInline(inlineRef)}</div>
      ) : null}
    </div>
    </MaterialContext.Provider>
  );
}
