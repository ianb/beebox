# Accepting an older engine's argv

`bbx upgrade` is the one place one engine drives another: after step 2 installs
the new dependency, the OLD engine's code spawns the NEW binary. An engine
built before the CLI split spawns `bbx migrate` and `bbx init`, which moved
under `bbx engine`.

Getting this wrong is not a cosmetic failure. Step 3 fails, `revertUpgrade`
rolls the box back to the pre-upgrade snapshot — code and data together — and
the box lands on the old engine again, whose upgrade code passes the same argv.
Every retry fails the same way, so a box that predates the split could never
cross it.

```ts setup
import { rewriteLegacyHandoff, legacyHandoffNotice } from "../../src/cli/legacy-argv.js";

/** argv as a spawned CLI sees it: [node, script, ...args]. */
const argv = (...args: string[]) => ["node", "bbx", ...args];
const rewritten = (...args: string[]) => rewriteLegacyHandoff(argv(...args)).argv.slice(2).join(" ");
```

The two verbs an old `bbx upgrade` hands over, with their flags and arguments
carried through untouched:

```ts
rewritten("migrate", "--apply", "--within-maintenance")
=> engine migrate --apply --within-maintenance

rewritten("init", "/home/beebox/boxes/personal")
=> engine init /home/beebox/boxes/personal
```

The rewrite is reported, so an operator reading upgrade output can see why a
command they did not type appeared:

```ts
rewriteLegacyHandoff(argv("migrate", "--apply")).rewrote
=> migrate

legacyHandoffNotice("migrate").startsWith("note: `bbx migrate` moved to `bbx engine migrate`")
=> true
```

Already-correct argv is left exactly as it was — the shim must be idempotent,
since the new engine spawns itself this way during a normal upgrade:

```ts
rewritten("engine", "migrate", "--apply")
=> engine migrate --apply

rewriteLegacyHandoff(argv("engine", "migrate")).rewrote
=> null
```

Only the first argument counts. A moved verb's name appearing as a VALUE is
data, and rewriting it would corrupt the command:

```ts
rewritten("create", "--title", "init")
=> create --title init

rewriteLegacyHandoff(argv("create", "--title", "init")).rewrote
=> null
```

An agent-surface verb is never touched, and neither is a bare invocation:

```ts
rewritten("search", "migrate")
=> search migrate

rewriteLegacyHandoff(argv()).rewrote
=> null
```

The list is deliberately the two real handoffs, not a general alias table: no
other evicted verb is accepted at the top level, because nothing else spawns
one across engine versions.

```ts
["serve", "hub", "wakeup", "boxes", "activity", "auth", "tailscale"]
  .filter((verb) => rewriteLegacyHandoff(argv(verb)).rewrote !== null)
=> []
```
