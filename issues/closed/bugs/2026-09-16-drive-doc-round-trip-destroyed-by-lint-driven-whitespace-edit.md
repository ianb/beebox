---
title: "A lint-driven whitespace edit round-tripped through the Drive connector and destroyed two Google Docs"
workstream: drive-roundtrip-safety
area: beebox
priority: important
labels: [connectors, data-loss]
filed-by: agent
discovered-by: Ian
discovered-in: main — an agent postmortem filed as box feedback after the boxholder found the damage
resolution: implemented
---

> **Closed 2026-09-15 — fixed by commit `5438d6053`** on
> `worktree-drive-roundtrip-safety`. Connector-owned markdown is exempt from
> markdownlint at both entry points, a whitespace-stripping push is refused and
> parked as `.remote.md`, and the SDK hook + card instructions now say what the
> file is and that an empty `lossy:` is not a safety check. Two of the
> postmortem's five remedies were deliberately not implemented — extending
> `LossyType` to cover nested lists, and letting the connector commit its own
> pulls with `--no-verify` — see the Resolution section below for why. Verified
> only against the Drive fakes; never exercised against a real synced Google
> Doc.

Two shared Google Docs lost their structure. A box agent stripped trailing
whitespace from connector-owned markdown to get past a lint failure, the
connector pushed the stripped text back to Drive, and nested checklists
collapsed into run-on paragraphs. Google Docs version history was the only way
back; the box held no earlier committed copy.

This is data loss in the boxholder's own content, reached by a path where every
individual step looked reasonable.

## The chain

1. A Google Doc is mounted as a `gdoc` card with its text in the attach scope.
   The markdown comes from **Google's export API** (`exportFile(file.id,
   MARKDOWN_MIME)`, `connectors/drive-handler-docs.ts:224`), not from anything
   this repo renders.
2. That export encodes line breaks inside nested checklists as **two trailing
   spaces**, and indents sub-items with six spaces.
3. `markdownlint` rule **MD009** flags trailing whitespace, and the pre-commit
   hook lints staged markdown. The connector's own staged pull therefore could
   not be committed.
4. The tree stayed dirty for days, so *every* commit touching it failed. By the
   next morning `chat-review`, `gc-procedure-runs` and `refresh-maps` were all
   failing on the same lint error.
5. The agent checked the card's `lossy:` field, saw it empty, judged a
   whitespace-only change safe, stripped the trailing spaces, and committed.
6. The next sync pushed the stripped markdown upstream. The nested checkboxes
   became single paragraphs; strikethrough and checked items flattened into the
   parent line.

## Verified root cause: `lossy:` cannot express this

The empty `lossy:` field is what made the edit look safe, and it was empty for a
structural reason rather than an oversight. `LossyType`
(`schemas/gdoc.tsx:22-30`) is a closed enum:

```
comments | footnotes | images | equations | suggestions | tables
```

`tallyLossyFromDocument` (`connectors/drive-handler-docs.ts:76`) counts exactly
those. **Nested lists and checkboxes are not in the vocabulary**, so a document
made entirely of nested checklists reports `lossy: []` — "nothing will be lost"
— while being precisely the shape that does not survive the round trip.

The card's own guidance tells agents to read that field: *"`lossy` enumerates
features in the upstream Doc that don't survive … if `lossy` is non-empty and a
push is intended, surface the loss to the boxholder."* An agent that follows
that instruction exactly gets the wrong answer here.

## What to fix, and one correction to the original report

The postmortem proposed five remedies. Four hold; one is not ours:

- **Exempt connector-owned attach markdown from markdownlint**, or at least from
  MD009. Connector output is not hand-authored content and should never gate a
  commit. This is the fix that removes the pressure that caused the edit.
- **Teach `lossy:` about nested lists and checkboxes**, so the field stops
  asserting safety it cannot verify. Until then, its emptiness means "none of
  six known features present", not "safe to edit".
- **Refuse or warn on a whitespace-only diff to a synced document.** A push whose
  entire content is whitespace change is far more likely to be lint damage than
  an intended edit.
- **State it in agent guidance**: never edit connector-owned attach files for
  lint reasons. A lint failure on a connector file is an engine bug to report,
  not a file to repair. (The reporting agent has already added this as a
  correction on its own box briefing.)
- **Let the connector commit its own pulls even when lint fails** — otherwise a
  single bad lint interaction leaves the tree permanently dirty and blocks
  unrelated scheduled jobs, which is how one formatting nit became four broken
  schedules.

**Not actionable as written:** "the exporter should use four-space indented
sub-lists". The markdown is produced by Google's export API, so its formatting
is not ours to choose. The only lever on our side is post-processing the export,
which is the same class of edit that caused this incident and would need the
same round-trip guarantees before it could be safe.

## A correction to the mechanism

MD009 does not flag *every* trailing space. Its default `br_spaces: 2` tolerates
a run of exactly two, which is the line-break form; it flags runs of one, three
or more, and trailing whitespace on otherwise-blank lines. So the export line
that actually failed the hook was not the two-space break itself but some other
run in the same file — and the fix stripped both, because a whitespace sweep
does not distinguish them. This does not change any remedy: the exemption covers
the file regardless of which run fired.

## Resolution

Fixed on `worktree-drive-roundtrip-safety`:

- `core/connector-owned-markdown.ts` identifies the markdown the docs connector
  writes and pushes: `<basename>.attach/<basename>.md` beside a `.gdoc.card`,
  plus the `<basename>.remote.md` a refused push parks there. Both lint entry
  points — `runMarkdownlint` in `cli/commands/validate-markdown.ts` and the SDK
  PostToolUse hook — skip those files, so connector output can never gate a
  commit. Authored markdown elsewhere in the same attach scope still lints.
- `drive-handler-docs.ts` push refuses a local change that strips trailing
  whitespace off a line it otherwise keeps, parking the upstream copy as
  `.remote.md` and letting the next pull set `status: conflict` — the existing
  resolution path. The test is per line rather than per file: a lint sweep
  bundled with a real content edit destroys exactly as much structure as a
  whitespace-only one.
- The SDK hook tells an agent what the file is at the moment it writes to one,
  which is where a rule has to arrive to matter.
- The gdoc schema instructions now state that an empty `lossy:` is not a safety
  check. The `LossyType` enum was deliberately left alone: a closed list of
  export-fidelity gaps can never be complete, and each addition re-asserts the
  completeness that caused this.

Not done, deliberately: the connector does not commit its own pulls with
`--no-verify`. With the exemption in place the pressure is gone, and a
hook-bypass hatch would hide the next instance.

## Notes

The dirty-tree half overlaps
[`bbx feedback` can fail on whitespace it introduced itself](../../bugs/2026-08-12-bbx-feedback-rejects-its-own-transcript.md)
— the same pattern of generated content failing a lint rule meant for authored
content.

Document names, contents, and the affected box's identity are omitted
deliberately; the mechanism above is complete without them.
