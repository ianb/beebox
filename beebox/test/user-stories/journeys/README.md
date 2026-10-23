# Journeys

A journey is one person with one goal from their own life, and whether they can get
there. The [capability catalog](../../../docs/user-stories/catalog/2026-08-21.md) next door answers "does the
product do X"; this answers "can someone actually use it for something they wanted",
which is a different question and the catalog is structurally blind to it.

Design and rationale: [`docs/plans/user-story-journeys.md`](../../../docs/plans/user-story-journeys.md).

Journeys cover core Bee Box. A journey must not depend on a plugin such as
courseware: a plugin is opt-in, and the boxholder turns it on. The chemistry
journey (D) was retired for that reason; its definition and reports are kept
with the plugin at
[`test/plugins/courseware/journeys/D-chemistry/`](../../plugins/courseware/journeys/D-chemistry/README.md).

## Writing one

A directory with a `journey.yaml`, and `assets/` if the person carries anything:

```
journeys/
  B-inventory/
    journey.yaml
    assets/IMG_1139.jpg
```

The yaml holds the world and the words:

| Field | |
|---|---|
| `box.base` | `empty` initializes a fresh box using the current engine; base paths are refused (use `box.setup`) |
| `box.setup` | optional shell run with `$BOX` = the single box root; user files belong under `$BOX/_content`, before the person arrives |
| `box.label` | optional name of the root landmark, as the person would have named it; default "My box" (not the run slug, which reads as a test run) |
| `box.init_date` | optional local date-time (`2026-08-24T19:30:00`) for the init commit; set it when `box.setup` backdates commits, so `git log` is in order |
| `assets` | files plus a plain description of what each one is to them |
| `situation` | handed over verbatim — their life, their reason, no product words |
| `closing` | what to spend the back half of the budget on |
| `watch_for` | **for the reader of the notes. Never reaches the walker.** |

A journey is a directory: `journey.yaml`, its `assets/` (gitignored), and `reports/`,
one dated file per walk of it.

**The box is only files**, so `box.setup` can build any starting state from outside —
a few contacts they would already have, last month's receipts, a half-finished note.
Use it rather than reaching for a richer `base`: a journey should meet *this person's*
box, and a base box full of someone else's life reads as confusing rather than
realistic. That was observed, not assumed — the first pilot opened mid-sentence inside
a stranger's course and spent its first ten seconds there.

A journey whose material carries fixed dates goes stale silently: a deadline
in the past turns the story into a different one. Its `box.setup` refuses to run
outside the window it was written for (G-paperwork and H-handover do this), and
a situation without material says "in about four weeks", not a month name.

Each box also gets a **fresh git history** rather than inheriting the base's. History is
a feature of this product; the first thing in theirs should be their own arrival. It
also means `collect.ts` can read exactly what the run changed.

## Running one

```
pnpm exec tsx beebox/test/user-stories/journeys/prepare/core.ts B-inventory
```

That builds the box, registers it in `beebox/.env` so the router serves it,
places the assets, composes the prompt from `walker-prompt.md`, and snapshots the box
before anyone touches it. It prints a prompt path.

**Hand that prompt to an agent with browser access.** `prepare.ts` deliberately stops
short of walking the journey: the deterministic half can then be re-run, diffed and
fixed without spending an agent, and the walk is the part that cannot be scripted
anyway.

Then:

```
pnpm exec tsx beebox/test/user-stories/journeys/collect.ts B-inventory-<date>
```

Runs land in `user-stories-work/journeys/<id>-<date>/` at the monorepo root (gitignored): the
prompt as given, the `journey.yaml` it was built from, the notes, screenshots, and before/after
snapshots of the box (`before.json` also names the harness commit). It sits outside
`beebox/` because a box's `node_modules/beebox` links to this checkout's `beebox/`, and the box
agent must not find the walker's notes.

Then read the walk and write it up — **[after-action.md](after-action.md)** is the
procedure, and `<journey>/reports/<date>.md` is where it goes. That report is the only part of
a run that is tracked, so it is what a walk leaves behind.

Each run has a unique lowercase box slug and a fresh initialization history.
`prepare.ts` preserves all earlier boxes, screenshots, notes, and snapshots, and
**refuses to run** if an earlier walk has notes but no nonempty report. It never
deletes transcripts outside a box. Retention cleanup is a separate operator decision.

Provisioning checks the dashboard health results, then requires app navigation at
the expected URL through `bin/browse` before handing out the prompt. A worktree server
that was already warm does not see the newly registered box, and the check fails
with "Fixture did not render its app navigation". When no other walk is live on the
worktree, `bin/workstreams down <worktree>` and an HTTP request cold-start it with the
new registration; prepare several journeys first, then cold-start once. A failed check
leaves its evidence intact; it does not restart the shared router. No model turn is
needed for this check.

Screenshots need an awake display. With the Mac's display asleep (an
unattended or overnight run), `bin/browse screenshot` hangs on
`Page.captureScreenshot` while every other action works, and the walk comes back
with no screenshots (the retired chemistry journey, 2026-10-09). Hold the display awake for the
whole run before starting walkers.

Timing joins the Claude transcripts of the box's root chat and place chats to the
box's `.beebox/hub-child.log`. Per turn, `collect.ts` reports seconds from the hub's
"Sending message" to the first text, to the first text that is not interim, and to
"Turn complete". Interim means a progress line: the turn called a tool after it, or
it followed the silent-turn reminder and more text came later. Without a hub match
the turn starts at the transcript's user message. Sessions in the box's usage
manifest (chat-title and other engine agent runs) are not chat turns and are skipped.
`before.json` records how many other journey runs were live (prepared, not collected,
under 12 hours old) and the 1-minute load average; `after.json` records both again.
Walks that share a server slow each other, so compare timings only at similar load.
Missing timing is unavailable, not zero waiting; Codex waits must be reported
separately from observed browser evidence.

The prompt gives the walker the machine's local date and time. A journey whose closing
needs a real clock days or weeks ahead cannot get it; word the closing around
"the next two weeks" instead of acting from a later date.

## Assets

Reviewed photographs are committed (B-inventory's two tray photos). Anonymized mail
derived from a real family's inbox stays out until the boxholder has read it; its
`assets/` directory is gitignored (`.gitignore` names each one). Either way, keep asset
content out of reports and issues. `prepare.ts` fails naming any asset that is absent, so
a journey is never half-provisioned by a missing file.

## The rules that make the output worth reading

- **The walker knows one sentence** — that this is an AI-powered app for organising your
  life — and no product vocabulary, no routes, no source, no docs, no catalog.
- **Asking the assistant is a first-class path**, not cheating. In the first pilot it
  was the *only* path that worked, which is itself the finding.
- **They push through.** Confusion gets recorded and worked around. Giving up is a last
  resort; a capable model that sees a flaw, notes it, and carries on is worth more than
  a clean early exit.
- **They do not judge their own success.** `collect.ts` reads the box to see what
  actually landed, because someone who believes they filed their stuff and did not is a
  finding.
- **Notes stay in character and loose.** A later pass turns them into issues; stopping
  mid-walk to write a bug report distorts the walk.
- **Nothing the walk says is a finding until it is separately verified.** Three of the
  seven bugs the 2026-08-24 walk reported were the harness, not the app, each written
  up in good faith. That pass is [after-action.md](after-action.md).
- **Journey walks do not test microphone or voice behavior.** Do not exercise a real,
  fake, or mock microphone while walking a journey. If a mock-mic interaction is
  encountered or fails, treat it as a harness limitation and do not present it as
  product evidence; real microphone behavior belongs to a separate device-testing
  workflow.

## Scheduled work needs its own verification

Preparation creates and serves a disposable box; it does not register or drive
scheduler ticks. A valid enabled schedule is not evidence that a reminder will
arrive. A run making that claim must observe the trigger and its delivery.

The walker's phone (`phone.ts`) observes both. A walk box has
`fakeNotifications: true`, so every notification goes to a fake channel and is
logged. `phone.ts <run-dir> --wait 1w` lives through the week: every scheduled
occurrence (reminders, repeating reminders, `runs:` work such as the todo
review) runs at its own time, in order, and then the box's clock moves a week
ahead (`.beebox/clock-offset.json`). The server, the agent, commit dates, and
the app's displayed dates read the later time, so a walker can come back. Real
time still shows in a few places: session-list ages, which read file times,
and how long since the last chat turn. A stopped wait resumes on the next
`phone.ts` call. The run directory keeps `phone.md`
([plan](../../../docs/plans/walk-simulated-time.md)).
In-process chat timers are a separate mechanism and can run while the box is
served. The recovered [lending report](A-lending/reports/2026-08-25.md) observed
one misfire, but did not verify its replacement scheduled reminder.
