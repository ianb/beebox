export const meta = {
  name: "user-stories-consolidate",
  description: "Reconcile group/audience labels, then merge duplicate stories within each group",
  phases: [
    { title: "Normalize", detail: "reconcile group/audience across 21 independent readers" },
    { title: "Dedup", detail: "one merger per group finds and clusters duplicate stories" },
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
const OUT = `${ROOT}/beebox/user-stories/work`;

// args: { root: string, groups: string[] }
const groups = (args && args.groups) || [];

// ---------------------------------------------------------------------------
// Normalize first, so dedup (which works within a group) sees stories that are
// actually in the right group to be compared against each other.
// ---------------------------------------------------------------------------

phase("Normalize");

/** One reconciled label. */
interface LabelChange {
  id: string
  field: "group" | "audience"
  from: string
  to: string
}

interface NormalizeResult {
  file: string
  changes: LabelChange[]
}

const NORM_SCHEMA: WorkflowJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["file", "changes"],
  properties: {
    file: { type: "string" },
    changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "field", "from", "to"],
        properties: {
          id: { type: "string" },
          field: { type: "string", enum: ["group", "audience"] },
          from: { type: "string" },
          to: { type: "string" },
        },
      },
    },
  },
};

const norm = await agent<NormalizeResult>(
  `You are reconciling classification labels across a user-story catalog. Repository root: ${ROOT}.

Read \`${OUT}/stories.json\` — 1024 stories, each with a \`group\` (product capability area) and an
\`audience\` (web-ui / agent-scripts / operator). They were assigned by 21 independent agents who
never saw each other's work, so the labels drift.

You do not need to read every \`evidence\` field. Work from \`id\`, \`title\`, \`story\`, \`group\`,
\`audience\`. Read the story text where a title alone is ambiguous.

Find and fix:

- Stories doing materially the same KIND of thing filed under different groups. Move the outliers
  to whichever group the bulk of that cluster uses.
- Stories whose group reflects the source directory they came from rather than what the user gets
  (a chat capability filed under \`dev\` because it lives in a dev file, a capture capability filed
  under \`mobile\` because the UI is mobile-first).
- \`audience\` mislabels: \`bbx\` CLI capability marked \`web-ui\`; install, deploy, migration,
  health, or hub capability marked \`agent-scripts\` when the person doing it is an operator.

Valid groups: chat, capture, cards, browse, connectors, messaging, automation, search, knowledge,
publish, admin, deploy, mobile, dev, other.

The important axis here is **consistency**, not correctness in the abstract — two stories about
the same thing must not sit in different groups. Only propose a change you can justify from the
story text. Do NOT relabel to even out group sizes. Returning few changes is a fine outcome.

Write your JSON to: ${OUT}/normalize.json

{"changes": [{"id": "...", "field": "group"|"audience", "from": "...", "to": "...", "why": "..."}]}

Then return the file path and id/field/from/to for each (omit \`why\` from the return).`,
  { label: "normalize", phase: "Normalize", schema: NORM_SCHEMA, effort: "high" },
);

const normChanges = norm && norm.changes ? norm.changes : [];
if (!norm) log("INCOMPLETE: normalization failed — groups stay as the readers left them");
log(`Normalize: ${normChanges.length} label changes`);

// ---------------------------------------------------------------------------
// Dedup. 14 area readers and 7 seam readers deliberately overlap: a seam reader
// follows capture from device to card while three area readers each catalogue
// their slice of the same path. That was the right way to find everything; it
// means the same capability is now in the catalog two or three times.
// ---------------------------------------------------------------------------

phase("Dedup");

/** One set of stories that say the same thing, and which of them survives. */
interface DuplicateCluster {
  keep: string
  merge: string[]
}

interface DedupResult {
  group: string
  file: string
  clusters: DuplicateCluster[]
}

const DEDUP_SCHEMA: WorkflowJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["group", "file", "clusters"],
  properties: {
    group: { type: "string" },
    file: { type: "string" },
    clusters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["keep", "merge"],
        properties: {
          keep: { type: "string", description: "id of the story to keep as canonical" },
          merge: {
            type: "array",
            items: { type: "string" },
            description: "ids of duplicates folded into it (dropped from the catalog)",
          },
        },
      },
    },
  },
};

const dedup = await parallel(groups.map((g) => () => agent<DedupResult>(
  `You are merging duplicate user stories. Repository root: ${ROOT}.

Read \`${OUT}/stories.json\` and take **only the stories whose \`group\` is \`${g}\`** — but apply
the label corrections in \`${OUT}/normalize.json\` first (a story whose group was changed TO
\`${g}\` is yours; one changed AWAY from \`${g}\` is not).

## Why there are duplicates

This catalog was built by 21 readers that deliberately overlapped. Fourteen read the source tree
directory by directory. Seven followed capability end to end across directories. So one capability
— sending a chat message, say — was often catalogued three times: once by the frontend reader,
once by the core reader, once by the seam reader, each describing the slice it could see.

That overlap was how the catalog got exhaustive. Your job is to collapse it without losing
anything.

## What to merge

Merge stories that describe **the same capability from the user's point of view**, even when they
cite completely different files and use different words. "Send a typed message to the box agent",
"Send a chat message and watch the agent's turn stream back", and "Send a message and watch the
reply stream in" are one story.

## What NOT to merge

- Stories at genuinely different scopes. If one covers a capability and another covers a specific
  sub-case with its own distinct behaviour, keep both.
- Stories that share a subject but describe different actions ("attach an image" vs "paste an
  image from the clipboard" may or may not be the same — read them and decide; "attach an image"
  vs "delete an attachment" are not).
- Stories with the same title that on reading turn out to be about different things.

Under-merging is much safer than over-merging. A near-duplicate left in the catalog is untidy;
a wrongly merged pair silently deletes a real capability. When genuinely unsure, do not merge.

## Choosing the survivor

For each cluster, \`keep\` the story that describes the capability **most completely and most
accurately from the user's side** — usually, but not always, the seam reader's version, since it
saw the whole path. Prefer a story whose cited files span the real implementation over one that
cites a single component. The kept story's own text is used verbatim in the final catalog, so pick
the one you would want a reader to see.

List every other id in that cluster under \`merge\`. Their cited files are unioned into the
survivor automatically — you do not need to rewrite anything.

A story with no duplicate does not need a cluster entry. Only report actual clusters.

## Output

Write your JSON to: ${OUT}/dedup/${g}.json

{"group": "${g}", "clusters": [
  {"keep": "<id>", "merge": ["<id>", "<id>"], "why": "one line on what makes these the same"}]}

Then return the group, the file path, and keep/merge for each cluster (omit \`why\`).`,
  { label: `dedup:${g}`, phase: "Dedup", schema: DEDUP_SCHEMA, effort: "high" },
)));

let clusters = 0;
let dropped = 0;
let dedupFailures = 0;
const failedGroups: string[] = [];
for (const [i, group] of groups.entries()) {
  const d = dedup[i];
  if (!d) { dedupFailures++; failedGroups.push(group); continue; }
  for (const c of d.clusters || []) {
    clusters++;
    dropped += (c.merge || []).length;
  }
}

if (dedupFailures) log(`INCOMPLETE: dedup failed for groups: ${failedGroups.join(", ")} — those keep their duplicates`);
log(`Dedup: ${clusters} clusters, ${dropped} stories folded away`);

// @ts-expect-error -- TS1108: the Workflow runtime wraps this script body in an async function,
// so a top-level return is how a workflow reports its result.
return {
  normalizeChanges: normChanges.length,
  clusters,
  dropped,
  remaining: 1024 - dropped,
  dedupFailures,
  failedGroups,
};
