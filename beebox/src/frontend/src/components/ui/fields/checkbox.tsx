import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../../lib/cn";
import { FieldMessage, fieldMessageId, isShown, useFieldInk } from "./shell";

const CHECKBOX_CLASSES = "accent-primary disabled:cursor-not-allowed";

// ---------- CheckboxField ----------

type NativeCheckboxPassThrough = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "checked" | "onChange" | "id" | "className" | "type" | "children" | "value"
>;

export interface CheckboxFieldProps extends NativeCheckboxPassThrough {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: ReactNode;
  helper?: ReactNode;
  id?: string;
  /** Outer-layout classes on the field wrapper (margin, padding, flex item, sizing, position). */
  className?: string;
}

export function CheckboxField({
  label,
  checked,
  onChange,
  error,
  helper,
  id,
  required,
  disabled,
  className,
  ...rest
}: CheckboxFieldProps) {
  required = required ?? false;
  const autoId = useId();
  const fieldId = id !== undefined ? id : autoId;
  const hasError = isShown(error);
  const ink = useFieldInk();
  const labelClass = disabled === true
    ? `flex items-center gap-2 text-sm ${ink.label} opacity-50`
    : `flex items-center gap-2 text-sm ${ink.label} cursor-pointer`;
  return (
    <div className={className}>
      <label htmlFor={fieldId} className={labelClass}>
        <input
          id={fieldId}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          required={required}
          disabled={disabled}
          aria-invalid={hasError ? true : undefined}
          aria-describedby={fieldMessageId(fieldId, { error, helper })}
          className={CHECKBOX_CLASSES}
          {...rest}
        />
        <span className="min-w-0 flex-1">
          {label}
          {required ? <span className="text-danger ml-0.5" aria-hidden="true">*</span> : null}
        </span>
      </label>
      <FieldMessage fieldId={fieldId} error={error} helper={helper} />
    </div>
  );
}

// ---------- Checkbox ----------

/** A bare checkbox is named by its own label or by the text beside it, never by nothing. */
type CheckboxName =
  | { "aria-label": string; "aria-labelledby"?: never }
  | { "aria-labelledby": string; "aria-label"?: never };

export type CheckboxProps = CheckboxName & {
  checked: boolean;
  /** Omitted for a display-only marker, which then renders read-only. */
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  /** Outer-layout classes (margin, flex item, alignment). */
  className?: string;
};

/**
 * A checkbox with no label wrapper, for a row whose own text names it (a todo)
 * or a display-only marker (a Markdown task). A form option is `CheckboxField`.
 */
export function Checkbox({ checked, onChange, disabled, id, className, ...name }: CheckboxProps) {
  return (
    <input
      id={id}
      type="checkbox"
      checked={checked}
      onChange={onChange === undefined ? undefined : (e) => onChange(e.target.checked)}
      readOnly={onChange === undefined}
      disabled={disabled}
      className={cn(CHECKBOX_CLASSES, className)}
      {...name}
    />
  );
}
