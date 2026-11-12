/**
 * The text of a string literal, a no-substitution template, or one literal
 * part of a template: what the view source checks (the Markdown check and
 * `bbx view check` advice) scan for forbidden text.
 */

import type * as TS from "../../lib/typescript/syntax.js";

/** The literal text `node` holds, or null when it is not a string or template part. */
export function stringLiteralText(ts: typeof TS, node: TS.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) return node.text;
  return null;
}
