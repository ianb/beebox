/**
 * A question card's title when it has no `title:`: the first sentence of its
 * `prompt`, cut at a word to fit a tab. Older cards and cards written without
 * a title are named by their filename otherwise ("scan 20260429T0249 …"),
 * which says nothing about the question. The schema's `summarize` and the
 * frontend's `cardTitle` both use it, so a tab, a listing, and the card agree.
 */

/** The longest title, in characters, before it is cut at a word. */
const MAX_TITLE = 60;

export function questionTitle(prompt: string): string {
  const flat = prompt.replace(/\s+/g, " ").trim();
  const first = /^.*?[!.?](?=\s|$)/.exec(flat)?.[0] ?? flat;
  if (first.length <= MAX_TITLE) return first;
  const cut = first.slice(0, MAX_TITLE - 1);
  const atWord = cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).replace(/[\s,.:;-]+$/, "");
  return `${atWord}…`;
}
