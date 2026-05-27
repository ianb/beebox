import type { ReactNode } from "react";

/**
 * Dark full-bleed shell for the capture page. Wraps children in the
 * black-background column that distinguishes this view from the rest of
 * the app — intentionally outside the warm/primary palette.
 */
export function CaptureShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col h-full bg-black relative text-white">
      <h1 className="sr-only">Capture</h1>
      {children}
    </div>
  );
}
