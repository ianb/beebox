/**
 * The disclosure chevron used by every inline expander on the Landmarks
 * page (link-cap "Show all", group submenus, "Show older" sessions) — one
 * affordance, so a section's collapsed parts read as one kind of thing.
 */

import { Text } from "../ui/Text";

export function ChevronIcon({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg
      className={`w-4 h-4 ${className === undefined ? "" : `${className} `}transition-transform ${open ? "rotate-90" : ""}`}
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

/**
 * The inline expander under a list on the Landmarks page ("Show all",
 * "Show older"): chevron, label, count.
 */
export function ExpanderButton({ open, onToggle, label, count }: { open: boolean; onToggle: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex items-center gap-2 self-start px-2 py-1 -mx-2 rounded text-left hover:bg-warm-100"
    >
      <ChevronIcon open={open} />
      <Text as="span" size="sm">{label}</Text>
      <Text as="span" size="xs" tone="muted">{count}</Text>
    </button>
  );
}
