# onboarding-first-days

The first real field-test scenario (`docs/implemented-plans/agent-field-tests.md`, Track 4):
Priya meets an empty box and uses it for three simulated days.

Run it with `cb field-test run onboarding-first-days`. It costs a real Opus
operator, real box agents and 2-4 hours of wall clock — it is not a CI gate and
never will be.

## What it exercises

| Item | Day | What it probes |
|---|---|---|
| `first-contact` | 1 | The empty-box first-run experience: does the app explain itself? |
| `save-recipe` | 1 | Putting a document in, in whatever way the app suggests |
| `upload-photos` | 1 | Bulk upload of four files at once, and what the box says it made of them |
| `recall-recipe` | 2 | Getting a specific fact back out, a day later |
| `dentist-email` | 2 | The connector pipeline: injected mail → sync → intake → card, and whether the user ever learns it happened |
| `whats-needed` | 3 | The payoff — does "what needs my attention?" return anything useful? |

Days advance with `pre: advance-days`, which stops the server, moves `CB_TIME`,
runs a full `cb wakeup` plus `cb tick`, and restarts. Mail arrives with
`pre: inject-email`, which appends to the run's fake-Gmail state and runs a
connector-scoped wakeup. Neither is something the operator can see or do.

Every item is `cleanup: keep` — residue is realistic, and a box that gets
messier over three days is part of what is being measured. Each item still ends
with a checkpoint tag, so any item can be inspected (or re-run from) afterwards.

## Assets — a known stand-in

`assets/lemon-chicken.txt` is real prose. The four `.jpg` files are **generated
placeholders**: a solid colour with a caption naming what the photo is supposed
to be. They are legible to a vision model and they are enough to exercise
upload, storage and filing — but they are not photographs, and a box agent
looking at one learns only what the caption says.

**A realistic asset corpus is a wanted upgrade.** Real household photos (a
handwritten recipe card, a school flyer, a receipt, a scanned form) would make
`upload-photos` and any future OCR/description behaviour genuinely testable,
and would probably change what the operator reports. Replacing them requires no
code change — drop the files in `assets/`, keep the names or update the brief.

## Checks

The four scripts in `checks/` are the spine of the run; the operator never sees
them. All are deliberately find-based and layout-tolerant — where a card lands
is the box's decision, and pinning a path here would turn a legitimate filing
choice into a test failure. What they assert is only what "it worked" must mean:
the recipe is retrievable, the photos are actually in the box, the injected mail
became a card, and the appointment surfaced somewhere beyond the raw email.
