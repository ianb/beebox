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
| `box.base` | `empty` prunes a clone to the package skeleton; or a path to clone whole |
| `box.setup` | optional shell run with `$BOX` = the content root, before the person arrives |
| `assets` | files plus a plain description of what each one is to them |
| `situation` | handed over verbatim — their life, their reason, no product words |
| `closing` | what to spend the back half of the budget on |
| `watch_for` | **for the reader of the notes. Never reaches the walker.** |

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
pnpm exec tsx callback-box/user-stories/journeys/prepare.ts B-inventory
```

That builds the box, registers it in `callback-box/.env` so the router serves it,
places the assets, composes the prompt from `walker-prompt.md`, and snapshots the box
before anyone touches it. It prints a prompt path.

**Hand that prompt to an agent with browser access.** `prepare.ts` deliberately stops
short of walking the journey: the deterministic half can then be re-run, diffed and
fixed without spending an agent, and the walk is the part that cannot be scripted
anyway.

Then:

```
pnpm exec tsx callback-box/user-stories/journeys/collect.ts B-inventory-<date>
```

Runs land in `../work/journeys/<id>-<date>/` (gitignored): the prompt as given, the
notes, screenshots, and before/after snapshots of the box.

Then read the walk and write it up — **[after-action.md](after-action.md)** is the
procedure, and `reports/<run-id>.md` is where it goes. That report is the only part of
a run that is tracked, so it is what a walk leaves behind.

Each new run supersedes the last: `prepare.ts` deletes the previous run's box and
screenshots, keeps its notes, and **refuses to run at all** if that walk has no report
— which is the point at which the evidence would be thrown away unread.

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
