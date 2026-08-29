/** Whether `value` is a real calendar date in date-only ISO form. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(timestamp)
    && new Date(timestamp).toISOString().slice(0, 10) === value;
}

interface SourceValidationError {
  id: string;
  level: "error";
  message: string;
}

/** Cross-attribute validation for the Markdoc source tag. */
export function validateSourceAttributes(attributes: Record<string, unknown>): SourceValidationError[] {
  const errors: SourceValidationError[] = [];
  const ref = attributes["ref"];
  const href = attributes["href"];
  if (typeof ref === "string" && ref !== "" && typeof href === "string" && href !== "") {
    errors.push({
      id: "source-ref-xor-href",
      level: "error",
      message: "{% source %} takes at most one of `ref` or `href`, not both",
    });
  }
  const retrieved = attributes["retrieved"];
  if (typeof retrieved === "string" && retrieved !== "" && !isIsoDate(retrieved)) {
    errors.push({
      id: "source-retrieved-date",
      level: "error",
      message: "{% source %} `retrieved` must be a real date in YYYY-MM-DD form",
    });
  }
  return errors;
}
