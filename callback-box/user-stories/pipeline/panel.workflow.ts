export const meta = {
  name: "user-stories-panel",
  description: "Three-lens refutation panel on flagged stories, then triage into stale-doc / false-negative / real gap",
  phases: [
    { title: "Panel", detail: "3 independent lenses per flagged story" },
    { title: "Triage", detail: "classify surviving flags and draft issues for real gaps" },
    { title: "Field notes", detail: "turn browser-pass observations into issue-queue entries" },
  ],
};

// The absolute repo root, passed in by the caller — workflow scripts have no filesystem access
// and every subagent prompt needs absolute paths. Run from a worktree and this is that worktree.
/**
 * A workflow script cannot import, so its error class is declared where it is thrown.
 *
 * The preset bans a bare `Error` and bans a string literal as an Error's first
 * argument, and both bans are right here: this is the guard that fires when a
 * caller forgets an argument, and it is the only thing standing between a typo in
 * a `Workflow({args})` call and a fan-out of subagents pointed at `undefined`.
 */
class WorkflowArgsError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "WorkflowArgsError";
  }
}

/** Named so they are passed as identifiers rather than literals. */
const ARGS_ERR = {
  root: 'pass {root: "<absolute path to the repo root>"} in args',
} as const;

const ROOT = args && args.root;
if (!ROOT) throw new WorkflowArgsError(ARGS_ERR.root);
const OUT = `${ROOT}/callback-box/user-stories/work`;

// args: { root: string, flagged: string[], browserFailed: string[] }
// `flagged` = a code verifier called it inaccurate; those go to the three-lens panel first.
// `browserFailed` = the running app was driven and did NOT do it. That is stronger evidence than
// any code reading, so those skip the panel and go straight to triage.
const flagged = (args && args.flagged) || [];
const browserFailed = (args && args.browserFailed) || [];

/** One reviewer's question. The three test separate necessary conditions — see the rule below. */
interface Lens {
  key: string
  name: string
  brief: string
}

const LENSES: Lens[] = [
  {
    key: "exists",
    name: "Does the code exist and is it wired up?",
    brief: `Ignore reachability and ignore wording. Ask only: is there real, live code that implements
this capability, and is it connected to the rest of the system — registered, exported, imported,
mounted? Dead code that nothing references does not count as existing. Read the cited files and
follow the references outward.`,
  },
  {
    key: "reachable",
    name: "Can anyone actually get to it?",
    brief: `Assume the implementation exists and works. Ask only: can the story's stated role actually
reach it? Trace a real entry point — a frontend route, a rendered control, an HTTP route, a tRPC
procedure, a registered CLI command, a scheduled trigger. A capability behind a flag that defaults
off, behind config nobody sets, or with no entry point at all is not reachable. Say what the entry
point is, or that there isn't one.`,
  },
  {
    key: "wording",
    name: "Does the code do the whole of what the story claims?",
    brief: `Assume it exists and is reachable. Read the story's wording literally — every qualifier,
and the "so that" clause. Ask only: does the code deliver that, or something narrower? A story that
claims a general capability where the code handles one special case is an over-claim. A story whose
benefit clause promises an outcome the code does not produce is an over-claim.`,
  },
];

/** One lens's vote on one story. */
interface LensVote {
  id: string
  lens: string
  refuted: boolean
}

const REFUTE_SCHEMA: WorkflowJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "lens", "refuted"],
  properties: {
    id: { type: "string" },
    lens: { type: "string" },
    refuted: { type: "boolean", description: "true = the story fails on this lens" },
  },
};

phase("Panel");

const assignments: Array<{ id: string; lens: Lens }> = [];
for (const id of flagged) {
  for (const lens of LENSES) assignments.push({ id, lens });
}

const votes = await parallel(assignments.map(({ id, lens }) => () => agent<LensVote>(
  `You are one of three independent reviewers examining a single user story. Each of you looks
through a different lens and none of you sees the others' conclusions. Repository root: ${ROOT}.

An earlier adversarial verifier flagged this story as inaccurate. You are re-examining it — the
earlier verifier was instructed to refute when uncertain, so it may well have been too harsh.
Reach your own conclusion from the code.

Read the story from \`${OUT}/stories.final.json\` (match on \`id\`), and the earlier verifier's note for
it from the matching file in \`${OUT}/verdicts/\`.

## Your lens: ${lens.name}

${lens.brief}

**Judge only your lens.** Another reviewer is covering each of the others. If the story fails for a
reason outside your lens, that is not your call — report \`refuted: false\` and say in your note
that your lens is satisfied. Splitting the judgment this way is the point; do not try to reach an
overall verdict.

Report \`refuted: true\` only if the story fails ON YOUR LENS. Unlike the first pass, do NOT refute
from uncertainty here: this panel decides what reaches a human, so refute only what you can show
from the code. If your lens genuinely cannot be settled, report \`refuted: false\` and say so.

## Story to examine

\`${id}\`

## Output

Write your JSON to: ${OUT}/panel/${id}.${lens.key}.json

{"id": "${id}", "lens": "${lens.key}", "refuted": true|false, "note": "2-5 sentences citing the code you read"}

Then return id, lens, and refuted.`,
  { label: `panel:${id}/${lens.key}`, phase: "Panel", schema: REFUTE_SCHEMA },
)));

const tally = new Map<string, LensVote[]>();
let panelFailures = 0;
for (const v of votes) {
  if (!v) { panelFailures++; continue; }
  // Read-modify-write rather than has/set/get: nothing in the types carries the
  // fact that a `set` on the previous line makes the following `get` defined.
  const forId = tally.get(v.id) ?? [];
  forId.push(v);
  tally.set(v.id, forId);
}

const survived: string[] = [];   // panel says the story is fine after all
const upheld: string[] = [];     // panel agrees it is flawed
const undecided: string[] = [];  // fewer than 3 lenses returned

// ANY refutation upholds the flag — this is NOT a majority vote.
//
// The three lenses do not review the same proposition from three angles; they test three
// SEPARATE NECESSARY conditions. A story is true only if the code exists AND a user can reach it
// AND the wording matches what it does. Failing any one makes the story false, so counting votes
// lets 'exists' and 'reachable' outvote a correct wording refutation — which is precisely how an
// over-claim ends up wearing a green check.
for (const id of flagged) {
  const vs = tally.get(id) || [];
  if (vs.length < 3) { undecided.push(id); continue; }
  if (vs.some((v) => v.refuted)) upheld.push(id);
  else survived.push(id);
}

if (panelFailures) log(`INCOMPLETE: ${panelFailures} panel vote(s) failed`);
if (undecided.length > 0) log(`UNDECIDED (fewer than 3 lenses returned): ${undecided.join(", ")}`);
log(`Panel: ${upheld.length} upheld (any lens refuting), ${survived.length} cleared on all three, ${undecided.length} undecided`);

// ---------------------------------------------------------------------------
// Triage — only what the panel upheld. This is what reaches a human.
// ---------------------------------------------------------------------------

phase("Triage");

/** How a human should read one upheld flag, and the issue to raise if it is a real gap. */
type Classification = "stale-story" | "false-negative" | "real-gap"

interface TriageItem {
  id: string
  classification: Classification
  issueTitle?: string
}

interface TriageResult {
  file: string
  items: TriageItem[]
}

const TRIAGE_SCHEMA: WorkflowJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["file", "items"],
  properties: {
    file: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "classification"],
        properties: {
          id: { type: "string" },
          classification: { type: "string", enum: ["stale-story", "false-negative", "real-gap"] },
          issueTitle: { type: "string" },
        },
      },
    },
  },
};

const toTriage = [...upheld, ...browserFailed.filter((id) => !upheld.includes(id))];
log(`Triage set: ${upheld.length} panel-upheld + ${toTriage.length - upheld.length} browser-failed`);

const CHUNK = 6;
const chunks: string[][] = [];
for (let i = 0; i < toTriage.length; i += CHUNK) chunks.push(toTriage.slice(i, i + CHUNK));

const triaged = await parallel(chunks.map((ids, i) => () => {
  const tag = String(i + 1).padStart(3, "0");
  return agent<TriageResult>(
    `You are triaging user stories that survived a three-lens refutation panel. Repository root: ${ROOT}.

Each story below arrived here one of two ways: an adversarial code verifier flagged it and AT
LEAST ONE of three independent lens reviewers upheld that flag, OR an agent drove the running app
and watched it fail to do what the story claims.

(One refuting lens is enough. The three lenses test separate necessary conditions — the code
exists, someone can reach it, the wording matches what it does — so a story is true only if all
three hold. Do not read a single refutation as a weak signal because the other two were satisfied;
often only one lens is even capable of catching the problem.) Your job is to decide what each one MEANS, and
what (if anything) a human should do about it.

**A story that failed in the running app is very unlikely to be a \`false-negative\`.** Someone
watched the app not do it. Classify it that way only if you can show the check itself was wrong —
the wrong page, missing data, or a browse-harness artifact.

For each id, read: the story in \`${OUT}/stories.final.json\`, the verifier note in \`${OUT}/verdicts/\`,
any panel notes in \`${OUT}/panel/${"${id}"}.*.json\` (a browser-failed story will have none), and
any browser check for it in \`${OUT}/browser/\`. Then check the code yourself — each reviewer saw
one facet, you see the whole picture.

## Classify each as exactly one of

- **\`stale-story\`** — the CODE is fine; the STORY is wrong. It describes a capability that was
  removed, renamed, moved, or that never worked the way the story says. Nothing to fix in the
  product; the story is dropped or corrected in the catalog.
- **\`false-negative\`** — the story is substantially TRUE and the flag was over-conservative
  (a moved file citation, a hair-split on wording, a reachability path the reviewers missed).
  The story stays in the catalog as accurate. Say what the reviewers got wrong.
- **\`real-gap\`** — a genuine product problem: capability that is missing, broken, unreachable,
  or that over-claims in a way a user would notice. This is the only class that becomes work.

Be honest in both directions. Do not inflate a wording quibble into a \`real-gap\` to make the
audit look productive, and do not wave a genuine break away as a \`false-negative\` because
fixing it would be work.

## For every \`real-gap\`, also draft an issue

Give it an \`issueTitle\` (a short, plain statement of the problem — not a solution), and in the
file include an \`issueBody\`: what is wrong, what the user-visible consequence is, the specific
files involved, and how you established it. Do NOT set a priority — priority is the maintainer's
call, not yours. Do not propose an implementation plan; state the problem well.

## Your assignment

Triage these: ${ids.join(", ")}

Write your JSON to: ${OUT}/triage/chunk-${tag}.json

{"items": [{"id": "...", "classification": "...", "reasoning": "...",
            "issueTitle": "...", "issueBody": "..."}]}

(\`issueTitle\`/\`issueBody\` only for \`real-gap\`.) Then return the file path and id +
classification + issueTitle for each.`,
    { label: `triage:${tag}`, phase: "Triage", schema: TRIAGE_SCHEMA, effort: "high" },
  );
}));

const counts: Record<Classification, number> = { "stale-story": 0, "false-negative": 0, "real-gap": 0 };
const realGaps: Array<{ id: string; title: string | undefined }> = [];
let triageFailures = 0;
for (const t of triaged) {
  if (!t) { triageFailures++; continue; }
  for (const item of t.items || []) {
    counts[item.classification] = (counts[item.classification] || 0) + 1;
    if (item.classification === "real-gap") realGaps.push({ id: item.id, title: item.issueTitle });
  }
}

if (triageFailures) log(`INCOMPLETE: ${triageFailures} triage chunk(s) failed`);
log(`Triage: ${counts["stale-story"]} stale stories, ${counts["false-negative"]} false negatives, ${counts["real-gap"]} real gaps`);

// ---------------------------------------------------------------------------
// Field notes — the browser agents reported problems they hit while driving the
// app, whether or not any story covered them. Broken image rotation, a silent
// wrong-commit deep link, a raw-JSON 404 on a logged-out deep link. That is the
// most valuable output of the whole run and none of it is a story, so nothing
// downstream would otherwise pick it up.
// ---------------------------------------------------------------------------

phase("Field notes");

/** One problem an agent hit while driving the app, and what to do about it. */
interface FieldDefect {
  title: string
  disposition: "file-issue" | "already-filed" | "harness-artifact" | "not-a-defect"
  existingIssue?: string
}

interface FieldNotes {
  file: string
  defects: FieldDefect[]
}

const FIELD_SCHEMA: WorkflowJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["file", "defects"],
  properties: {
    file: { type: "string" },
    defects: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "disposition"],
        properties: {
          title: { type: "string" },
          disposition: {
            type: "string",
            enum: ["file-issue", "already-filed", "harness-artifact", "not-a-defect"],
          },
          existingIssue: { type: "string" },
        },
      },
    },
  },
};

const fieldNotes = await agent<FieldNotes>(
  `You are turning field observations into issue-queue entries. Repository root: ${ROOT}.

Agents drove the running callback-box app to check user stories. While doing that they recorded
problems they hit — in a \`pageNotes\` field — whether or not any story covered them. Read the
\`pageNotes\` (and any \`failed\` check notes) from every file in \`${OUT}/browser/\`.

Pull out each DISTINCT defect. Then, for each one:

1. **Verify it against the code.** The observer saw a symptom; find the cause, or establish that
   you cannot. A defect you cannot locate in the code is still worth filing — say so plainly.
2. **Check whether it is already filed.** Search \`issues/\` (all category subdirectories,
   including \`closed/\`). The queue conventions are in \`issues/CLAUDE.md\` — read that first.
   Watch for near-misses: an existing issue about image EXIF orientation may or may not be the
   same bug as one about a \`rotation\` frontmatter field rendering upside-down.
3. **Decide a disposition:**
   - \`file-issue\` — a real defect, not already filed. Write the issue file.
   - \`already-filed\` — name the existing issue path in \`existingIssue\`.
   - \`harness-artifact\` — an artifact of how the check ran, not a product defect. Several
     observations are explicitly this: two agents shared one browser profile and stomped each
     other's navigation, and \`bin/browse\` authenticates with a key that is NOT the box owner, so
     owner-gated features returned 403. Do not file those as product bugs.
   - \`not-a-defect\` — expected behaviour, or dev-only surface working as intended.

## Writing the issues

For each \`file-issue\`, write a file to \`issues/bugs/2026-08-21-<slug>.md\` following the
conventions in \`issues/CLAUDE.md\` exactly — frontmatter with \`title\`, and the body stating what
is wrong, the user-visible consequence, the files involved, and how it was observed.

- **Do NOT set \`priority:\`** — that is the maintainer's call, not yours.
- Set \`filed-by: agent\` and \`discovered-in: worktree-user-stories-refresh\`.
- Set \`stories: [<the story id>]\` in the frontmatter, so closing the issue leads back to the
  claim it invalidates.
- **End the issue with the catalog-update footer below, filled in with this story's id.** Whoever
  fixes this will not know the catalog exists; the instruction has to be where they are working.

## The footer (copy verbatim, substituting the id)

\`\`\`markdown
## Updating the user-story catalog

This issue is why \\\`<STORY-ID>\\\` is currently flagged ❌ in
[the user-story catalog](../../callback-box/user-stories/catalog/<DATE>.md) — a catalogue of what
callback-box can actually do, where every claim is checked against the source.

**When you fix this, re-check that story so the catalog stops being wrong.** It is a short agent
run over just the affected stories, not the full regeneration:

    pnpm --dir callback-box build:workflows   # the .mjs is generated

    Workflow({scriptPath: "callback-box/dist/workflows/recheck.workflow.mjs",
              args: {root: "<repo root>", date: "<DATE>", ids: ["<STORY-ID>"]}})

    pnpm exec tsx callback-box/user-stories/pipeline/apply-recheck.ts <DATE>
    pnpm exec tsx callback-box/user-stories/pipeline/render.ts \\
      > callback-box/user-stories/catalog/<DATE>.md

The recheck is adversarial by design: it will not mark the story accurate just because this issue
was closed — it re-reads the code. If it still refutes, that is worth knowing before you call the
fix done. Details in [the pipeline README](../../callback-box/user-stories/README.md).
\`\`\`
- State the problem; do not propose an implementation plan.
- Write in the queue's plain register. No drama, no "critical", no severity adjectives.
- If a defect is really about docs or code quality rather than a bug, use the right category
  subdirectory instead of \`bugs/\`.

Be disciplined about what counts. A console warning on a dev-only harness page is not the same
kind of thing as a deep link that silently renders the wrong commit. Filing noise costs the
maintainer more than it saves.

Write your summary JSON to: ${OUT}/triage/field-notes.json

{"defects": [{"title": "...", "disposition": "...", "existingIssue": "...", "issuePath": "...",
              "reasoning": "..."}]}

Then return the file path and title + disposition + existingIssue for each.`,
  { label: "field-notes", phase: "Field notes", schema: FIELD_SCHEMA, effort: "high" },
);

const defects = fieldNotes && fieldNotes.defects ? fieldNotes.defects : [];
const filedCount = defects.filter((d) => d.disposition === "file-issue").length;
if (!fieldNotes) log("INCOMPLETE: field-notes agent failed — browser observations not converted to issues");
log(`Field notes: ${defects.length} distinct defects, ${filedCount} filed as issues`);

// @ts-expect-error -- TS1108: the Workflow runtime wraps this script body in an async function,
// so a top-level return is how a workflow reports its result.
return {
  flaggedIn: flagged.length,
  browserFailedIn: browserFailed.length,
  panelUpheld: upheld.length,
  panelCleared: survived.length,
  panelUndecided: undecided,
  panelVoteFailures: panelFailures,
  triage: counts,
  triageFailures,
  realGaps,
  clearedIds: survived,
  fieldDefects: defects.length,
  fieldIssuesFiled: filedCount,
  fieldDefectList: defects,
};
