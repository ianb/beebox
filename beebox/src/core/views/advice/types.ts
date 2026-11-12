/**
 * Advice from `bbx view check`: a pattern the views doc forbids, found in a
 * view that renders. Advice never changes whether the view passes
 * (docs/plans/box-view-guidance-and-checks.md, Track 3).
 */

import { z } from "zod";

/** Source rules read the view's code; DOM rules read what it rendered. */
export const ADVICE_RULES = [
  "enter-without-ime-check",
  "clickable-non-control",
  "viewport-height",
  "date-string-parse",
  "utc-today",
  "unnamed-control",
  "img-without-alt",
  "aria-label-without-role",
  "wide-table-without-wrapper",
] as const;

export type AdviceRule = (typeof ADVICE_RULES)[number];

/** One rule's findings in a view. */
export interface ViewAdvice {
  rule: AdviceRule;
  /** The fix in one line, naming its views.md section. */
  message: string;
  /** `views/<file>:<line>`, or a rendered element's opening tag. */
  where: string[];
}

/** The fix for each rule. */
export const ADVICE_MESSAGES: Record<AdviceRule, string> = {
  "enter-without-ime-check":
    "Enter acts without an IME check; return early while `e.nativeEvent.isComposing`, or submit through `<form onSubmit>` (views.md, \"Controls People Can Use\")",
  "clickable-non-control":
    "a clickable element that is not a control; use `<button type=\"button\">` or `<a href>` (views.md, \"Controls People Can Use\")",
  "viewport-height":
    "a `100vh` or `h-screen` height; use `dvh` (views.md, \"Controls People Can Use\")",
  "date-string-parse":
    "`new Date(text)` reads a date-only value as midnight UTC; use `Temporal.PlainDate.from` or `Temporal.Instant.from` (views.md, \"Dates\")",
  "utc-today":
    "`toISOString()` cut to a date is today in UTC; use `Temporal.Now.plainDateISO()` (views.md, \"Dates\")",
  "unnamed-control":
    "a control with no name; give it text, a `<label>`, or `aria-label` (a placeholder is not a name) (views.md, \"Controls People Can Use\")",
  "img-without-alt":
    "an `<img>` with no `alt`; describe it, or `alt=\"\"` for decoration (views.md, \"Controls People Can Use\")",
  "aria-label-without-role":
    "`aria-label` on an element with no role is not read; add a role or drop the label (views.md, \"Controls People Can Use\")",
  "wide-table-without-wrapper":
    "if this table does not already scroll, put it in a scroll wrapper (`role=\"region\"`, `aria-label`, `tabIndex={0}`, `overflowX: \"auto\"`) (views.md, \"Styling\")",
};

/** One finding as the advise child prints it. */
export const viewAdviceSchema = z.strictObject({
  rule: z.enum(ADVICE_RULES),
  message: z.string(),
  where: z.array(z.string()),
});

export function advice(rule: AdviceRule, where: string): ViewAdvice {
  return { rule, message: ADVICE_MESSAGES[rule], where: [where] };
}

/** Findings merged by rule, in first-seen order, with each `where` once. */
export function mergeAdvice(findings: readonly ViewAdvice[]): ViewAdvice[] {
  const byRule = new Map<AdviceRule, ViewAdvice>();
  for (const finding of findings) {
    const merged = byRule.get(finding.rule);
    if (merged === undefined) byRule.set(finding.rule, { ...finding, where: [...new Set(finding.where)] });
    else merged.where = [...new Set([...merged.where, ...finding.where])];
  }
  return [...byRule.values()];
}
