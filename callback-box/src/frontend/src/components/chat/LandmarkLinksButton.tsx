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
import { trpc } from "../../lib/trpc";
import { Dropdown, useDropdownClose } from "../ui/Dropdown";

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
  const { data } = trpc.landmarks.forDir.useQuery(
    { dir: contextDir ?? "" },
    { enabled: contextDir !== null },
  );

  const landmark = data?.landmark ?? null;
  const links = landmark?.links ?? [];
  const groups = landmark?.groups ?? [];
  if (links.length === 0 && groups.length === 0) return null;

  const menuTitle = landmark?.label ? `${landmark.label} links` : "Landmark links";

  return (
    <Dropdown
      align="right"
      width="w-[24rem]"
      trigger={({ toggle, ariaProps }) => (
        <button
          type="button"
          onClick={toggle}
          className="p-1.5 rounded hover:bg-white/20 text-white/80 hover:text-white"
          title={menuTitle}
          {...ariaProps}
        >
          <BookmarkIcon />
        </button>
      )}
    >
      <div className="px-3 py-2 border-b border-warm-200 text-xs text-warm-500 font-medium uppercase tracking-wide">
        {menuTitle}
      </div>
      <div className="py-1">
        {links.map((link) => (
          <MenuLink key={link.ref} link={link} onPanel={onPanel} />
        ))}
        {groups.map((group) => (
          <MenuGroup key={group.label} group={group} onPanel={onPanel} />
        ))}
      </div>
    </Dropdown>
  );
}

function MenuLink({ link, onPanel }: { link: ResolvedLink; onPanel: (link: ResolvedLink) => void }) {
  const close = useDropdownClose();
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => { close(); onPanel(link); }}
      className="w-full text-left px-3 py-2 hover:bg-warm-100 flex items-center gap-2 text-warm-800"
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
        className="w-full text-left px-3 py-2 hover:bg-warm-100 flex items-center gap-2 text-warm-800"
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
