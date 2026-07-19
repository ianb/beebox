/** Format one log argument into a string, roughly matching console.log semantics. */
export function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value);
  } catch (e) {
    void e;
    return "[unserializable]";
  }
}

/** Join log arguments into a single space-separated line. */
export function formatArgs(args: readonly unknown[]): string {
  return args.map(formatValue).join(" ");
}
