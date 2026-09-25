# Journeys

A journey is one person with one goal from their own life, and whether they can get
there. The [capability catalog](../catalog/2026-08-21.md) next door answers "does the
product do X"; this answers "can someone actually use it for something they wanted",
which is a different question and the catalog is structurally blind to it.

Design and rationale: [`docs/plans/user-story-journeys.md`](../../docs/plans/user-story-journeys.md).

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
a stranger's chemistry course and spent its first ten seconds there.

Each box also gets a **fresh git history** rather than inheriting the base's. History is
a feature of this product; the first thing in theirs should be their own arrival. It
also means `collect.ts` can read exactly what the run changed.

## Running one

```
pnpm exec tsx beebox/user-stories/journeys/prepare.ts B-inventory
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
pnpm exec tsx beebox/user-stories/journeys/collect.ts B-inventory-<date>
```

Runs land in `../work/journeys/<id>-<date>/` (gitignored): the prompt as given, the
notes, screenshots, and before/after snapshots of the box.

Then read the walk and write it up — **[after-action.md](after-action.md)** is the
procedure, and `<journey>/reports/<date>.md` is where it goes. That report is the only part of
a run that is tracked, so it is what a walk leaves behind.

Each run has a unique lowercase box slug and a fresh initialization history.
`prepare.ts` preserves all earlier boxes, screenshots, notes, and snapshots, and
**refuses to run** if an earlier walk has notes but no nonempty report. It never
deletes transcripts outside a box. Retention cleanup is a separate operator decision.

Provisioning checks the dashboard health results, then requires app navigation at
the expected URL through `bin/browse` before handing out the prompt. A failed check
leaves its evidence intact; it does not restart the shared router. No model turn is
needed for this check.

Timing currently reads only Claude root-chat transcripts and measures from a user
message to the first assistant text, not completion. Scoped chats are excluded. Missing timing is unavailable, not zero
waiting; Codex waits must be reported separately from observed browser evidence.

## Assets are not in the repo

`journeys/*/assets/` is gitignored. The material so far is real photographs of someone's
home and mail anonymized from a real family's, and none of it enters a source-available
repository without the boxholder's review. The `journey.yaml` that needs them *is*
tracked, and `prepare.ts` fails naming any that are absent — so a journey is never
half-provisioned by a missing file.

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
In-process chat timers are a separate mechanism and can run while the box is
served. The recovered [lending report](A-lending/reports/2026-08-25.md) observed
one misfire, but did not verify its replacement scheduled reminder.
