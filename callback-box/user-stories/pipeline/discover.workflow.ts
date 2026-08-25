export const meta = {
  name: "user-stories-discover",
  description: "Discover user stories across callback-box: area readers, seam readers, dryness loop, bounded critics",
  phases: [
    { title: "Sweep", detail: "14 area readers + 7 seam readers, looping until dry" },
    { title: "Critics", detail: "4 bounded enumeration critics name uncatalogued capability" },
    { title: "Gaps", detail: "targeted readers close each named gap" },
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

const GROUPS = [
  "chat", "capture", "cards", "browse", "connectors", "messaging",
  "automation", "search", "knowledge", "publish", "admin", "deploy",
  "mobile", "dev", "other",
];

const GROUP_DEFS = `
- \`chat\` — conversing with the box agent: composing, sending, streaming, resuming, chat management.
- \`capture\` — getting content INTO the box: audio, photo, file upload, bulk upload, share targets, transcription.
- \`cards\` — the card model itself: schemas, card format on disk, card creation/editing/validation, refs.
- \`browse\` — exploring and organizing existing box content: browsing, viewing, renderers, views, moving, deleting.
- \`connectors\` — Gmail / Calendar / Drive sync.
- \`messaging\` — reaching the user outside the app: Telegram, push, notifications, email out.
- \`automation\` — things that run without the user asking now: schedules, wakeups, procedures, reactors, triage, retro, todo.
- \`search\` — finding things in the box.
- \`knowledge\` — what the agent knows and how it is told: agent guide, landmarks, maps, docs generation, context.
- \`publish\` — making box content visible outside the box.
- \`admin\` — auth, login, users, invites, secrets, settings, device pairing.
- \`deploy\` — installing, box lifecycle, migrations, backups, annex, hub/supervisor, health.
- \`mobile\` — capability specific to the mobile web surface or the native app bridge.
- \`dev\` — developer/maintainer tooling: scenarios, field tests, knowledge audits, dev pages.
- \`other\` — genuinely none of the above. Using this is a signal you should re-read the list; it
  should be rare. Never use it as a dumping ground.
`;

/**
 * A reader is one of two kinds, and the kind decides what it is told. An area reader owns
 * `paths` — a slice of the tree to enumerate; a seam reader owns a `thread` — a capability to
 * follow wherever it goes. The `never`s are what let `assignment()` tell them apart by asking
 * whether `thread` is there.
 */
interface AreaUnit {
  slug: string
  name: string
  paths: string
  thread?: never
}

interface SeamUnit {
  slug: string
  name: string
  thread: string
  paths?: never
}

type SweepUnit = AreaUnit | SeamUnit
type UnitKind = "area" | "seam"

const AREAS: AreaUnit[] = [
  { slug: "fe-chat", name: "Frontend — chat, composer, voice", paths: "callback-box/src/frontend/src/components/chat/, components/chat-delete/, components/chat-husk/, components/session-pickers/, callback-box/src/frontend/src/machines/, callback-box/src/frontend/src/input/, callback-box/src/frontend/src/audio/" },
  { slug: "fe-view", name: "Frontend — card views, renderers, file entries, widgets", paths: "callback-box/src/frontend/src/renderers/, callback-box/src/frontend/src/file-types/, callback-box/src/frontend/src/components/file-entries/, components/card-actions/, components/view-widgets/, components/concept-map/, components/ui/, AND every loose .tsx/.ts file directly in callback-box/src/frontend/src/components/ (there are ~42 — FileView.tsx, MarkdownCardView.tsx, WebpageView.tsx, PlacePill*.tsx, Todo*.tsx, etc.). Enumerate that directory; do not skip its root files." },
  { slug: "fe-pages", name: "Frontend — pages, dashboard, capture, landmarks, questions, admin, settings", paths: "callback-box/src/frontend/src/pages/, callback-box/src/frontend/src/components/dashboard/, components/capture/, components/bulk-upload/, components/landmarks/, components/questions/, components/history/, components/admin/, components/settings/" },
  { slug: "fe-lib", name: "Frontend — client plumbing, routing, app shell", paths: "callback-box/src/frontend/src/lib/, callback-box/src/frontend/src/hooks/, callback-box/src/frontend/src/dev/, AND the loose files directly in callback-box/src/frontend/src/: router.tsx (the route table — read it), app-shell.tsx, api.ts, api-core.ts, api-chat.ts, file-type-registry.ts, main.tsx" },
  { slug: "core-chat", name: "Core — chat, agent, agent guide", paths: "callback-box/src/core/chat/, callback-box/src/core/agent/, callback-box/src/core/agent-guide/" },
  { slug: "core-commands", name: "Core — commands, procedures, preactions, reactor", paths: "callback-box/src/core/commands/, callback-box/src/core/procedure/, callback-box/src/core/preactions/, callback-box/src/core/reactor/" },
  { slug: "core-box", name: "Core — box, growth, annex, maps, landmark, views, markdoc, plus src/lib and src/types", paths: "callback-box/src/core/box/, core/box-growth/, core/annex/, core/maps/, core/landmark/, core/views/, core/markdoc/, the loose .ts files directly in callback-box/src/core/ (there are ~81 — enumerate them), callback-box/src/lib/ (~52 files), callback-box/src/types/" },
  { slug: "core-capture", name: "Core — capture, bulk upload, transcription, mobile", paths: "callback-box/src/core/capture/, core/bulk-upload/, core/transcription/, core/mobile/" },
  { slug: "core-auto", name: "Core — schedule, retro, todo, triage, scan, search, docs-gen, secrets, external", paths: "callback-box/src/core/schedule/, core/retro/, core/todo/, core/triage/, core/scan/, core/search/, core/docs-gen/, core/secrets/, core/external/" },
  { slug: "cards-schemas", name: "Cards and schemas", paths: "callback-box/src/cards/, callback-box/src/schemas/ (enumerate every card type in the registry)" },
  { slug: "connectors", name: "Connectors — Gmail, Calendar, Drive", paths: "callback-box/src/connectors/" },
  { slug: "services", name: "Services — Google, Telegram, audio", paths: "callback-box/src/services/" },
  { slug: "webapp", name: "Web server, API, hub, publish, package exports", paths: "callback-box/src/webapp/ (routes/ and trpc/ — enumerate every route and every tRPC procedure), callback-box/src/hub/, callback-box/src/publish/, callback-box/src/shared/, callback-box/src/exports/ (the package's public entry points declared in callback-box/package.json)" },
  { slug: "cli", name: "CLI, scenarios, field tests, dev tooling", paths: "callback-box/src/cli/ (enumerate every command in cli/commands/), callback-box/src/scenario/, callback-box/src/field-test/, callback-box/src/dev/" },
];

// Cross-cutting capability threads. Area readers are told to stay in their territory, which
// systematically drops capability whose implementation spans frontend + webapp + core. These
// readers exist specifically to follow those threads end to end.
const SEAMS: SeamUnit[] = [
  { slug: "seam-capture", name: "Capture, end to end", thread: "A person captures something on a device — audio, a photo, a file, a share — and it ends up as content in the box. Follow the whole path: the capture UI, the capture session, chunked upload and retry, staleness, finalize, transcription, what card gets written, and how the user sees the result. Cross callback-box/src/frontend, src/webapp/routes, src/core/capture, src/core/bulk-upload, src/core/transcription, src/core/mobile." },
  { slug: "seam-chat", name: "Chat, end to end", thread: "A person sends a message and gets a response. Follow: composer and attachments, send, the agent SDK invocation, the emission model, streaming to the client, how messages render, coined chat ids, resuming and finding past chats, deletion, voice in and narration out. Cross src/frontend (components/chat, machines), src/webapp, src/core/chat, src/core/agent, src/shared." },
  { slug: "seam-cards", name: "Cards as markdown, end to end", thread: "A card exists as a markdown file on disk and is also a typed object in the app. Follow: schema definition, on-disk format and frontmatter, parsing and validation, refs between cards, creating and editing a card, rendering it, moving/renaming and ref rewriting, git commit. Cross src/cards, src/schemas, src/core/box, src/lib, src/frontend renderers, src/webapp." },
  { slug: "seam-automation", name: "Automation, end to end", thread: "Something happens without the user asking. Follow: schedule definition, enabling/disabling, the wakeup, what runs (procedures, reactors, triage, retro), how results reach the user (questions, notifications, telegram, push), and what the user sees afterward. Cross src/core/schedule, core/procedure, core/reactor, core/triage, core/retro, src/services, src/hub, src/frontend dashboard." },
  { slug: "seam-connectors", name: "Connector sync, end to end", thread: "A Google account is connected and its data flows into and out of the box. Follow: OAuth setup and token storage, the sync run, what cards get written, conflict handling, changes pushed back, failure/health surfacing. Cross src/connectors, src/services, src/core/secrets, src/webapp routes, src/frontend settings." },
  { slug: "seam-access", name: "Access, auth, and mobile, end to end", thread: "Getting into a box and staying in it, from a browser and from a phone. Follow: local password login, invite links, sessions and cookies, Google OAuth, device pairing and the native bridge, push subscriptions, what the mobile web surface does differently, box scoping and isolation between boxes. Cross src/webapp (auth, server-box-scope), src/hub, src/core/mobile, src/core/secrets, src/frontend." },
  { slug: "seam-publish", name: "Publish and box lifecycle, end to end", thread: "Content leaves the box, and boxes themselves are created and maintained. Follow: publish config, draft/build/render, leak scanning, Cloudflare access setup, going live; and separately box init, templates, migrations, annex, backups, health checks, the hub supervisor. Cross src/publish, src/core/box, src/core/annex, src/core/migrations and the migrate CLI, src/hub." },
];

/** The index a reader returns; the story text itself stays in the file it wrote. */
interface StoryIndexEntry {
  id: string
  title: string
  group: string
  audience: "web-ui" | "agent-scripts" | "operator"
}

interface AreaIndex {
  area: string
  file: string
  stories: StoryIndexEntry[]
}

const INDEX_SCHEMA: WorkflowJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["area", "file", "stories"],
  properties: {
    area: { type: "string" },
    file: { type: "string", description: "absolute path of the JSON file you wrote" },
    stories: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "group", "audience"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          group: { type: "string", enum: GROUPS },
          audience: { type: "string", enum: ["web-ui", "agent-scripts", "operator"] },
        },
      },
    },
  },
};

const CONTRACT = `
You are cataloguing what the callback-box product can actually do, by reading its source.
Repository root: ${ROOT}. All paths you cite must be relative to the repository root
(e.g. \`callback-box/src/core/chat/chat-session.ts\`).

## What a user story is here

One story = one distinct capability a person or their agent can actually invoke today.
Write it as: "As a <role>, I want <capability>, so that <benefit>."

- Do NOT write one story per function, file, class, or option. Aggregate to the level a
  person would describe the feature at.
- Do NOT write stories for planned, dead, commented-out, or feature-flagged-off code.
  If a code path exists but nothing reachable calls it, skip it.
- Do NOT invent benefit language the code does not support. The "so that" must follow
  from what the code does.
- Prefer specificity over grandeur: "I want to resume a chat by its coined id" beats
  "I want great chat management".

## Fields

- \`group\`: the product capability area, NOT the source directory. Pick from:
${GROUP_DEFS}
- \`audience\`: who invokes it.
  - \`web-ui\` — a person using the web app or mobile web in a browser.
  - \`agent-scripts\` — the box's own agent, a skill, a script, or the \`cb\` CLI. Most CLI
    surface is this. Do not label CLI plumbing as \`web-ui\`.
  - \`operator\` — someone installing, deploying, configuring, or maintaining a box.
- \`files\`: 1-5 repo-relative paths that implement it. Verify each path exists before citing it.
- \`evidence\`: 1-3 sentences naming the concrete code that makes the story true — the
  route, the handler, the component, the command. Someone must be able to check you.

## Output

Write your JSON to the file path given below, in exactly this shape — valid JSON, no
trailing commas, no markdown fence around it:

{"area": "<slug>", "stories": [
  {"id": "...", "title": "...", "story": "As a ..., I want ..., so that ...",
   "group": "...", "audience": "...", "files": ["..."], "evidence": "..."}
]}

Write the file even if \`stories\` is empty. Every id must be exactly as specified in your
assignment — ids are the join key for the whole pipeline and a duplicate or malformed id
breaks it.

Then return the index: area, the absolute file path you wrote, and id/title/group/audience
for each story. The index MUST list exactly the stories in the file — same ids, same order.
Do NOT return the story text, files, or evidence — those live in the file only.
`;

// ---------------------------------------------------------------------------
// Sweep: area + seam readers, each looping until a round comes back dry.
// ---------------------------------------------------------------------------

phase("Sweep");

const DRY_THRESHOLD = 3;
const MAX_ROUNDS = 4;

function assignment(unit: SweepUnit): string {
  if (unit.thread) {
    return `## Your assignment: a cross-cutting capability thread

**${unit.name}**

${unit.thread}

You are NOT scoped to one directory. Follow the capability wherever it goes. Other agents are
reading the source tree directory by directory; your job is the capability they will each see
only a fragment of. Emit stories for the thread as a user experiences it, even when the
implementation is spread across four directories.`;
  }
  return `## Your territory

**${unit.name}**

Read exhaustively within: ${unit.paths}

Enumerate the directories you are given — list the files, then read them. Do not guess from
filenames, and do not stop at the files that look interesting. Follow imports outward when you
need to understand what something does, but only emit stories for capability that lives in YOUR
territory. Separate agents cover every other area, plus cross-cutting capability threads.`;
}

/** What one reader's whole loop came to. `dry` is absent when the reader failed outright. */
interface SweepOutcome {
  slug: string
  kind: UnitKind
  rounds: number
  total: number
  failed: boolean
  dry?: boolean
}

async function sweep(unit: SweepUnit, kind: UnitKind): Promise<SweepOutcome> {
  const rounds: AreaIndex[] = [];
  let total = 0;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const prior = rounds.flatMap((r) => r.stories.map((s) => `- ${s.title}`));
    const priorBlock = round === 1
      ? ""
      : `

## What has already been found here

${prior.length} stories so far:

${prior.join("\n")}

Full detail is in the earlier JSON files at ${OUT}/areas/${unit.slug}.r*.json — read them.

Your job this round is to find what those passes MISSED. Look where earlier passes skip: error
and empty states, configuration and flags that change behaviour, secondary entry points,
admin and maintenance paths, capability reachable only from another surface, capability implied
by a schema or a route that has no obvious UI.

Emit ONLY genuinely new stories — nothing that restates or narrowly re-slices one above.
Returning zero stories is a correct and expected answer. Do NOT pad: a padded round is worse
than an empty one, because it puts noise into a catalog people are meant to trust.`;

    const result = await agent<AreaIndex>(
      `${CONTRACT}

${assignment(unit)}${priorBlock}

Give each story this round an id of the form \`${unit.slug}-r${round}-NN\` (NN zero-padded, from 01).

Write your JSON to: ${OUT}/areas/${unit.slug}.r${round}.json`,
      {
        label: `${kind}:${unit.slug}/r${round}`,
        phase: "Sweep",
        schema: INDEX_SCHEMA,
      },
    );

    if (!result) {
      log(`FAILED: ${unit.slug} round ${round} returned nothing — area is INCOMPLETE`);
      return { slug: unit.slug, kind, rounds: rounds.length, total, failed: true };
    }

    rounds.push(result);
    total += result.stories.length;

    if (result.stories.length < DRY_THRESHOLD) {
      return { slug: unit.slug, kind, rounds: round, total, failed: false, dry: true };
    }
  }

  log(`${unit.slug} still producing at round ${MAX_ROUNDS} (never went dry) — may be under-swept`);
  return { slug: unit.slug, kind, rounds: MAX_ROUNDS, total, failed: false, dry: false };
}

const units: Array<{ unit: SweepUnit; kind: UnitKind }> = [
  ...AREAS.map((a): { unit: SweepUnit; kind: UnitKind } => ({ unit: a, kind: "area" })),
  ...SEAMS.map((s): { unit: SweepUnit; kind: UnitKind } => ({ unit: s, kind: "seam" })),
];

const sweeps = await parallel(units.map(({ unit, kind }) => () => sweep(unit, kind)));

const swept = sweeps.filter((s) => s !== null);
const failedAreas = swept.filter((s) => s.failed).map((s) => s.slug);
const missing = units.length - swept.length;
const sweptTotal = swept.reduce((n, s) => n + s.total, 0);
const notDry = swept.filter((s) => !s.failed && !s.dry).map((s) => s.slug);

log(`Sweep: ${sweptTotal} stories from ${swept.length}/${units.length} units`);
if (failedAreas.length > 0) log(`INCOMPLETE units (agent failure): ${failedAreas.join(", ")}`);
if (missing > 0) log(`INCOMPLETE: ${missing} unit(s) produced no result at all`);
if (notDry.length > 0) log(`Units that never went dry: ${notDry.join(", ")}`);

// ---------------------------------------------------------------------------
// Critics: four BOUNDED enumeration checks. Each one has a finite, listable
// surface to walk, so it can be exhaustive rather than sampling.
// ---------------------------------------------------------------------------

phase("Critics");

/** A completeness critic's enumeration, and the capability it found nothing catalogued for. */
interface CriticGap {
  gap: string
  where: string
  why: string
}

interface CriticReport {
  checked: number
  gaps: CriticGap[]
}

const CRITIC_SCHEMA: WorkflowJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["checked", "gaps"],
  properties: {
    checked: { type: "integer", description: "how many items you enumerated and checked" },
    gaps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["gap", "where", "why"],
        properties: {
          gap: { type: "string" },
          where: { type: "string", description: "repo-relative paths a reader should look in" },
          why: { type: "string", description: "what makes you believe it exists and is uncatalogued" },
        },
      },
    },
  },
};

const CRITIC_BASE = `You are auditing a user-story catalog for COMPLETENESS, not accuracy.

Repository root: ${ROOT}. The product is callback-box (\`callback-box/\`).

The catalog so far is every \`*.json\` file in ${OUT}/areas/. Read the story titles and groups
from those files — you do NOT need the evidence fields, and you should not try to read every
file in the repository.

Your check is an ENUMERATION. Build the list you are asked for, walk it item by item, and for
each item decide whether the catalog covers it. Report only items with no coverage.

Report a gap only when you have concrete reason to believe the capability exists in the code
and is uncatalogued. An empty list is a valid answer. Do NOT report "the catalog could say more
about X" — report missing capability. Return \`checked\` = how many items you enumerated.`;

const critics = await parallel([
  () => agent<CriticReport>(
    `${CRITIC_BASE}

## Your enumeration: CLI commands

List every command in \`callback-box/src/cli/commands/\` and every subcommand registered in
\`callback-box/src/cli/index.ts\`. For each, check the catalog covers what it does.`,
    { label: "critic:cli", phase: "Critics", schema: CRITIC_SCHEMA, effort: "high" },
  ),
  () => agent<CriticReport>(
    `${CRITIC_BASE}

## Your enumeration: HTTP + tRPC + route surface

List (1) every tRPC router and procedure under \`callback-box/src/webapp/trpc/\`, (2) every
route registered under \`callback-box/src/webapp/routes/\` and in
\`callback-box/src/webapp/server-box-scope.ts\` / \`server-root.ts\`, and (3) every frontend
route in \`callback-box/src/frontend/src/router.tsx\`. For each, check the catalog covers the
capability it exposes.`,
    { label: "critic:routes", phase: "Critics", schema: CRITIC_SCHEMA, effort: "high" },
  ),
  () => agent<CriticReport>(
    `${CRITIC_BASE}

## Your enumeration: card types

List every card schema registered in \`callback-box/src/schemas/registry.ts\` (and the schema
files it points at). For each card type, check the catalog represents its user-facing purpose —
how it gets created, what it is for, where the user encounters it.`,
    { label: "critic:schemas", phase: "Critics", schema: CRITIC_SCHEMA, effort: "high" },
  ),
  () => agent<CriticReport>(
    `${CRITIC_BASE}

## Your enumeration: capability the docs claim

Read \`callback-box/README.md\`, the doc index at \`callback-box/docs/README.md\`, and the box
agent guide source under \`callback-box/src/core/agent-guide/\`. Build a list of every distinct
capability those documents CLAIM the product has. For each claim, check the catalog covers it.

A doc claim with no catalogued story is either a gap in the catalog or an over-claim in the
docs — report it either way, and say which you think it is.`,
    { label: "critic:docs", phase: "Critics", schema: CRITIC_SCHEMA, effort: "high" },
  ),
]);

const liveCritics = critics.filter((c) => c !== null);
if (liveCritics.length < 4) log(`INCOMPLETE: only ${liveCritics.length}/4 critics returned`);

const gaps = liveCritics.flatMap((c) => c.gaps || []);
log(`Critics enumerated ${liveCritics.reduce((n, c) => n + (c.checked || 0), 0)} items, named ${gaps.length} gaps`);

// ---------------------------------------------------------------------------
// Gaps: one reader per named gap. No silent cap.
// ---------------------------------------------------------------------------

phase("Gaps");

const GAP_CAP = 60;
if (gaps.length > GAP_CAP) {
  log(`CAPPED: ${gaps.length} gaps named, only the first ${GAP_CAP} will be worked — ${gaps.length - GAP_CAP} DROPPED`);
}
const worked = gaps.slice(0, GAP_CAP);

let gapStories = 0;
let gapFailures = 0;

if (worked.length > 0) {
  const filled = await parallel(worked.map((g, i) => () => agent<AreaIndex>(
    `${CONTRACT}

## Your assignment: close a named gap

A completeness critic reviewed the catalog and believes this capability is implemented but
uncatalogued:

**Gap:** ${g.gap}
**Look in:** ${g.where}
**Critic's reasoning:** ${g.why}

Verify that against the code FIRST. If the capability does not actually exist, or is already
covered by an existing story in ${OUT}/areas/, write a file with \`"stories": []\` — that is a
correct outcome, not a failure, and you should not manufacture a story to fill the slot.

If it does exist and is uncatalogued, emit the stories for it.

Give each story an id of the form \`gap-${String(i + 1).padStart(2, "0")}-NN\`.

Write your JSON to: ${OUT}/areas/gap-${String(i + 1).padStart(2, "0")}.json`,
    { label: `gap:${i + 1}`, phase: "Gaps", schema: INDEX_SCHEMA },
  )));

  for (const f of filled) {
    if (!f) { gapFailures++; continue; }
    gapStories += (f.stories || []).length;
  }
}

if (gapFailures) log(`INCOMPLETE: ${gapFailures} gap reader(s) failed`);
log(`Gaps added ${gapStories} stories`);

// @ts-expect-error -- TS1108: the Workflow runtime wraps this script body in an async function,
// so a top-level return is how a workflow reports its result.
return {
  units: units.length,
  unitsCompleted: swept.length - failedAreas.length,
  incompleteUnits: failedAreas,
  unitsNeverDry: notDry,
  sweepStories: sweptTotal,
  criticsReturned: liveCritics.length,
  gapsNamed: gaps.length,
  gapsWorked: worked.length,
  gapsDropped: Math.max(0, gaps.length - GAP_CAP),
  gapReaderFailures: gapFailures,
  gapStories,
  totalStories: sweptTotal + gapStories,
  outDir: `${OUT}/areas`,
};
