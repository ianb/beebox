export const meta = {
  name: 'user-stories-verify',
  description: 'Adversarially verify each catalogued story against the code, plus a live-app browser pass',
  phases: [
    { title: 'Verify', detail: 'cross-unit batches of 3, adversarial verifier per batch' },
    { title: 'Map', detail: 'assign web-ui stories to the pages that would show them' },
    { title: 'Browser', detail: 'drive the running app page by page via bin/browse' },
  ],
}

// The absolute repo root, passed in by the caller — workflow scripts have no filesystem access
// and every subagent prompt needs absolute paths. Run from a worktree and this is that worktree.
const ROOT = args && args.root
if (!ROOT) throw new Error('pass {root: "<absolute path to the repo root>"} in args')
const OUT = `${ROOT}/callback-box/user-stories/work`

// args: { root: string, batchCount: number, pages?: {slug, path, ids}[] }
// Batch membership lives in batches.json rather than in args — each verifier reads its own entry,
// which keeps a 12KB id list out of the orchestration and off every prompt.
const batchCount = (args && args.batchCount) || 0
const pages = (args && args.pages) || []

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['file', 'verdicts'],
  properties: {
    file: { type: 'string' },
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'verdict'],
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: ['accurate', 'inaccurate'] },
        },
      },
    },
  },
}

phase('Verify')

const VERIFIER = `You are an adversarial verifier. Repository root: ${ROOT}.

Someone else wrote user stories claiming the callback-box product has certain capabilities, and
cited source files as evidence. Your job is to REFUTE them against the actual code.

## Stance

**Refute when uncertain.** If you cannot establish from the code that the story is true as
written, the verdict is \`inaccurate\`. Do not give the benefit of the doubt, do not assume a
capability exists because it would be reasonable for it to exist, and do not accept a cited file
as proof that it does what the story says — open it and check.

A downstream triage step re-examines everything you mark \`inaccurate\`, so a conservative
false refusal is cheap. Wrongly confirming a story is expensive: it puts a false claim into a
document people are meant to trust.

## What makes a story \`inaccurate\`

- The capability does not exist in the code at all.
- The cited files do not implement it (wrong files, moved files, files that do something else).
- The code implements something NARROWER than the story claims — read the "so that" clause and
  the qualifiers literally. An over-claim is inaccurate.
- The path exists but nothing reachable calls it: no route, no command, no UI entry point.
- It is gated off by a flag, a config default, or an unmet condition, so a user cannot get it.

## What does NOT make a story inaccurate

- Imperfect wording that still describes what the code does.
- A cited file that is one of several implementing files rather than the only one.
- Your opinion that the feature is poorly designed.

## Your note

For every verdict, write 2-5 sentences of note naming the specific code you read — file paths,
function or component names, the route or command. When refuting, say **what the code actually
does instead**. Someone must be able to check your work from the note alone.

## Output

Your batch index is given below. Read \`${OUT}/batches.json\` and take the entry at that index of
its \`batches\` array — those are your story ids. Then read those stories from
\`${OUT}/stories.final.json\` (match on \`id\`).

The stories in a batch come from three DIFFERENT readers and are unrelated to each other. Verify
each on its own evidence, and do not let your conclusion about one influence another.

Write your JSON to the file path given, in exactly this shape:

{"verdicts": [{"id": "...", "verdict": "accurate"|"inaccurate", "note": "..."}]}

Then return the file path and just the id + verdict for each. Keep notes in the file only.`

const verifyResults = await parallel(Array.from({ length: batchCount }, (_, i) => () => {
  const tag = String(i + 1).padStart(4, '0')
  return agent(
    `${VERIFIER}

## Your assignment

**Batch index ${i}** — read \`${OUT}/batches.json\` and verify the ids in \`batches[${i}]\`.

Write your JSON to: ${OUT}/verdicts/batch-${tag}.json`,
    { label: `verify:${tag}`, phase: 'Verify', schema: VERDICT_SCHEMA },
  )
}))

let accurate = 0
let inaccurate = 0
let verifyFailures = 0
const flagged = []
for (const r of verifyResults) {
  if (!r) { verifyFailures++; continue }
  for (const v of r.verdicts || []) {
    if (v.verdict === 'accurate') accurate++
    else { inaccurate++; flagged.push(v.id) }
  }
}

if (verifyFailures) log(`INCOMPLETE: ${verifyFailures} verify batch(es) failed — those stories have NO verdict`)
log(`Verify: ${accurate} accurate, ${inaccurate} flagged of ${accurate + inaccurate}`)

// ---------------------------------------------------------------------------
// Browser pass — what actually renders in the running app beats what the code
// appears to say. Verdicts here override code verdicts downstream.
// ---------------------------------------------------------------------------

phase('Browser')

const BROWSER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['file', 'checks'],
  properties: {
    file: { type: 'string' },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'status'],
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['confirmed', 'failed', 'inconclusive'] },
        },
      },
    },
  },
}

phase('Map')

const MAP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['file', 'pages'],
  properties: {
    file: { type: 'string' },
    pages: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['slug', 'path', 'ids'],
        properties: {
          slug: { type: 'string', description: 'short kebab-case name, used as a filename' },
          path: { type: 'string', description: 'app path to open, e.g. /dashboard' },
          ids: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

let resolvedPages = pages

if (resolvedPages.length === 0) {
  const mapped = await agent(
    `You are planning a browser verification pass. Repository root: ${ROOT}.

Read the frontend route table at \`callback-box/src/frontend/src/router.tsx\` — that is the
definitive list of pages the app serves. Then read \`${OUT}/stories.final.json\` and take the
stories whose \`audience\` is \`web-ui\`.

Assign each web-ui story to **the single page where someone would go to do it**. Produce one entry
per page that has at least one story.

- \`path\` is the app path only — \`/dashboard\`, \`/chats\`, \`/browse\`. No worktree prefix and no
  box name; the browse tool adds those itself.
- Use real paths from the route table. A path that does not exist wastes an agent.
- A story not tied to any one page (a global shortcut, something in the app shell or nav) goes on
  the page where it is most easily observed. Just pick one.
- Do not assign a story to more than one page.
- Skip stories that plainly cannot be checked in a headless browser: needs a real camera or
  microphone, needs a physical phone, needs an OAuth round-trip to Google, or needs the box to hold
  data it does not have. Leaving a story unassigned is better than sending an agent to fail.

Aim for pages of manageable size. If one page would carry more than about 25 stories, split it into
two entries with the same \`path\` and different \`slug\`s (\`chat-1\`, \`chat-2\`).

Write your JSON to: ${OUT}/pages.json

{"pages": [{"slug": "dashboard", "path": "/dashboard", "ids": ["..."]}]}

Then return the file path and the pages.`,
    { label: 'map-pages', phase: 'Map', schema: MAP_SCHEMA, effort: 'high' },
  )

  if (!mapped) {
    log('INCOMPLETE: page mapping failed — skipping the browser pass entirely')
  } else {
    resolvedPages = mapped.pages || []
    const assigned = resolvedPages.reduce((n, pg) => n + pg.ids.length, 0)
    log(`Map: ${assigned} web-ui stories across ${resolvedPages.length} pages`)
  }
}

let confirmed = 0
let browserFailed = 0
let inconclusive = 0
let browserAgentFailures = 0

if (resolvedPages.length > 0) {
  const browserResults = await parallel(resolvedPages.map((p) => () => agent(
    `You are checking user stories against the RUNNING callback-box app, not against its source.

Repository root: ${ROOT}. You are in the \`user-stories-refresh\` worktree.

## How to drive the app

Use \`bin/browse\` (the repo's wrapper around agent-browser). Write app paths only — the
worktree and box prefix are added for you:

    bin/browse open ${p.path}
    bin/browse snapshot -i        # interactive elements as @e1, @e2 refs
    bin/browse click @e3
    bin/browse screenshot

Refs go stale after any page change — re-snapshot before each ref interaction. Never invoke
\`agent-browser\` directly. If a navigation lands on a login page, say so in your notes rather
than trying to work around it.

**Do not mutate box content destructively.** Reading, navigating, filtering, opening panels and
menus is fine. Do not delete cards, do not send chat messages that trigger long agent runs, and
do not trigger scheduled tasks. If checking a story would require a destructive action, mark it
\`inconclusive\` and say why.

## Your assignment

Page: **${p.slug}** at \`${p.path}\`

Check these stories against what the page actually does: ${p.ids.join(', ')}

Read each story from \`${OUT}/stories.final.json\` (match on \`id\`), then go see whether the running
app does it.

- \`confirmed\` — you saw it work in the app.
- \`failed\` — you drove the app and it did NOT do this: the control is missing, the page errors,
  the feature is absent, or it behaves differently than the story says.
- \`inconclusive\` — you could not reach it (needs data the box doesn't have, needs a destructive
  action, needs a device capability the headless browser lacks). This is a normal outcome; do not
  guess a verdict to avoid it.

**Report anything visibly broken you encounter even if no story covers it** — console errors,
"failed to load" states, empty regions that should have content, layout breakage. Put those in a
\`pageNotes\` field in your JSON file.

## Output

Write your JSON to: ${OUT}/browser/${p.slug}.json

{"page": "${p.slug}", "url": "...", "pageNotes": "...", "checks": [
  {"id": "...", "status": "confirmed"|"failed"|"inconclusive", "note": "what you saw"}]}

Then return the file path and id + status for each check.`,
    { label: `browse:${p.slug}`, phase: 'Browser', schema: BROWSER_SCHEMA },
  )))

  for (const r of browserResults) {
    if (!r) { browserAgentFailures++; continue }
    for (const c of r.checks || []) {
      if (c.status === 'confirmed') confirmed++
      else if (c.status === 'failed') browserFailed++
      else inconclusive++
    }
  }
  if (browserAgentFailures) log(`INCOMPLETE: ${browserAgentFailures} browser agent(s) failed`)
  log(`Browser: ${confirmed} confirmed, ${browserFailed} failed, ${inconclusive} inconclusive`)
}

return {
  verified: accurate + inaccurate,
  accurate,
  flagged: inaccurate,
  flaggedIds: flagged,
  verifyBatchFailures: verifyFailures,
  browser: { confirmed, failed: browserFailed, inconclusive, agentFailures: browserAgentFailures },
}
