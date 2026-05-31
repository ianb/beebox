import { useId, type ReactNode } from "react";

export interface RadioOption {
  value: string;
  label: ReactNode;
  /** Shown below the label in the "cards" variant (ignored in "list"). */
  description?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  options: RadioOption[];
  /** Shared name attribute for all radios. Auto-generated if omitted. */
  name?: string;
  variant?: "list" | "cards";
  error?: ReactNode;
  helper?: ReactNode;
  required?: boolean;
  id?: string;
  disabled?: boolean;
  /** Outer-layout classes on the group wrapper (margin, padding, flex item, sizing, position). */
  className?: string;
}

export function RadioGroup({
  label,
  value,
  onChange,
  options,
  name,
  variant,
  error,
  helper,
  required,
  id,
  disabled,
  className,
}: RadioGroupProps) {
  variant = variant ?? "list";
  required = required ?? false;
  disabled = disabled ?? false;
  const autoId = useId();
  const groupId = id !== undefined ? id : autoId;
  const groupName = name !== undefined ? name : groupId;
  const hasError = error !== undefined;

  return (
    <div
      role="radiogroup"
      aria-labelledby={`${groupId}-label`}
      aria-invalid={hasError ? true : undefined}
      aria-required={required ? true : undefined}
      className={className}
    >
      <div id={`${groupId}-label`} className="block text-sm font-medium text-warm-700 mb-1">
        {label}
        {required ? <span className="text-danger ml-0.5" aria-hidden="true">*</span> : null}
      </div>
      {variant === "list" ? (
        <RadioList name={groupName} value={value} options={options} disabled={disabled} onChange={onChange} />
      ) : (
        <RadioCards name={groupName} value={value} options={options} disabled={disabled} onChange={onChange} />
      )}
      {error !== undefined ? (
        <div className="text-danger-dark text-sm mt-1" role="alert">{error}</div>
      ) : helper !== undefined ? (
        <div className="text-xs text-warm-500 mt-1">{helper}</div>
      ) : null}
    </div>
  );
}

interface RadioInternalProps {
  name: string;
  value: string;
  options: RadioOption[];
  disabled: boolean;
  onChange: (value: string) => void;
}

function RadioList({ name, value, options, disabled, onChange }: RadioInternalProps) {
  return (
    <div className="space-y-2">
      {options.map((opt) => {
        const isDisabled = disabled || opt.disabled === true;
        const labelClass = isDisabled
          ? "flex items-center gap-2 text-sm text-warm-500 opacity-70"
          : "flex items-center gap-2 text-sm text-warm-800 cursor-pointer";
        return (
          <label key={opt.value} className={labelClass}>
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
              disabled={isDisabled}
              className="text-primary focus:ring-accent"
            />
            <span>{opt.label}</span>
          </label>
        );
      })}
    </div>
  );
}

function RadioCards({ name, value, options, disabled, onChange }: RadioInternalProps) {
  return (
    <div className="space-y-2">
      {options.map((opt) => {
        const isSelected = value === opt.value;
        const isDisabled = disabled || opt.disabled === true;
        const baseClass = "block p-3 border rounded transition-colors";
        const stateClass = isDisabled
          ? "border-warm-200 bg-warm-50 opacity-60 cursor-not-allowed"
          : isSelected
            ? "border-primary bg-info-50 cursor-pointer"
            : "border-warm-300 hover:border-warm-400 cursor-pointer";
        return (
          <label key={opt.value} className={`${baseClass} ${stateClass}`}>
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={isSelected}
              onChange={() => onChange(opt.value)}
              disabled={isDisabled}
              className="sr-only"
            />
            <div className="text-warm-900">{opt.label}</div>
            {opt.description !== undefined ? (
              <div className="text-xs text-warm-600 mt-1">{opt.description}</div>
            ) : null}
          </label>
        );
      })}
    </div>
  );
}
