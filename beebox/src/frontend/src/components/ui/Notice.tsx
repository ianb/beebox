import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type NoticeTone = "warning" | "error";

export interface NoticeProps {
  children: ReactNode;
  /** `error` is an assertive alert; `warning` is a polite status. */
  tone: NoticeTone;
  /** DOM id. Keep the existing `bbx-` id when a notice moves onto this component. */
  id?: string;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
}

/**
 * Colors per tone, shared with the toast, which adds its own shadow and
 * position. Warning text is `warm-800`: `warning-dark` is 3.3:1 on
 * `warning-50`, below AA.
 */
export const NOTICE_TONE_CLASSES: Record<NoticeTone, string> = {
  warning: "bg-warning-50 border-warning-light text-warm-800",
  error: "bg-danger-50 border-danger-light text-danger-dark",
};

/**
 * An inline bordered message about a failed or degraded operation, set in
 * the page flow. Not a toast (floating) and not a field error (`ErrorText`).
 * `role="alert"` for errors so a screen reader announces them when they
 * appear, `role="status"` for warnings.
 */
export function Notice({ children, tone, id, className }: NoticeProps) {
  return (
    <div
      id={id}
      role={tone === "error" ? "alert" : "status"}
      className={cn("rounded-lg border px-4 py-3 text-sm", NOTICE_TONE_CLASSES[tone], className)}
    >
      {children}
    </div>
  );
}
