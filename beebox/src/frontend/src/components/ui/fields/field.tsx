import { useId, useState, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "../../../lib/cn";
import { RevealButton } from "./reveal-button";
import { FieldMessage, FieldShell, fieldMessageId, inputClasses, isShown, useFieldInk } from "./shell";

export { RadioGroup } from "./radio";
export type { RadioOption, RadioGroupProps } from "./radio";

// ---------- TextField ----------

type NativeInputPassThrough = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "id" | "className" | "type" | "children"
>;

export interface TextFieldProps extends NativeInputPassThrough {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "password" | "url" | "tel" | "search";
  error?: ReactNode;
  helper?: ReactNode;
  id?: string;
  inputClassName?: string;
  inputRef?: Ref<HTMLInputElement>;
  /** Outer-layout classes on the field wrapper (margin, padding, flex item, sizing, position). */
  className?: string;
  /** When true, the label is visually hidden but remains for screen readers. */
  hideLabel?: boolean;
  /**
   * The value is an identifier (hostname, id, URL, name), not prose: turns off
   * spellcheck, autocorrect, and automatic capitalization, which mangle it on
   * a phone keyboard.
   */
  identifier?: boolean;
  /** With `type="password"`, adds a "Show password" button that reveals the text. */
  revealable?: boolean;
}

export function TextField({
  label,
  value,
  onChange,
  type,
  error,
  helper,
  id,
  inputClassName,
  inputRef,
  className,
  required,
  hideLabel,
  identifier,
  revealable,
  ...rest
}: TextFieldProps) {
  type = type ?? "text";
  required = required ?? false;
  hideLabel = hideLabel ?? false;
  const autoId = useId();
  const fieldId = id !== undefined ? id : autoId;
  const hasError = isShown(error);
  const [revealed, setRevealed] = useState(false);
  const canReveal = revealable === true && type === "password";
  const identifierProps = identifier === true ? { spellCheck: false, autoCapitalize: "none", autoCorrect: "off" } : {};
  const input = (
    <input
      id={fieldId}
      ref={inputRef}
      type={canReveal && revealed ? "text" : type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      aria-invalid={hasError ? true : undefined}
      aria-describedby={fieldMessageId(fieldId, { error, helper })}
      className={inputClasses(hasError, canReveal ? cn("pr-10", inputClassName) : inputClassName)}
      {...identifierProps}
      {...rest}
    />
  );
  return (
    <FieldShell id={fieldId} label={label} hideLabel={hideLabel} required={required} error={error} helper={helper} className={className}>
      {canReveal ? (
        <div className="relative">
          {input}
          <RevealButton id={`${fieldId}-reveal`} revealed={revealed} onToggle={() => setRevealed((shown) => !shown)} />
        </div>
      ) : (
        input
      )}
    </FieldShell>
  );
}

// ---------- TextareaField ----------

type NativeTextareaPassThrough = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange" | "id" | "className" | "children"
>;

export interface TextareaFieldProps extends NativeTextareaPassThrough {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  error?: ReactNode;
  helper?: ReactNode;
  id?: string;
  inputClassName?: string;
  /** Outer-layout classes on the field wrapper (margin, padding, flex item, sizing, position). */
  className?: string;
  hideLabel?: boolean;
}

export function TextareaField({
  label,
  value,
  onChange,
  error,
  helper,
  id,
  inputClassName,
  className,
  required,
  rows,
  hideLabel,
  ...rest
}: TextareaFieldProps) {
  required = required ?? false;
  rows = rows ?? 4;
  hideLabel = hideLabel ?? false;
  const autoId = useId();
  const fieldId = id !== undefined ? id : autoId;
  const hasError = isShown(error);
  return (
    <FieldShell id={fieldId} label={label} hideLabel={hideLabel} required={required} error={error} helper={helper} className={className}>
      <textarea
        id={fieldId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        rows={rows}
        aria-invalid={hasError ? true : undefined}
        aria-describedby={fieldMessageId(fieldId, { error, helper })}
        className={inputClasses(hasError, inputClassName)}
        {...rest}
      />
    </FieldShell>
  );
}

// ---------- NumberField ----------

export interface NumberFieldProps extends NativeInputPassThrough {
  label: ReactNode;
  /** `null` represents an empty input. */
  value: number | null;
  onChange: (value: number | null) => void;
  error?: ReactNode;
  helper?: ReactNode;
  id?: string;
  inputClassName?: string;
  /** Outer-layout classes on the field wrapper (margin, padding, flex item, sizing, position). */
  className?: string;
  hideLabel?: boolean;
}

export function NumberField({
  label,
  value,
  onChange,
  error,
  helper,
  id,
  inputClassName,
  className,
  required,
  hideLabel,
  ...rest
}: NumberFieldProps) {
  required = required ?? false;
  hideLabel = hideLabel ?? false;
  const autoId = useId();
  const fieldId = id !== undefined ? id : autoId;
  const hasError = isShown(error);
  return (
    <FieldShell id={fieldId} label={label} hideLabel={hideLabel} required={required} error={error} helper={helper} className={className}>
      <input
        id={fieldId}
        type="number"
        value={value === null ? "" : value}
        onChange={(e) => {
          const n = e.target.valueAsNumber;
          onChange(Number.isNaN(n) ? null : n);
        }}
        required={required}
        aria-invalid={hasError ? true : undefined}
        aria-describedby={fieldMessageId(fieldId, { error, helper })}
        className={inputClasses(hasError, inputClassName)}
        {...rest}
      />
    </FieldShell>
  );
}

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
          className="accent-primary disabled:cursor-not-allowed"
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

// ---------- SelectField ----------

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

type NativeSelectPassThrough = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "value" | "onChange" | "id" | "className" | "children"
>;

export interface SelectFieldProps extends NativeSelectPassThrough {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  error?: ReactNode;
  helper?: ReactNode;
  id?: string;
  inputClassName?: string;
  /** Outer-layout classes on the field wrapper (margin, padding, flex item, sizing, position). */
  className?: string;
  hideLabel?: boolean;
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  error,
  helper,
  id,
  inputClassName,
  className,
  required,
  hideLabel,
  ...rest
}: SelectFieldProps) {
  required = required ?? false;
  hideLabel = hideLabel ?? false;
  const autoId = useId();
  const fieldId = id !== undefined ? id : autoId;
  const hasError = isShown(error);
  return (
    <FieldShell id={fieldId} label={label} hideLabel={hideLabel} required={required} error={error} helper={helper} className={className}>
      <select
        id={fieldId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        aria-invalid={hasError ? true : undefined}
        aria-describedby={fieldMessageId(fieldId, { error, helper })}
        className={inputClasses(hasError, inputClassName)}
        {...rest}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}
