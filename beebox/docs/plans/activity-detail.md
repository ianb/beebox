---
title: "Expanded chat activity lines say what changed"
status: active
workstream: activity-detail
issues:
  - ../../../issues/features/2026-10-15-expanded-activity-lines-say-too-little.md
---
# Expanded chat activity lines say what changed

When a person expands the chat's activity row, each step should say which
thing it touched and, one click further, what changed. The plain-language
wording from the Oct 9 fix stays; this plan adds a name, a place, and a short
plain excerpt between the line and the raw tool JSON.

**Issues addressed:** `issues/features/2026-10-15-expanded-activity-lines-say-too-little.md`.
Related, not closed: `issues/bugs/2026-08-30-codex-bash-activity-shows-shell-wrapper.md`
(the shell wrapper only appears in the raw level, which this plan keeps as is).
Searched the queue for "activity", "Made a change", "tool call detail": no
duplicate.

## Design

### Situations

- When Ana asked the box to fix the oven temperature in Lemon Chicken and the
  reply says "Done", I want to open the row and see "Updated Lemon Chicken"
  with "Bake at 350°" struck through and "Bake at 375°" under it, so I can
  trust the change without opening the card.
- When the box edited a plain document (a `.md` note, a list), I want the
  line to name it ("Made a change to Errands"), so I can tell which of my
  things moved.
- When the box searched for something and found nothing, I want to see what
  it searched for ("Searched your box for "lease""), so I can tell whether
  it looked for the right thing.
- When I do not care how the box did it, I want the collapsed row to stay one
  short line. Nothing here changes the collapsed row.

### Right place, right time

All of this waits to be found. The collapsed summary is unchanged. In an
expanded list each line gains a name, a muted place ("in recipes"), and the
plain excerpt directly under it: the person has already asked for more, so
the detail does not wait behind a second click. A row with a single step has
no collapsed summary; its line is what shows in the chat, so there the excerpt
waits behind the line's click. Clicking any line still opens the raw input and
result, as today.

A step whose result is an error (Claude Code's `<tool_use_error>` tag, seen
in real transcripts, e.g. "String to replace not found in file.") gets
"· didn’t go through" after the line and no excerpt, so the asked-for text
does not read as done.

### Spirit

Serves "see the gears" (`beebox/docs/architecture/spirit.md`) at the depth
the person chooses. Risks re-leaking implementation words: a card edit's
excerpt can be YAML (`due: 2026-10-31`). Guard: paths never appear in the
line or the excerpt label; the excerpt shows the agent's own text, short,
and the raw JSON stays the deepest level.

### Trust

No action. This is a record of what the agent already did.

### Wrong or nothing

A tool input that lacks the fields gives a line with a name and no excerpt.
Codex file changes are always in this case: both conversion paths keep only
paths and status (`beebox/src/services/codex-tool-activity.ts:105-115`,
`:193-204`), so Codex chats get names, not before/after. Carrying Codex diff
text is a provider data change and out of scope. A file outside `_content/`
keeps today's generic wording.

## Smallest fix and budget

Smallest fix: name non-card `_content/` files and add the search text to
the Grep line, all in `activity-wording.ts`. That fixes "Made a change" with
no name, but not "how big / what changed", which the issue lists as the
point of expanding.

Chosen: one track, two files plus the doctest.
- `activity-wording.ts`: about +110 / −15 lines (names, place, excerpt).
- `activity-rendering.tsx`: about +45 / −10 lines (middle level, nested raw).
- `chat.activity-wording.doctest.md`: about +90 lines.
Total about 270 changed lines. Not a big change.

## Stated preferences this plan trades against

- Boxholder, 2026-10-15: "I still like the language, and want it to stay
  mirrored in the details, but the details can be expanded." The verbs stay;
  details are added after them.
- Boxholder, 2026-10-09 (closed issue
  `issues/closed/bugs/2026-10-08-chat-activity-row-speaks-in-commands-and-files.md`,
  Resolution): keep showing the agent's own Bash `description`. Kept.
- `_content/` should not show in the UI (issue, "Paths" question). The place
  is a folder name in words ("in recipes"); `_content` is never named.
- Minimize invented concepts: the excerpt reuses `<details>` nesting, already
  the row's only disclosure mechanism (`activity-rendering.tsx:23`).

## What already exists

- `activity-wording.ts:75-82` `cardTitle`: card path → title. Reused.
- `activity-wording.ts:98-106` `describeFileTool`: verb table per tool.
  Extended with a `document` verb.
- `beebox/src/frontend/src/lib/ref-label.ts:22` `refLabel`: "basename,
  `_`/`-` → space, strip `.<type>.card`". Close, but it keeps file
  extensions and turns hyphens to spaces in titles that use them; the wording
  module keeps its own `cardTitle` (underscores only) for consistency with
  the shipped lines.
- The session-log converter passes whatever tool `input` the transcript holds:
  `beebox/src/cli/lib/session-content.ts:202-208`
  *"const input = isRecord(block["input"]) ? block["input"] : {};"* then
  `input,`. For Claude Code that includes `old_string`, `new_string`,
  `pattern`; Codex has already reduced file changes to paths before this point.
- A tool's result is merged onto its call (`beebox/src/cli/lib/session-entry.ts:42-52`)
  as `resultSummary`, the first 500 characters (`session-content.ts:81-94`).
  No `is_error` flag survives; the `<tool_use_error>` text prefix does.
- `beebox/src/dev/lib/session-report/reader.ts:223` has its own
  `describeToolCall` for dev reports. Not touched.

## Prior art (external)

No design decision depends on an external premise. Claude Code's own
terminal UI shows an edit as a red/green diff; this plan shows a much shorter
before/after because the reader is not a programmer. Evaluated only.

## Ontology

- **Activity line** (exists, `ToolDetail`, `activity-rendering.tsx:17`): one
  tool call's plain sentence. Unchanged role; may now name a document.
- **Place** (new, string): the folder a touched file sits in, in words, e.g.
  "in recipes". Not a landmark (landmarks need a server query; see NOT in
  scope). Absent at the `_content/` root and outside `_content/`.
- **Excerpt** (new): the plain detail under an expanded line. One of
  `change` (before/after text, from `Edit`) or `text` (a labelled snippet: a
  search pattern that is not plain words). Not the raw input.
- **Failed** (new flag): the step's result begins with `<tool_use_error>`.

## Tracks / scope

### Track 1: detail in `activity-wording.ts` and its rendering

**What.** Lines name documents and searches; a new pure function returns the
place and the excerpt; the renderer shows them.

**Why.** "Made a change", "Searched your box", and "Checked something in your
box" carry no information once the person has asked for more
(`activity-wording.ts:126-143`).

**Direction.**

```ts
export interface ToolCallDetail {
  /** "in recipes"; null when unknown or at the top of the box. */
  place: string | null;
  failed: boolean;
  excerpt: Excerpt | null;
}
export type Excerpt =
  | { kind: "change"; before: string; after: string; everywhere: boolean }
  | { kind: "text"; label: string; text: string };
export function describeToolDetail(block: SessionContentBlock): ToolCallDetail;
```

Line wording (`describeToolCall`):

| Tool | Today | After |
|---|---|---|
| Edit, card | Updated Lemon Chicken | same |
| Edit, `_content/` document | Made a change | Made a change to Errands |
| Edit, Codex with `file_paths` | Made a change | Made a change to Errands and 2 more |
| Write, `_content/` document | Made a change | Saved Errands |
| Read, `_content/` document | Checked something in your box | Looked at Errands |
| Grep, plain-word pattern | Searched your box | Searched your box for "lease" |
| Glob, plain-word pattern | Looked through your box | Looked through your box for "recipe" |
| Anything outside `_content/` | (generic) | same generic |

A document name is the basename minus its last extension, `_` → space
(`Errands.md` → "Errands", `photo.jpg` → "photo"). A file inside a card's
`.attach/` folder gets the place "in <card title>". A pattern is "plain
words" when it matches `/^[\p{L}\p{N} '’.-]+$/u` after trimming `*` from a
Glob's ends and a leading `**/`; anything else goes in the excerpt as
`{ kind: "text", label: "Looked for", text: pattern }`.

Excerpts: `Edit` with `old_string`/`new_string` → `change`, each side cut to
3 lines and 200 characters with "…"; `replace_all` sets `everywhere`. A
failed step has none. Others → null. `Write` has none: its text is the whole
file, and the start of a file does not say what changed (review finding).

Rendering (`ToolDetail`): the summary line shows the line, then the place
and "didn’t go through" in muted text after a "·". The excerpt (before struck
through in a muted colour, after in normal text, "(every place it appeared)"
when `everywhere`) sits under the line in an expanded list, inside the
line's `<summary>` so the opened raw level follows it; for a single-step row
it sits inside the opened `<details>`. Opening the line shows today's JSON
and result. The excerpt is built from spans, since `<summary>` takes phrasing
content.

Two refinements found while making the exhibit: an edit's excerpt drops the
lines it kept at its start and end (an appended line reads as an addition),
and a Glob for `**/*.<type>.card` reads "Looked through your box for <type>
cards".

**Vocabulary lock-ins.** `describeToolDetail`, `ToolCallDetail`, `Excerpt`
(frontend-internal). User-facing words: "in <folder>", "didn’t go through",
"Looked for", "(every place it appeared)".

**First implementation chunk.** All of the above plus doctests; it is one
commit.

## Could this be simpler?

Simplest: put the name on the line and stop (no excerpt, no place). That
fails the Lemon Chicken situation: "Updated Lemon Chicken" was already
shipped and the boxholder still asked for more. The excerpt is the part
that answers "what changed"; the place is one string and distinguishes two
documents with the same name in different folders. Dropped: an edit-size
count ("3 lines changed"), which is a programmer's measure and is visible
from the excerpt anyway.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `old_string` is a 400-line block; the excerpt floods the row | doctest (cut) | cut to 3 lines / 200 chars | clear ("…") |
| Edit failed; the excerpt shows text that never landed | doctest (failed) | `<tool_use_error>` → failed, no excerpt | clear ("didn’t go through") |
| Edit still running or interrupted; no result yet | doctest | no excerpt until a non-error result is grafted on | clear (line only) |
| Grep regex `lease.*` read as the words "lease." | doctest | Grep plain words exclude `.`; Glob keeps it literal | clear |
| Indentation-only edit shows two identical sides | doctest | only blank lines and trailing space trimmed | clear |
| Path is absolute (`/Users/x/box/_content/a/B.md`) | doctest | match the last `_content/` segment | clear |
| Codex `Edit` with only `file_path` | doctest | name, no excerpt, opens to raw | clear |
| Grep pattern is a regex (`due:\s*2026`) | doctest | generic line, pattern in excerpt | clear |
| Path outside `_content/` (`_config/x.yaml`, `.git/…`) | doctest | generic wording, no place | clear |
| Edit input missing during streaming (partial block) | doctest (empty input) | null excerpt | clear |
| Non-string `old_string` | doctest | `stringInput` returns "" → null excerpt | clear |

All "doctest" entries are in `chat.activity-wording.doctest.md`. No critical
gaps. Residual: a failure reported without the `<tool_use_error>` tag (a
Codex error, a Bash failure) is not marked; that is today's behavior.

## Agent-flow / user-flow edge cases

- Wrong tag / wrong field: not applicable; no agent-written vocabulary.
- Stale ref: ADDRESSED; names come from the path at call time, no lookup.
- Two agents: not applicable; read-only rendering.
- Hand-edit drift: not applicable.
- Fabricated value: ADDRESSED; the excerpt is the agent's requested
  replacement, shown only when the result is not an error.
- Validation error UX: not applicable.
- Transition state: ADDRESSED; old transcripts carry the same input shape,
  so they render with the new detail.

## NOT in scope

- Landmark names for the place: needs a `landmarks.identity` query per line
  (`DocumentPlace.tsx:55`); the folder word covers the common case.
- Changing the collapsed summary: the boxholder likes it as is.
- A real diff view: too technical for the reader; raw stays available.
- Bash detail beyond `description`: the command is plumbing (2026-10-09).
- Codex shell-wrapper stripping: its own issue.
- `session-report/reader.ts`'s dev wording.

## Open design questions

None blocking. Lean noted for review: the place word comes from the folder
name, which may be a plural lowercase ("recipes"). Accept as is.

## Knowledge audits

None: no agent-facing concept changes. The agent guide's note that a Bash
`description` is shown still holds.

## What will hold this after it ships

`beebox/src/frontend/test/components/chat.activity-wording.doctest.md`
holds the wording and the `describeToolDetail` results (pure functions).
The render (inline vs. behind the click) is checked once by the UI exhibit;
no new test tier.

## Implementation order

1. `activity-wording.ts` + doctest additions (one commit with 2).
2. `activity-rendering.tsx` middle level.
3. Exhibit of an expanded row before/after; cross-model review; commit.

## Rollout shape

Done when `chat.activity-wording.doctest.md` passes with the new sections,
frontend typecheck and lint pass, and the exhibit shows a real expanded row.
No migration, no knowledge audit.
