/**
 * Landmark links + groups section of the context chip's menu — extracted
 * from the retired `LandmarkLinksButton` trigger (chunk 4 of
 * docs/plans/chat-header-chips.md). Owns the `trpc.landmarks.forDir` query.
 *
 * When the chat is scoped to a directory whose landmark carries
 * `navigation.links` (or `expand` fan-out), this surfaces those resolved
 * links as a curated bookmark list. Each item opens its target in the
 * companion sidebar (via `onPanel`) rather than navigating away.
 *
 * Three outcomes, each distinct (principle 4, resilient-and-never-silent):
 * a landmark with links renders them; a landmark with none (or no context at
 * all) renders nothing — the section is simply absent, but the chip and menu
 * around it remain; a query FAILURE renders an explicit "Couldn't load
 * landmark links" row, rather than being indistinguishable from "no links"
 * (the bug in the retired button).
 */

import { useState } from "react";
import { trpc } from "../../lib/trpc";
import { useDropdownClose } from "../ui/Dropdown";

interface ResolvedLink {
  ref: string;
  label: string | null;
  title: string;
  exists: boolean;
}

interface ResolvedGroup {
  label: string;
  children: ResolvedLink[];
  count: number;
}

interface LandmarkLinksPanelProps {
  /** Box-relative dir the chat is scoped to (`""` for root, null for none). */
  contextDir: string | null;
  /** Open a link's target in the companion pane. */
  onPanel: (link: ResolvedLink) => void;
}

export function LandmarkLinksPanel({ contextDir, onPanel }: LandmarkLinksPanelProps) {
  const { data, isError, error, refetch } = trpc.landmarks.forDir.useQuery(
    { dir: contextDir ?? "" },
    { enabled: contextDir !== null },
  );

  if (contextDir === null) return null;

  if (isError) {
    return (
      <div className="px-3 py-2 text-sm text-danger-dark">
        Couldn&rsquo;t load landmark links: {error.message}.{" "}
        <button id="bbx-landmark-links-retry" type="button" onClick={() => void refetch()} className="underline hover:no-underline">
          Retry
        </button>
      </div>
    );
  }

  const landmark = data?.landmark ?? null;
  const links = landmark?.links ?? [];
  const groups = landmark?.groups ?? [];
  if (links.length === 0 && groups.length === 0) return null;

  return (
    <div className="py-1">
      {links.map((link) => (
        <MenuLink key={link.ref} link={link} onPanel={onPanel} />
      ))}
      {groups.map((group) => (
        <MenuGroup key={group.label} group={group} onPanel={onPanel} />
      ))}
    </div>
  );
}

function MenuLink({ link, onPanel }: { link: ResolvedLink; onPanel: (link: ResolvedLink) => void }) {
  const close = useDropdownClose();
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => { close(); onPanel(link); }}
      className="w-full text-left px-3 py-3.5 hover:bg-warm-100 flex items-center gap-2 text-warm-800"
    >
      <span className="truncate">{link.label ?? link.title}</span>
      {!link.exists ? <span className="text-xs text-danger shrink-0">(missing)</span> : null}
    </button>
  );
}

function GroupChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function MenuGroup({ group, onPanel }: { group: ResolvedGroup; onPanel: (link: ResolvedLink) => void }) {
  const [open, setOpen] = useState(false);
  const overflow = group.count - group.children.length;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full text-left px-3 py-3.5 hover:bg-warm-100 flex items-center gap-2 text-warm-800"
      >
        <GroupChevron open={open} />
        <span className="truncate font-medium">{group.label}</span>
        <span className="text-xs text-warm-500 shrink-0 ml-auto">{group.count}</span>
      </button>
      {open ? (
        <div className="border-l border-warm-200 ml-5">
          {group.children.map((link) => (
            <MenuLink key={link.ref} link={link} onPanel={onPanel} />
          ))}
          {overflow > 0 ? (
            <div className="px-3 py-2 text-xs text-warm-500">+{overflow} more</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
