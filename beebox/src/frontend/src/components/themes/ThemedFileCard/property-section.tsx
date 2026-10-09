import type { ReactNode } from "react";
import { useParams } from "@tanstack/react-router";
import { withBase } from "../../../api";
import { serializeViewUrl, type NavigateHint, type ViewTarget } from "../../../lib/view-url";
import { Button } from "../../ui/Button";

/** A link with a real href that opens its target through `onNavigate` on a plain click. */
export function PropertyLink({ target, hint, onNavigate, children }: {
  target: ViewTarget;
  hint?: NavigateHint | undefined;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  children: ReactNode;
}) {
  const { boxSlug } = useParams({ strict: false });
  return <a className="bbx-theme-link" href={withBase(`/${boxSlug}/views/${serializeViewUrl(target)}`)}
    onClick={(e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault(); onNavigate(target, hint);
    }}>{children}</a>;
}

/** A failed Properties query: what went wrong and a Retry. */
export function PropertyProblem({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div role="status" className="text-sm">
    <p>{message}</p>
    <Button size="sm" intent="ghost" onClick={onRetry}>Retry</Button>
  </div>;
}
