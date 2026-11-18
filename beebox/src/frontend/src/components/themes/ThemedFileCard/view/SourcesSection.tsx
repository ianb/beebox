/**
 * The card header's Sources line (plan:card-source-chips): one chip per
 * `sources:` entry, on one line, with a toggle ("All N", or "Details" for one
 * source) that lists them with their notes. A file or card chip opens in the app; a web chip opens a new tab.
 * Properties still lists `sources` in its fields table.
 */

import { useState, type ReactNode } from "react";
import { Badge } from "../../../ui/Badge";
import { InlineAction } from "../../../ui/InlineAction";
import { List } from "../../../ui/List";
import { cardShowsSourcesSection, sourceChips, sourcesHaveDetails, type SourceChip } from "../../../../lib/source-chips";
import type { FileData } from "../../../../file-type-registry";
import type { NavigateHint, ViewTarget } from "../../../../lib/view-url";

type Navigate = (target: ViewTarget, hint?: NavigateHint) => void;

function FileIcon() {
  return (
    <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

/** The kind marker: the in-body citation chip's "→" for a card and "↗" for a web page. */
function KindMarker({ kind }: { kind: SourceChip["kind"] }): ReactNode {
  switch (kind) {
    case "file": return <FileIcon />;
    case "card": return <span aria-hidden="true">→</span>;
    case "web": return <span aria-hidden="true">↗</span>;
    case "text": return null;
  }
}

const frame = "inline-flex min-w-0 max-w-[min(16rem,100%)] rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** One source as a chip; a long name truncates, with the full text in the tooltip and in the expanded list. */
function Chip({ chip, onNavigate }: { chip: SourceChip; onNavigate: Navigate }): ReactNode {
  const badge = (
    <Badge material className="inline-flex max-w-full min-w-0 items-center gap-1">
      <KindMarker kind={chip.kind} />
      <span className="truncate group-hover:underline">{chip.text}</span>
    </Badge>
  );
  const { target } = chip;
  if (target !== null) {
    const open = () => { onNavigate(target, { label: chip.text }); };
    return <button type="button" onClick={open} title={chip.title} className={`group cursor-pointer ${frame}`}>{badge}</button>;
  }
  if (chip.href !== null) {
    return <a href={chip.href} target="_blank" rel="noreferrer" title={chip.title} className={`group ${frame}`}>{badge}</a>;
  }
  return <span title={chip.title} className={frame}>{badge}</span>;
}

/** One expanded row: the chip, then where in the source and why it matters. */
function DetailRow({ chip, onNavigate }: { chip: SourceChip; onNavigate: Navigate }): ReactNode {
  return (
    <li className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <Chip chip={chip} onNavigate={onNavigate} />
      {chip.pos === null ? null : <span className="text-card-soft">{chip.pos}</span>}
      {chip.note === null ? null : <span className="min-w-0 text-card-soft [overflow-wrap:anywhere]">{chip.note}</span>}
    </li>
  );
}

export function SourcesSection({ chips, onNavigate }: { chips: readonly SourceChip[]; onNavigate: Navigate }): ReactNode {
  const [expanded, setExpanded] = useState(false);
  if (chips.length === 0) return null;
  const hasDetails = sourcesHaveDetails(chips);
  const toggle = hasDetails ? (
    <InlineAction intent="subtle" expanded={expanded} onClick={() => { setExpanded(!expanded); }} className="shrink-0">
      {expanded ? "Less" : chips.length > 1 ? `All ${String(chips.length)}` : "Details"}
    </InlineAction>
  ) : null;
  return (
    <section className="mt-2 min-w-0 text-xs" aria-label="Sources" data-card-section="sources">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 text-card-soft bbx-card-field-label">Sources</span>
        {/* One line: chips that do not fit wrap onto a second line, which is
            clipped, so a chip shows whole or not at all; the toggle names the total. */}
        {expanded ? null : <div className="flex h-6 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-2 overflow-hidden">
          {chips.map((chip, index) => <Chip key={index} chip={chip} onNavigate={onNavigate} />)}
        </div>}
        {toggle}
      </div>
      {expanded ? (
        <List gap="xs" className="mt-1.5 min-w-0">
          {chips.map((chip, index) => <DetailRow key={index} chip={chip} onNavigate={onNavigate} />)}
        </List>
      ) : null}
    </section>
  );
}

/** A card's Sources line, or nothing: no usable entry, or a type whose view draws its own (`cardShowsSourcesSection`). */
export function CardSources({ data, onNavigate }: { data: FileData; onNavigate: Navigate }): ReactNode {
  if (!cardShowsSourcesSection(data.type)) return null;
  return <SourcesSection chips={sourceChips(data.frontmatter?.sources, data.path)} onNavigate={onNavigate} />;
}
