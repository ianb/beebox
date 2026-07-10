# Tours exist but the boxholder didn't know

`callback-box/test/tours/` — scripted `bin/browse` walks with desktop+mobile
passes, checkpoint screenshots, and axe accessibility runs — was built
2026-05-28 (`9a600875` "tours: scripted browser walks that produce review
artifacts") and refined over several commits. Four tours exist
(`browse-walk`, `dashboard`, `nav-pages`, `capture`). The boxholder learned
of them 2026-07-10, in passing, during the capture-mode work.

Two tensions:

1. **Doc altitude.** Tours are referenced in neither `docs/testing.md` nor
   `package.json` scripts; the only way to discover them is to open the
   directory. Either they're part of the testing story (then `testing.md`
   gets a tier entry and there's a `pnpm tour` entry point), or they're
   experimental (then say so in a README at the directory root). Related:
   the dev harness pattern (`/dev/capture-mode`, ComposerStatesHarness,
   SpeechTestHarness) is similarly convention-without-a-doc — if a
   harness-pattern doc gets written, tours are its interaction-test
   counterpart and should be covered together.

2. **Process.** Infrastructure this substantial was built in an agent
   session without registering in the boxholder's awareness. Worth a
   thought about what the "new load-bearing thing was created" signal
   should be — a CLAUDE.md/docs entry requirement at creation time is the
   obvious candidate (which is also just the doc-altitude rule applied at
   birth).
