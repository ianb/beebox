import { cn } from "../../lib/cn";

export interface ToggleProps {
  /** Current state. */
  checked: boolean;
  /** Stable `bbx-` control address for the rendered switch (see lib/ui-scan). */
  id?: string;
  /** Fires with the new desired state. */
  onChange: (checked: boolean) => void;
  /** Visually dim + block interaction (e.g. while a mutation is in flight). */
  disabled?: boolean;
  /**
   * Tooltip and accessible name: the setting the switch controls, the same
   * text in both states ("Raw listing", not "Switch to raw"). The on/off
   * state is announced from `aria-checked`.
   */
  label: string;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
}

/**
 * iOS-style pill switch for immediate-apply settings (distinct from
 * CheckboxField, which is form-bound). Fires on every click; callers
 * drive the `checked` value.
 */
export function Toggle({ checked, id, onChange, disabled, label, className }: ToggleProps) {
  disabled = disabled ?? false;
  const classes = cn(
    // h-6 keeps the hit area at 24 px; the 20 px pill is the inner span.
    "group relative inline-flex h-6 w-9 shrink-0 items-center rounded-full -my-0.5",
    disabled ? "opacity-50" : "",
    className,
  );
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={classes}
    >
      <span
        aria-hidden="true"
        className={cn("absolute inset-x-0 top-0.5 h-5 rounded-full transition-colors", checked ? "bg-success" : "bg-warm-300")}
      />
      <span
        aria-hidden="true"
        className="relative inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
        style={{ transform: checked ? "translateX(18px)" : "translateX(2px)" }}
      />
    </button>
  );
}
