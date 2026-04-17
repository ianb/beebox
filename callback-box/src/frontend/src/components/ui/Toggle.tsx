import { useId, type ReactNode } from "react";

export interface ToggleProps {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Secondary line under the label. */
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
  /** When true, the label sits to the right; otherwise the switch sits on the right. Default: switch-right. */
  labelPosition?: "left" | "right";
}

export function Toggle({
  label,
  checked,
  onChange,
  description,
  disabled = false,
  id,
  labelPosition = "left",
}: ToggleProps) {
  const autoId = useId();
  const fieldId = id !== undefined ? id : autoId;
  const descId = description !== undefined ? `${fieldId}-desc` : undefined;

  const trackClass = checked
    ? disabled
      ? "bg-plum/50"
      : "bg-plum"
    : disabled
      ? "bg-warm-200"
      : "bg-warm-300 hover:bg-warm-400";

  const thumbClass = checked ? "translate-x-5" : "translate-x-0.5";

  const switchEl = (
    <button
      type="button"
      role="switch"
      id={fieldId}
      aria-checked={checked}
      aria-describedby={descId}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold ${trackClass} ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform translate-y-0.5 ${thumbClass}`}
      />
    </button>
  );

  const labelEl = (
    <div className={disabled ? "opacity-60" : ""}>
      <label
        htmlFor={fieldId}
        className={`text-sm font-medium text-warm-800 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
      >
        {label}
      </label>
      {description !== undefined ? (
        <div id={descId} className="text-xs text-warm-500 mt-0.5">{description}</div>
      ) : null}
    </div>
  );

  return (
    <div className="flex items-start gap-3">
      {labelPosition === "left" ? (
        <>
          <div className="flex-1">{labelEl}</div>
          {switchEl}
        </>
      ) : (
        <>
          {switchEl}
          <div className="flex-1">{labelEl}</div>
        </>
      )}
    </div>
  );
}
