/**
 * Briefing body-tag components: `{% purpose %}` and `{% correction %}` —
 * the free-text material. Each renders as a compact styled block; the
 * backend `compileBriefing` emitter produces the parallel `**Label:** …`
 * markdown that lands in the @-included CLAUDE.md slice.
 *
 * The structured records (key-people, properties) live in briefing
 * frontmatter and render via the default card viewer's field table, not
 * here.
 *
 * Tags shipped here are intentionally minimal — small label + content,
 * subtle border accent. Briefings are reference material; ostentatious
 * styling would compete with the actual prose.
 */

import type { ReactNode } from "react";

function LabeledBlock({
  label,
  meta,
  children,
}: {
  label: string;
  meta?: ReactNode;
  children?: ReactNode;
}): ReactNode {
  return (
    <div className="my-2">
      <span className="text-warm-500 text-xs font-medium uppercase tracking-wide">
        {label}
      </span>
      {meta !== undefined ? <span className="text-warm-500 text-xs ml-1">{meta}</span> : null}
      <div className="text-warm-800 [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
        {children}
      </div>
    </div>
  );
}

export function makeBriefingComponents() {
  function Purpose({ children }: { children?: ReactNode }) {
    return <LabeledBlock label="Purpose">{children}</LabeledBlock>;
  }

  function Correction({
    test,
    children,
  }: {
    test?: string;
    children?: ReactNode;
  }) {
    const meta = test !== undefined && test !== ""
      ? <span className="italic">test: {test}</span>
      : undefined;
    return <LabeledBlock label="Correction" meta={meta}>{children}</LabeledBlock>;
  }

  return { Purpose, Correction };
}
