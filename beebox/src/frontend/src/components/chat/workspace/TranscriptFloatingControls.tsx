import { createContext, useContext, type ReactNode } from "react";

const RestoreSlot = createContext(false);
/** One scroller coordinates its restore button and message-local speech menus. */
export function TranscriptFloatingControls({ restore, children }: { restore: ReactNode; children: ReactNode }) {
  return <RestoreSlot.Provider value={Boolean(restore)}>
    <div className="relative flex flex-col flex-1 min-h-0 min-w-0">
      {restore ? <div className="absolute right-3 top-2 z-20 pointer-events-none"><div className="pointer-events-auto">{restore}</div></div> : null}
      {children}
    </div>
  </RestoreSlot.Provider>;
}
export function useSpeechRestoreSlot() { return useContext(RestoreSlot); }
