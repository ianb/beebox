/** Named visual treatments accepted by the universal `{% quote %}` tag. */
export const QUOTE_TREATMENTS = ["layered", "inset", "plain"] as const;

export type QuoteTreatment = (typeof QUOTE_TREATMENTS)[number];

const QUOTE_TREATMENT_SET: ReadonlySet<unknown> = new Set(QUOTE_TREATMENTS);

interface QuoteTreatmentValidationError {
  id: string;
  level: "error";
  message: string;
}

export function validateQuoteTreatment(inline: boolean, treatment: unknown): QuoteTreatmentValidationError[] {
  const known = typeof treatment === "string" && QUOTE_TREATMENT_SET.has(treatment);
  if (!inline || !known) return [];
  return [{
    id: "quote-inline-treatment",
    level: "error",
    message: `Quote treatment '${treatment}' applies only to block quotes; this quote remains inline`,
  }];
}
