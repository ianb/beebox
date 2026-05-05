/**
 * Two-column grid of landmark sections on desktop, single column on
 * mobile/tablet. Lives next to LandmarkSection because the page itself
 * can only use outer-layout classes via className.
 */

import type { ReactNode } from "react";

export function LandmarksGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{children}</div>
  );
}
