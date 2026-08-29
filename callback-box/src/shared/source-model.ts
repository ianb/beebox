/** Shared validation model for the Markdoc `{% source %}` tag. */

import { parseIsoDate } from "./todo-model.js";

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
  if (typeof retrieved === "string" && retrieved !== "") {
    if (typeof href !== "string" || href === "") {
      errors.push({
        id: "source-retrieved-requires-href",
        level: "error",
        message: "{% source %} `retrieved` is only valid with an external `href`",
      });
    }
    if (parseIsoDate(retrieved) === null) {
      errors.push({
        id: "source-retrieved-date",
        level: "error",
        message: "{% source %} `retrieved` must be a real date in YYYY-MM-DD form",
      });
    }
  }
  return errors;
}
