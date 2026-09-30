/**
 * The notice above a pdf card's text, for the states the body alone
 * doesn't explain: extraction failed, the document was judged unusable, or
 * extraction succeeded and honestly found no text (an empty body is a valid
 * extraction result — see the schema instructions in `src/schemas/pdf.ts`).
 *
 * Its own module, and free of data fetching, so it renders standalone.
 */

import { EXTRACTED_REANALYZE_COMMAND } from "../../lib/pdf-card";
import { Pre } from "../ui/Pre";
import { Text } from "../ui/Text";

/**
 * The three states a document card can be in that the body alone doesn't
 * explain: extraction failed, the document was judged unusable, or extraction
 * succeeded and honestly found no text.
 */
export function PdfStatusNotice({
  extracted, error, unusable, hasBody, cardPath,
}: {
  /** Extraction succeeded (the card has `docling`). */
  extracted: boolean;
  error: string | null;
  unusable: boolean;
  hasBody: boolean;
  cardPath: string;
}) {
  // An agent's judgement outranks the extraction outcome it was made about.
  if (unusable) {
    return (
      <div className="p-3 bg-warm-100 border border-warm-200 rounded" role="status">
        <Text as="p" size="sm" tone="subtle">
          This document was marked unusable (corrupt, junk, or an empty scan).
        </Text>
      </div>
    );
  }
  if (error !== null) {
    return (
      <div className="p-3 bg-warning-50 border border-warning-100 rounded" role="status">
        <Text as="p" size="sm" weight="medium" className="text-warning-dark">
          Text extraction failed — the original file is still attached.
        </Text>
        <div className="mt-2"><Pre size="sm">{error}</Pre></div>
        <Text as="p" size="sm" className="mt-2 text-warning-dark">
          Re-run it with <code>{EXTRACTED_REANALYZE_COMMAND} {cardPath}</code>.
        </Text>
      </div>
    );
  }
  if (extracted && !hasBody) {
    return (
      <div className="p-3 bg-warm-100 border border-warm-200 rounded" role="status">
        <Text as="p" size="sm" tone="subtle">
          No readable text in this document — see the original or the page renders.
        </Text>
      </div>
    );
  }
  return null;
}
