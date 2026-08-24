import { cn } from "../../lib/cn";

export interface MobileBackButtonProps {
  label: string;
  onClick: () => void;
  /** DOM id. Set it to publish a `cb-` control address (docs/plans/agent-points-at-ui.md). */
  id?: string;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
}

/**
 * Back-navigation button used at the top of the detail pane in mobile
 * two-pane layouts. Hidden at sm+ breakpoints where both panes are visible.
 */
export function MobileBackButton({ label, onClick, id, className }: MobileBackButtonProps) {
  const classes = cn(
    "sm:hidden flex items-center gap-1 px-3 py-2 text-sm text-primary hover:text-primary-dark border-b border-warm-200",
    className,
  );
  return (
    <button type="button" id={id} onClick={onClick} className={classes}>
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
      {label}
    </button>
  );
}
