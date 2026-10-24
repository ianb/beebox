/**
 * The app bar's row, apart from its queries so the theme studio renders the
 * same row with fixed members (see `AppNav/nav.tsx`). The place pill sits
 * left and yields width; the right group is `shrink-0`.
 */

import type { ReactNode } from "react";

/** The `.bbx-app-nav` bar: `pill` on the left, `children` in the right group. */
export function AppNavFace({ pill, children }: { pill: ReactNode; children: ReactNode }) {
  return (
    <nav aria-label="Primary" className="bbx-app-nav bg-gradient-to-r from-info-dark via-primary to-coral text-white flex-shrink-0 shadow-sm print:hidden">
      <div className="flex items-center gap-2 px-3 sm:px-4 py-1.5 text-sm">
        {pill}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {children}
        </div>
      </div>
    </nav>
  );
}
