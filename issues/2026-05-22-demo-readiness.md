---
area: callback-box
---

# Demo readiness

Triggered by an opportunity to show callback box live that came up before either the system *or* a prepared narrative was ready for it. Two distinct gaps worth thinking about:

**The system's demo-readiness.** Right now a fresh box is empty and a real box is full of personal/private content — neither demos well. There's no middle state. Worth thinking about: a "demo box" preset that seeds a plausible, non-private starter set (inbox items, a couple of guides, a few cards in store/, a scheduled task or two) so the UI has something to show without exposing real data. Could be a `cb init --demo` flag, a separate `~/src/boxes/demo/` checked in somewhere, or a scenario fixture (see `src/scenario/`) that boots one on demand. The connector story is the hard part — most of the interesting flow involves email/RSS/calendar, none of which seed believably without either real credentials or canned fixtures.

**My demo-readiness.** Independent of the system: a short demo needs a script, a known-good golden path, and at least one rehearsed "here's where it gets interesting" moment. The instinct to show "everything" in five minutes is the failure mode. Probably worth keeping a `docs/demo-script.md` or similar — even a stub — so the next opportunity isn't a cold start. Also: a list of things that *don't* yet work well enough to show, so I can route around them without discovering live.

Neither is urgent until the next opportunity. But the friction is reusable — the same gap will appear every time.
