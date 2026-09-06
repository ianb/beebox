/**
 * The one-line marker a file view shows when what is on screen is a previous
 * load and the newest refresh failed.
 *
 * It exists because the alternative to showing the old body is taking it away,
 * and the alternative to this marker is showing an out-of-date body as if it
 * were current — invisible degradation (engineering principle 4) and a control
 * wearing the wrong face (principle 13). The body stays; the marker says what
 * is true about it, and offers the one action that can change it.
 */

import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import type { LoadFailure } from "../lib/file-load-state";

export function FileStaleNotice({ failure, onRefresh }: { failure: LoadFailure; onRefresh: () => void }) {
  return (
    <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-accent/30 bg-accent-50 print:hidden">
      <Badge tone="warning" size="sm">Not up to date</Badge>
      <span className="min-w-0 flex-1 truncate text-xs text-warm-700" title={failure.detail}>
        {failure.headline}
      </span>
      <Button intent="ghost" size="sm" onClick={onRefresh}>Refresh</Button>
    </div>
  );
}
