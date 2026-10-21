import { type ReactNode } from "react";
import { cn } from "../../../lib/cn";
import { useMaterial } from "../material";

// An input paints its own field and ink, like any control, so it reads the
// same on every card material.
const INPUT_BASE = "w-full border rounded px-3 py-2 bg-white text-warm-900 focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 disabled:cursor-not-allowed";

export function inputClasses(error: boolean, extra?: string): string {
  const border = error ? "border-danger" : "border-warm-400";
  return cn(INPUT_BASE, border, extra);
}

interface FieldShellProps {
  id: string;
  label: ReactNode;
  hideLabel: boolean;
  required: boolean;
  error: ReactNode | undefined;
  helper: ReactNode | undefined;
  children: ReactNode;
  className?: string;
}

/** Label and helper ink for a field: the app palette, or the enclosing Card's material. */
export function useFieldInk(): { label: string; helper: string } {
  return useMaterial(undefined)
    ? { label: "text-card-ink", helper: "text-card-soft" }
    : { label: "text-warm-700", helper: "text-warm-700" };
}

export function FieldShell({ id, label, hideLabel, required, error, helper, children, className }: FieldShellProps) {
  const ink = useFieldInk();
  const labelClass = hideLabel
    ? "sr-only"
    : `block text-sm font-medium ${ink.label} mb-1`;
  return (
    <div className={className}>
      <label htmlFor={id} className={labelClass}>
        {label}
        {required ? <span className="text-danger ml-0.5" aria-hidden="true">*</span> : null}
      </label>
      {children}
      {error !== undefined ? (
        <div className="text-danger-dark text-sm mt-1" role="alert">{error}</div>
      ) : helper !== undefined ? (
        <div className={`text-xs ${ink.helper} mt-1`}>{helper}</div>
      ) : null}
    </div>
  );
}
