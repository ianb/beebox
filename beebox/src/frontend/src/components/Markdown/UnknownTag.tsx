/**
 * Fallback for a tag the active table does not know: the authored opening
 * tag as muted code, then the children. Nothing the author wrote disappears.
 * See `rewriteUnknownTags` in `shared/markdoc-config/scoped.ts`.
 */

import type { ReactNode } from "react";
import { isRecord } from "@shared/is-record";

function authoredOpening(name: string, attrs: string): string {
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(attrs);
  } catch (_e) {
    parsed = {};
  }
  const pairs = isRecord(parsed)
    ? Object.entries(parsed).map(([key, value]) => ` ${key}=${JSON.stringify(value)}`)
    : [];
  return `{% ${name}${pairs.join("")} %}`;
}

interface UnknownTagProps {
  name?: string;
  attrs?: string;
  children?: ReactNode;
}

function Opening({ name, attrs }: UnknownTagProps) {
  return <code className="text-warm-500 text-xs">{authoredOpening(name ?? "", attrs ?? "{}")}</code>;
}

export function UnknownTagInline(props: UnknownTagProps) {
  return (
    <span>
      <Opening {...props} />
      {props.children}
    </span>
  );
}

export function UnknownTagBlock(props: UnknownTagProps) {
  return (
    <div>
      <Opening {...props} />
      {props.children}
    </div>
  );
}
