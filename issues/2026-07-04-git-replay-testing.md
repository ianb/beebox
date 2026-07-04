# Git-replay testing

2026-07-04 · idea, salvaged from the retired MVP implementation guide
(`implemented-plans/mvp-implementation-guide.md`).

Git gives the box time travel: every state change is a commit, so a
debugging/testing mode could check out any historical commit and re-run
processing from that state, or run twice from the same starting point and
diff the results — commits as the unit of "what happened." Scenario fixtures
(`src/scenario/`) cover the synthetic side; this is the replay-real-history
complement.

Open sub-question from the same doc: verbose logs would need to live outside
the replayed timeline so a checkout doesn't mix logs from two histories.
