/**
 * The strip above the composer that holds attached images, files and
 * selections (`ChatAttachments.tsx`, `ChatSelections.tsx`), and the dark tag
 * that shows each item's token id.
 */

import type { ReactNode } from "react";

export function ComposerStrip({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2 px-3 py-2 border-t border-warm-300 bg-warm-100/70">{children}</div>;
}

/** The item's token id. `corner` lays it over the top-left corner of an image tile. */
export function TokenTag({ children, corner }: { children: ReactNode; corner?: boolean }) {
  return (
    <span
      className={`text-[0.625rem] font-mono bg-warm-800 text-white px-1 rounded flex-shrink-0${
        corner === true ? " absolute -top-1 left-0 pointer-events-none" : ""
      }`}
    >
      {children}
    </span>
  );
}
