/**
 * Landmark-links dropdown button in the chat header.
 *
 * When the chat is scoped to a directory whose landmark carries
 * `navigation.links` (or `expand` fan-out), this surfaces those resolved
 * links as a curated bookmark menu. Each item opens its target in the
 * companion sidebar (via `onPanel`) rather than navigating away. Hidden
 * entirely when the scope has no landmark, or a landmark with no links.
 */

import { useState } from "react";
import { trpc } from "../lib/trpc";

interface ResolvedLink {
  ref: string;
  label: string | null;
  title: string;
  exists: boolean;
}

interface LandmarkLinksButtonProps {
  /** Box-relative dir the chat is scoped to (`""` for root, null for none). */
  contextDir: string | null;
  /** Open a link's target in the companion pane. */
  onPanel: (link: ResolvedLink) => void;
}

function BookmarkIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
    </svg>
  );
}

export function LandmarkLinksButton({ contextDir, onPanel }: LandmarkLinksButtonProps) {
  const [open, setOpen] = useState(false);
  const { data } = trpc.landmarks.forDir.useQuery(
    { dir: contextDir ?? "" },
    { enabled: contextDir !== null },
  );

  const landmark = data?.landmark ?? null;
  const links = landmark?.links ?? [];
  if (links.length === 0) return null;

  const menuTitle = landmark?.label ? `${landmark.label} links` : "Landmark links";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="p-1.5 rounded hover:bg-white/20 text-white/80 hover:text-white"
        title={menuTitle}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <BookmarkIcon />
      </button>
      {open ? (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            role="menu"
            className="absolute top-full right-0 mt-1 w-[min(24rem,calc(100vw-2rem))] max-h-[70vh] overflow-auto bg-white rounded-lg shadow-lg border border-warm-200 z-50 text-sm"
          >
            <div className="px-3 py-2 border-b border-warm-200 text-xs text-warm-500 font-medium uppercase tracking-wide">
              {menuTitle}
            </div>
            <div className="py-1">
              {links.map((link) => (
                <button
                  key={link.ref}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onPanel(link);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-warm-100 flex items-center gap-2 text-warm-800"
                >
                  <span className="truncate">{link.label ?? link.title}</span>
                  {!link.exists ? (
                    <span className="text-xs text-danger shrink-0">(missing)</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
