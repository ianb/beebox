/**
 * Extract the `from="..."` attribution from every `{% quote %}` tag in a
 * markdown body. Used by viewers to surface "this doc reproduces verbatim
 * words from <people>" as a small subtitle without parsing the full doc.
 *
 * Order-preserving and deduplicated: the returned list keeps the order
 * speakers first appear and drops repeats. Empty/missing `from` is skipped.
 *
 * We use a regex rather than re-running Markdoc to keep this cheap
 * (header-level rendering doesn't want to pay for a full transform). The
 * regex tolerates whitespace inside the opening tag and either quoting
 * style (`"` or `'`); it does NOT try to handle escaped quotes inside
 * `from`, which Markdoc itself wouldn't support either.
 */

const QUOTE_TAG_RE = /{%\s*quote\b[^%]*?\bfrom\s*=\s*(["'])([^"']+)\1[^%]*%}/g;

export function extractQuoteSpeakers(body: string): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const match of body.matchAll(QUOTE_TAG_RE)) {
    const raw = match[2];
    if (raw === undefined || raw === "") continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    ordered.push(raw);
  }
  return ordered;
}

/** Strip a `people/<slug>` prefix to a human-readable display name. */
export function speakerDisplay(speaker: string): string {
  if (speaker.startsWith("people/")) {
    return speaker.slice("people/".length).replace(/[_-]+/g, " ");
  }
  return speaker;
}

export function isPersonRef(speaker: string): boolean {
  return speaker.startsWith("people/");
}
