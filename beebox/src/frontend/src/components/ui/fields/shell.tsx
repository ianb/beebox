import { type ReactNode } from "react";
import { cn } from "../../../lib/cn";
import { useMaterial } from "../material";

// An input paints its own field and ink, like any control, so it reads the
// same on every card material. Its edge is a border at 6.4:1 on the field,
// so it shows on light paper too; the light color scheme draws a select's
// arrow and menu for the white field on a dark theme. The gold focus ring is
// faint on white, so focus also darkens the border.
const INPUT_BASE = "w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 disabled:cursor-not-allowed";

/**
 * `dark` is for a control on the dark capture screen: the field and ink of
 * `ModalDialog`'s dark tone, with a gray-400 edge (about 6.7:1 on gray-900) and the
 * dark color scheme for a select's arrow and menu.
 */
export type FieldTone = "light" | "dark";

const TONE_CLASSES: Record<FieldTone, { field: string; border: string }> = {
  light: { field: "bg-white text-warm-900 [color-scheme:light] focus:border-warm-900", border: "border-warm-700" },
  dark: { field: "bg-gray-900 text-white [color-scheme:dark] focus:border-white", border: "border-gray-400" },
};

export function inputClasses(state: { error: boolean; tone?: FieldTone }, extra?: string): string {
  const tone = TONE_CLASSES[state.tone ?? "light"];
  return cn(INPUT_BASE, tone.field, state.error ? "border-danger" : tone.border, extra);
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
  tone?: FieldTone;
}

/** Label, helper and error ink for a field: the app palette, the enclosing Card's material, or the dark tone. */
export function useFieldInk(tone?: FieldTone): { label: string; helper: string; error: string } {
  const material = useMaterial(undefined);
  if (tone === "dark") return { label: "text-gray-300", helper: "text-gray-300", error: "text-danger-light" };
  return material
    ? { label: "text-card-ink", helper: "text-card-soft", error: "text-danger-dark" }
    : { label: "text-warm-700", helper: "text-warm-700", error: "text-danger-dark" };
}

/**
 * Whether a field's error or helper renders. React draws nothing for
 * `null`, `false`, or "", so those count as absent everywhere a field decides
 * it is invalid, links a message, or renders one.
 */
export function isShown(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== "";
}

/**
 * The id of the message under a field, for its control's `aria-describedby`,
 * or undefined when the field shows none. A screen reader then reads the hint,
 * or the error, each time the control takes focus; `role="alert"` alone
 * announces an error only once, when it appears.
 */
export function fieldMessageId(fieldId: string, message: { error: ReactNode | undefined; helper: ReactNode | undefined }): string | undefined {
  return isShown(message.error) || isShown(message.helper) ? `${fieldId}-message` : undefined;
}

/** The error, or else the helper, under a field. Its id is `fieldMessageId`'s. */
export function FieldMessage({ fieldId, error, helper, tone }: { fieldId: string; error: ReactNode | undefined; helper: ReactNode | undefined; tone?: FieldTone }) {
  const ink = useFieldInk(tone);
  const id = `${fieldId}-message`;
  if (isShown(error)) return <div id={id} className={`${ink.error} text-sm mt-1`} role="alert">{error}</div>;
  if (isShown(helper)) return <div id={id} className={`text-xs ${ink.helper} mt-1`}>{helper}</div>;
  return null;
}

export function FieldShell({ id, label, hideLabel, required, error, helper, children, className, tone }: FieldShellProps) {
  const ink = useFieldInk(tone);
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
      <FieldMessage fieldId={id} error={error} helper={helper} tone={tone} />
    </div>
  );
}
