/**
 * The rounded status line above the composer: a running background task
 * (`BackgroundTasks.tsx`) or a screenshot just added to the chat
 * (`ScreenshotIndicatorStrip.tsx`).
 */

import type { ReactNode } from "react";

export function StatusPill({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-xs text-warm-700 bg-warm-50 border border-warm-200 rounded-full px-3 py-1">
      {children}
    </div>
  );
}
