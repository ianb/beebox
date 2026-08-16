---
title: "CLI output as structured streams"
workstream: unknown
area: callback-box
---

The `--deliver=webhook:url` pattern (route CLI output to a file, webhook, or stdout) is really reinventing the pipe inside the CLI. Shell already does this: process substitution + `tee` + `jq` can route different parts of a JSON stream to different destinations without the CLI knowing anything about it:

```bash
cmd | tee >(jq '.notification' | curl -d @- webhook-url) | jq '.content' > out.file
```

This only works if the CLI emits structured JSON in the first place — which is the real precondition. Once it does, `jq` + `tee` + shell become a capable router. The `--deliver` flag trades shell composability for CLI-internal routing; not obviously a win.

The harder problem `--deliver` doesn't solve: stdout is flat. If you want content to go one place, a notification to go another, and metadata to go a third, you need either multiple named output streams (not a shell primitive) or a structured envelope that the consumer splits apart. JSON streaming output is the envelope answer — but then you need the consumer to split it, which is back to shell composition.

The feedback direction (agent reports CLI friction upstream) is genuinely new — there's no pipe equivalent for that. Worth thinking about separately from delivery. — **IMPLEMENTED** as `cb feedback`: agent runs `cb feedback "<observation>"` to record CLI friction to `config/feedback/`, committed silently with session context. Collection and review via `~/src/callback/feedback-review/collect.ts`. Knowledge audit tests in `cb-feedback-*`.

Taken far enough, this stops being shell and becomes a dataflow/glue language. Which may be the right answer, but is a different design space than "CLI with better flags."
