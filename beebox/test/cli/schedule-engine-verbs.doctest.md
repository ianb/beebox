# Re-pointing scheduled commands at `bbx engine`

Boxes carry scheduled scripts whose `runs:` is a literal shell string —
`runs: bbx wakeup --connector gmail` and its siblings. When `wakeup` moved under
`bbx engine`, every one of those became a command that no longer resolves, and
the scheduler executes the string through a shell, so the box would just stop
syncing that connector.

`schedule-engine-verbs-2026-09` rewrites them. What it must not do is rewrite
anything else: these cards are hand-edited, and a migrator that reaches too far
is worse than the breakage.

```ts setup
import { repointRunsCommand } from "../../scripts/migrate/schedule-engine-verbs.js";
```

An evicted verb at the start of the command is re-pointed, and its arguments
ride along untouched:

```ts
repointRunsCommand("bbx wakeup --connector gmail")
=> bbx engine wakeup --connector gmail
```

`null` means "nothing here moved" — the migrator leaves such a card completely
alone rather than rewriting it to the same bytes:

```ts
repointRunsCommand("bbx procedure run refresh-maps")
=> null

repointRunsCommand("bbx engine wakeup --connector gmail")
=> null
```

The binary may be path-qualified, which is how the deploy's own scripts invoke
it:

```ts
repointRunsCommand("/usr/local/bin/bbx activity")
=> /usr/local/bin/bbx engine activity
```

Only a command position counts. A moved verb's NAME appearing as an argument is
data, not a command, and rewriting it would corrupt the message:

```ts
repointRunsCommand("bbx chat self-note 'bbx wakeup never ran'")
=> null
```

After a shell separator a new command begins, so a chain is handled on both
sides — including the case where only one half moved:

```ts
repointRunsCommand("bbx validate && bbx wakeup")
=> bbx validate && bbx engine wakeup

repointRunsCommand("bbx wakeup --connector gmail; bbx finalize")
=> bbx engine wakeup --connector gmail; bbx finalize
```

A leading environment assignment keeps the command position open. A
hand-edited card that sets a variable inline is exactly the case a migration
must not skip, because skipping leaves the box running a dead command:

```ts
repointRunsCommand("BBX_LOG_PROMPTS=1 bbx wakeup --connector gmail")
=> BBX_LOG_PROMPTS=1 bbx engine wakeup --connector gmail
```

An `=` inside an ordinary argument is not an assignment — it is not at a
command position, and must not reopen one:

```ts
repointRunsCommand("bbx validate --format=json && bbx wakeup")
=> bbx validate --format=json && bbx engine wakeup
```

A split family keeps its top-level name — `bbx secrets status` is still the
agent's — so the family name alone is never re-pointed:

```ts
repointRunsCommand("bbx secrets status mybox")
=> null
```

Whitespace between the binary and the verb is preserved rather than normalized,
so a diff shows only the inserted word:

```ts
repointRunsCommand("bbx   wakeup")
=> bbx   engine wakeup
```

A card still naming the retired pre-rename command is **not** this migrator's
to fix. It only recognizes a command whose program is already `bbx`, which is
why its registry entry must run after `schedule-runs-bbx-2026-09`, the
migration that repoints those. Run first, this one would pass such a card over,
and that rewrite would then leave a bare `bbx wakeup` which no longer resolves,
with neither migration willing to look at it again.

```ts
repointRunsCommand("cb wakeup --connector gmail")
=> null
```

```ts
repointRunsCommand("bbx wakeup --connector gmail")
=> bbx engine wakeup --connector gmail
```
