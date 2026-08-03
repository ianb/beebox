/**
 * The disclosure chevron used by every inline expander on the Landmarks
 * page (link-cap "Show all", group submenus, "Show older" sessions) — one
 * affordance, so a section's collapsed parts read as one kind of thing.
 */

export function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 transition-transform ${open ? "rotate-90" : ""}`}
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
