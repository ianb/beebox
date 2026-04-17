import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

const INPUT_BASE = "w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gold disabled:opacity-50 disabled:cursor-not-allowed";

function inputClasses(error: boolean, extra?: string): string {
  const border = error ? "border-red-500" : "border-warm-400";
  return `${INPUT_BASE} ${border}${extra ? ` ${extra}` : ""}`;
}

function FieldShell({
  id,
  label,
  hideLabel,
  required,
  error,
  helper,
  children,
}: {
  id: string;
  label: ReactNode;
  hideLabel: boolean;
  required: boolean;
  error: ReactNode | undefined;
  helper: ReactNode | undefined;
  children: ReactNode;
}) {
  const labelClass = hideLabel
    ? "sr-only"
    : "block text-sm font-medium text-warm-700 mb-1";
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
        {required ? <span className="text-rose ml-0.5" aria-hidden="true">*</span> : null}
      </label>
      {children}
      {error !== undefined ? (
        <div className="text-red-600 text-sm mt-1" role="alert">{error}</div>
      ) : helper !== undefined ? (
        <div className="text-xs text-warm-500 mt-1">{helper}</div>
      ) : null}
    </div>
  );
}

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
  /** When true, the label is visually hidden but remains for screen readers. */
  hideLabel?: boolean;
}

export function TextField({
  label,
  value,
  onChange,
  type = "text",
  error,
  helper,
  id,
  inputClassName,
  required = false,
  hideLabel = false,
  ...rest
}: TextFieldProps) {
  const autoId = useId();
  const fieldId = id !== undefined ? id : autoId;
  const hasError = error !== undefined;
  return (
    <FieldShell id={fieldId} label={label} hideLabel={hideLabel} required={required} error={error} helper={helper}>
      <input
        id={fieldId}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        aria-invalid={hasError ? true : undefined}
        className={inputClasses(hasError, inputClassName)}
        {...rest}
      />
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
  required = false,
  rows = 4,
  hideLabel = false,
  ...rest
}: TextareaFieldProps) {
  const autoId = useId();
  const fieldId = id !== undefined ? id : autoId;
  const hasError = error !== undefined;
  return (
    <FieldShell id={fieldId} label={label} hideLabel={hideLabel} required={required} error={error} helper={helper}>
      <textarea
        id={fieldId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        rows={rows}
        aria-invalid={hasError ? true : undefined}
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
  required = false,
  hideLabel = false,
  ...rest
}: NumberFieldProps) {
  const autoId = useId();
  const fieldId = id !== undefined ? id : autoId;
  const hasError = error !== undefined;
  return (
    <FieldShell id={fieldId} label={label} hideLabel={hideLabel} required={required} error={error} helper={helper}>
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
}

export function CheckboxField({
  label,
  checked,
  onChange,
  error,
  helper,
  id,
  required = false,
  disabled,
  ...rest
}: CheckboxFieldProps) {
  const autoId = useId();
  const fieldId = id !== undefined ? id : autoId;
  const hasError = error !== undefined;
  const labelClass = disabled === true
    ? "flex items-center gap-2 text-sm text-warm-700 opacity-50"
    : "flex items-center gap-2 text-sm text-warm-700 cursor-pointer";
  return (
    <div>
      <label htmlFor={fieldId} className={labelClass}>
        <input
          id={fieldId}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          required={required}
          disabled={disabled}
          aria-invalid={hasError ? true : undefined}
          className="rounded border-warm-400 text-plum focus:ring-gold disabled:cursor-not-allowed"
          {...rest}
        />
        <span>
          {label}
          {required ? <span className="text-rose ml-0.5" aria-hidden="true">*</span> : null}
        </span>
      </label>
      {error !== undefined ? (
        <div className="text-red-600 text-sm mt-1" role="alert">{error}</div>
      ) : helper !== undefined ? (
        <div className="text-xs text-warm-500 mt-1">{helper}</div>
      ) : null}
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
  required = false,
  hideLabel = false,
  ...rest
}: SelectFieldProps) {
  const autoId = useId();
  const fieldId = id !== undefined ? id : autoId;
  const hasError = error !== undefined;
  return (
    <FieldShell id={fieldId} label={label} hideLabel={hideLabel} required={required} error={error} helper={helper}>
      <select
        id={fieldId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        aria-invalid={hasError ? true : undefined}
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

// ---------- RadioGroup ----------

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
}

export function RadioGroup({
  label,
  value,
  onChange,
  options,
  name,
  variant = "list",
  error,
  helper,
  required = false,
  id,
  disabled = false,
}: RadioGroupProps) {
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
    >
      <div id={`${groupId}-label`} className="block text-sm font-medium text-warm-700 mb-1">
        {label}
        {required ? <span className="text-rose ml-0.5" aria-hidden="true">*</span> : null}
      </div>
      {variant === "list" ? (
        <RadioList name={groupName} value={value} options={options} disabled={disabled} onChange={onChange} />
      ) : (
        <RadioCards name={groupName} value={value} options={options} disabled={disabled} onChange={onChange} />
      )}
      {error !== undefined ? (
        <div className="text-red-600 text-sm mt-1" role="alert">{error}</div>
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
              className="text-plum focus:ring-gold"
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
            ? "border-plum bg-iris-50 cursor-pointer"
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
