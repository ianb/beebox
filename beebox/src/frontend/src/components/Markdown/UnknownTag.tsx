/**
 * Fallback for a tag the active table does not know: the authored opening
 * tag as muted code, then the children. Nothing the author wrote disappears.
 * See `rewriteUnknownTags` in `shared/markdoc-config/scoped.ts`.
 */

import type { ReactNode } from "react";

function authoredOpening(name: string, attrs: string): string {
  return `{% ${name}${attrs} %}`;
}

interface UnknownTagProps {
  name?: string;
  attrs?: string;
  children?: ReactNode;
}

function Opening({ name, attrs }: UnknownTagProps) {
  return <code className="text-warm-700 text-xs">{authoredOpening(name ?? "", attrs ?? "")}</code>;
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
