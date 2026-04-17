import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class strings, resolving conflicts in favor of later values.
 *
 * Used inside UI primitives to combine the component's own classes with a
 * caller-supplied `className`. The caller's value wins where it overlaps
 * (e.g. the component applies `p-3`, the caller passes `p-6`, result: `p-6`).
 *
 * The `restrict-component-classes` ESLint rule enforces that the caller's
 * `className` only contains outer-layout tokens (margin, padding, flex item,
 * grid item, sizing, position), so in practice the merge resolves margin /
 * padding / flex-item overrides — never appearance.
 */
export function cn(...values: Array<string | false | null | undefined>): string {
  return twMerge(values.filter((v): v is string => typeof v === "string" && v.length > 0).join(" "));
}
