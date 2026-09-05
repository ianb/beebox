/**
 * The static triage-pipeline reference doc for agents.
 *
 * Documents the intake → triage → handle pipeline that sorts inbox items into
 * category buckets: the confidence levels the triage agent assigns and the
 * `TRIAGE_ITEMS` contract a category's handler procedure reads. This is the
 * box-side home for what used to live only in `docs/triage.md`
 * (a repo plan boxes never receive).
 */

export function generateTriageGuide(): string {
  return `# The triage pipeline (intake → triage → handle)

Three stages sort items that land in \`_content/inbox/\` into per-category buckets.
Each stage is its own command, run directly:

- \`bbx intake\` — prepares raw items in \`_content/inbox/intake/\` (transcription, OCR,
  filename normalization) and advances them to \`_content/inbox/staged/\`.
- \`bbx triage\` — the triage agent reads each staged item and assigns it a
  category and a confidence level, moving it to \`_content/inbox/triaged/<category>/\`.
- \`bbx handle\` — runs each category's handler procedure over its bucket.

A category is a landmark whose \`destinations\` list carries a \`for: [triage]\`
entry; that entry names the handler \`procedure\` for the bucket.

## Confidence levels

The triage agent assigns exactly one of three levels to each item (never a
numeric score, and never a "wrong"/"unknown" level):

- \`confident\` — the rules clearly say this item belongs in the chosen category.
  Routed to the bucket, no further review.
- \`probable\` — the rules likely fit, but it's a judgment call worth flagging.
  Routed to the bucket, and a \`.probable.txt\` marker is dropped alongside it so
  the boxholder can spot-check.
- \`guess\` — not enough signal to commit. The item's category is left null; it
  goes to \`_content/inbox/triaged/_unsure/\` paired with a question card, and the
  pipeline does not advance it until the boxholder answers.

## Writing a handler procedure

\`bbx handle\` invokes a category's handler procedure once per bucket, passing the
bucket's items through the **\`TRIAGE_ITEMS\` environment variable** — a
null-delimited (\`\\0\`) list of box-relative paths. It's set in the process env
and forwarded into the procedure's shell steps, so a handler reads its work from
there rather than scanning a directory:

\`\`\`sh
# In a shell step of the handler procedure:
printf '%s' "$TRIAGE_ITEMS" | xargs -0 -I{} sh -c 'process "{}"'
\`\`\`

Use \`xargs -0\` (or split on NUL) — the paths are NUL-delimited so filenames with
spaces survive. When the handler finishes, it moves each item out of the bucket
(\`bbx mv\` to its destination, or \`bbx rm\` to trash); the bucket is empty when done.

\`bbx handle\` reports its worst bucket: exit 1 if a handler procedure failed,
exit 3 if one finished its work but its review reached no verdict (one
\`Inconclusive: handle <category> — …\` line on stderr), exit 0 only when
everything that ran was judged.
`;
}
