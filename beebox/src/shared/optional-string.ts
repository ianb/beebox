/** `value` when it is a string, else null. */
export function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** `value` when it is a string other than "", else null. */
export function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** `value`, untrimmed, when it is a string with a non-space character, else null. */
export function nonBlankString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
