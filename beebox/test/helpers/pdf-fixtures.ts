/**
 * Tiny, structurally complete PDFs for tests.
 *
 * Built rather than pasted so the xref offsets and stream length are correct
 * by construction — a hand-typed literal drifts the moment anyone edits it,
 * and `qpdf --check` / poppler are precisely the things that would notice.
 * Cross-checked against poppler (`pdfinfo`, `pdftotext`) and ghostscript, both
 * of which parse these without complaint.
 *
 * Two shapes, because scan-import's dispatch turns on exactly this difference:
 *
 * - {@link textlessPdf} draws a filled rectangle only. `pdftotext` extracts
 *   nothing from it — a photo batch saved as a PDF looks like this.
 * - {@link textPdf} additionally draws a text run in Helvetica (a PDF base-14
 *   font, so the file carries no embedded font program and stays tiny). A
 *   scanner's OCR output looks like this.
 */

/** Assemble a one-page PDF from body objects and a page resources dictionary. */
function buildPdf(options: { content: string; resources: string }): Buffer {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources ${options.resources} >>\nendobj\n`,
    `4 0 obj\n<< /Length ${String(options.content.length)} >>\nstream\n${options.content}endstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += object;
  }
  const startxref = pdf.length;
  pdf += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(startxref)}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

/**
 * A PDF with no extractable text — only self-contained graphics operators. A
 * text operator would reference a font, which is what makes the difference
 * these fixtures exist to express.
 */
export function textlessPdf(): Buffer {
  return buildPdf({ content: "0 0 1 rg 20 20 100 100 re f\n", resources: "<< >>" });
}

/**
 * A PDF carrying an embedded text layer. The default text is two lines — long
 * enough to clear the detector's minimum-characters threshold the way a real
 * scanned page would be; pass a shorter string (or `\n`-separated lines) to
 * exercise the threshold itself.
 */
export function textPdf(options?: { text?: string }): Buffer {
  const text = options?.text
    ?? "Invoice 2026-04 Northwind Traders total due 128.40 payable within thirty days\nRemit to accounts receivable, Springfield branch, before the fifteenth";
  const lines = text.split("\n").map((line, index) => `BT /F1 12 Tf 40 ${String(700 - index * 20)} Td (${line}) Tj ET`);
  return buildPdf({
    content: `${lines.join("\n")}\n0 0 1 rg 40 40 200 120 re f\n`,
    resources: "<< /Font << /F1 5 0 R >> >>",
  });
}
