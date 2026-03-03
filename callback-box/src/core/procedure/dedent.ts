/**
 * Text dedenting utility for procedure card content.
 *
 * Strips common leading whitespace from inline text in XML elements,
 * so prompts and scripts can be written at natural indentation levels
 * within the XML structure.
 */

/**
 * Remove common leading whitespace from a multi-line string.
 *
 * Also strips a leading blank line and trailing whitespace.
 */
export function dedent(text: string): string {
  // Strip leading newline (common when text starts on line after opening tag)
  const stripped = text.replace(/^\n/, "");

  const lines = stripped.split("\n");

  // Find minimum indentation of non-empty lines
  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const match = line.match(/^(\s*)/);
    if (match) {
      minIndent = Math.min(minIndent, match[1]!.length);
    }
  }

  if (minIndent === Infinity || minIndent === 0) {
    // Still trim trailing whitespace per line
    return lines.map((l) => l.trimEnd()).join("\n").trimEnd();
  }

  // Remove common indentation and trailing whitespace per line
  const dedented = lines.map((line) => {
    if (line.trim().length === 0) return "";
    return line.slice(minIndent).trimEnd();
  });

  return dedented.join("\n").trimEnd();
}
