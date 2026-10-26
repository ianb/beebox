/**
 * A select question's options as the end of a spoken line ("Finance,
 * Personal, or Taxes?"). Beside the chat the person answers in words, so the
 * card lists the choices instead of offering buttons
 * (docs/plans/questions-later-and-figure-it-out.md, Track A). Past
 * `OPTIONS_SHOWN` the line says how many more there are. Null for a question
 * with no options.
 */

/** A select question lists at most this many options in its line. */
const OPTIONS_SHOWN = 6;

export function optionsLine(options: readonly string[] | undefined): string | null {
  if (options === undefined || options.length === 0) return null;
  const shown = options.slice(0, OPTIONS_SHOWN);
  const beyond = options.length - shown.length;
  const choices = beyond > 0 ? [...shown, `one of ${beyond} more`] : shown;
  const listed = choices.length === 1 ? choices[0] : choices.length === 2 ? choices.join(" or ") : `${choices.slice(0, -1).join(", ")}, or ${choices.at(-1)}`;
  return `${listed}?`;
}
