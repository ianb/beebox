export const meta = {
  name: 'user-stories-recheck',
  description: 'Re-verify specific catalogued capabilities against current code, after a fix',
  phases: [
    { title: 'Verify', detail: 'one adversarial verifier per story' },
    { title: 'Panel', detail: 'three lenses on anything still flagged' },
  ],
}

// args: { root: string, date: string, ids: string[] }
//
// The full pipeline is a ~3.5 hour, ~420-agent run — nobody re-runs that because one bug got
// fixed, so without this the catalog rots from the day it is committed. This re-checks only the
// stories a fix touched, using the same adversarial stance as the full run, and writes results
// `apply-recheck.ts` merges back into the frozen catalog.
const ROOT = args && args.root
if (!ROOT) throw new Error('pass {root: "<absolute path to the repo root>"} in args')
const DATE = (args && args.date) || ''
const IDS = (args && args.ids) || []
if (IDS.length === 0) throw new Error('pass {ids: ["group/slug", ...]} in args')

const CATALOG = `${ROOT}/callback-box/user-stories/catalog`
const OUT = `${ROOT}/callback-box/user-stories/work/recheck`

/** Ids contain a slash; filenames cannot. */
const safe = (id) => id.replace(/\//g, '__')

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'verdict'],
  properties: {
    id: { type: 'string' },
    verdict: { type: 'string', enum: ['accurate', 'inaccurate'] },
  },
}

const STANCE = `You are an adversarial verifier. Repository root: ${ROOT}.

A catalogued claim about what this product can do is being re-checked because the code changed —
usually because a bug it described was fixed. Decide whether the claim is true of the code **as it
stands now**.

## Stance

**Refute when uncertain.** If you cannot establish from the code that the story is true as written,
the verdict is \`inaccurate\`. Do not assume a fix landed because an issue says it should have. Do
not accept a cited file as proof it does what the story says — open it and check.

A story is \`inaccurate\` when: the capability is absent; the cited files do not implement it; the
code does something NARROWER than the wording claims (read the "so that" clause literally); nothing
reachable calls it; or a flag or default puts it out of reach.

It is NOT inaccurate for imperfect wording that still describes what the code does, or because one
of several implementing files is cited.

Write 2-5 sentences naming the specific code you read. When refuting, say what the code does
instead. Someone must be able to check you from the note alone.`

phase('Verify')

const verified = await parallel(IDS.map((id) => () => agent(
  `${STANCE}

## Your assignment

Read the story with \`"id": "${id}"\` from \`${CATALOG}/${DATE}.jsonl\` (one JSON object per line).
That record also carries the previous verdict and, if it was flagged before, the earlier panel
notes — read them, then reach your own conclusion from the current code.

Write your JSON to: ${OUT}/${safe(id)}.verdict.json

{"id": "${id}", "verdict": "accurate"|"inaccurate", "note": "..."}

Then return the id and verdict.`,
  { label: `recheck:${id}`, phase: 'Verify', schema: VERDICT_SCHEMA },
)))

const stillFlagged = []
let accurate = 0
let failures = 0
for (const v of verified) {
  if (!v) { failures++; continue }
  if (v.verdict === 'accurate') accurate++
  else stillFlagged.push(v.id)
}
if (failures) log(`INCOMPLETE: ${failures} recheck(s) failed — those stories keep their old verdict`)
log(`Recheck: ${accurate} now accurate, ${stillFlagged.length} still flagged`)

// ---------------------------------------------------------------------------
// Same three lenses as the full run, and the same combining rule: ANY refutation
// upholds the flag, because the lenses test separate necessary conditions.
// ---------------------------------------------------------------------------

phase('Panel')

const LENSES = [
  { key: 'exists', brief: 'Ignore reachability and wording. Ask only: is there real, live code implementing this, connected to the rest of the system? Dead code nothing references does not count.' },
  { key: 'reachable', brief: "Assume it exists and works. Ask only: can the story's stated role reach it? Trace a real entry point — a route, a rendered control, a registered command, a trigger. Say what it is, or that there isn't one." },
  { key: 'wording', brief: 'Assume it exists and is reachable. Read the wording literally, every qualifier and the "so that" clause. Ask only: does the code deliver that, or something narrower?' },
]

const REFUTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'lens', 'refuted'],
  properties: {
    id: { type: 'string' },
    lens: { type: 'string' },
    refuted: { type: 'boolean' },
  },
}

const assignments = []
for (const id of stillFlagged) for (const lens of LENSES) assignments.push({ id, lens })

const votes = await parallel(assignments.map(({ id, lens }) => () => agent(
  `You are one of three reviewers examining one catalogued capability, each through a different
lens, none seeing the others' conclusions. Repository root: ${ROOT}.

A verifier just re-checked this story against current code and still finds it inaccurate. Read the
record with \`"id": "${id}"\` from \`${CATALOG}/${DATE}.jsonl\` and the fresh verdict note at
\`${OUT}/${safe(id)}.verdict.json\`, then judge **only your lens**.

## Your lens: ${lens.key}

${lens.brief}

If the story fails for a reason outside your lens, that is not your call — report
\`refuted: false\` and say your lens is satisfied. Refute only what you can show from the code; if
your lens cannot be settled, report \`refuted: false\` and say so.

Write your JSON to: ${OUT}/${safe(id)}.${lens.key}.json

{"id": "${id}", "lens": "${lens.key}", "refuted": true|false, "note": "2-5 sentences citing code"}

Then return id, lens, refuted.`,
  { label: `panel:${id}/${lens.key}`, phase: 'Panel', schema: REFUTE_SCHEMA },
)))

let panelFailures = 0
for (const v of votes) if (!v) panelFailures++
if (panelFailures) log(`INCOMPLETE: ${panelFailures} panel vote(s) failed`)

return {
  rechecked: IDS.length,
  nowAccurate: accurate,
  stillFlagged,
  verifyFailures: failures,
  panelFailures,
  next: `pnpm exec tsx callback-box/user-stories/pipeline/apply-recheck.ts ${DATE}`,
}
