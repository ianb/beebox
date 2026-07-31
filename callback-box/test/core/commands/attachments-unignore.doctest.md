# `cb attachments unignore`

The inverse of `init-gitignore`, for the git-annex migration: drop the asset
ignore block so `git add` can see assets at all. See
`src/core/commands/attachments-gitignore.ts`.

This is a **required** migration step, not a tidy-up. `annex.largefiles` is
consulted by `git add`, which never sees an ignored path — so leaving the block
in place produces a box where no asset is annexed and nothing reports it.

```ts setup
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { runInitGitignore, runUnignore } from "../../../src/core/commands/attachments-gitignore.js";

/** Minimal CommandContext: the two fields these subcommands touch. */
function ctxFor(root: string): { boxRoot: string; writeLine: (s: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { boxRoot: root, writeLine: (s: string) => lines.push(s), lines };
}
```

Starting from a box with the asset block installed, `unignore` removes the
extension patterns and leaves the capture-staging rule behind:

```ts
const box = await makeTmpBox();
const c1 = ctxFor(box.root);
await runInitGitignore(c1);
(await box.read(".gitignore")).includes("**/*.attach/**/*.jpg")
=> true
```

```ts continue
const c2 = ctxFor(box.root);
const res = await runUnignore(c2);
res.success
=> true
```

The extension patterns are gone — every asset type, not just the common ones:

```ts continue
const after = await box.read(".gitignore");
[".jpg", ".pdf", ".frozen"].some((e) => after.includes("**/*.attach/**/*" + e))
=> false
```

But capture staging stays ignored, because a pre-triage capture must not be
annexed before an agent files it:

```ts continue
after.includes("**/tmp-capture/**/*.attach/**")
=> true
```

The rule is unanchored. Delivery targets `<contextDir>/tmp-capture/`, not only
the box root, so a root-anchored rule would miss real captures and annex them
on arrival:

```ts continue
after.includes("content/tmp-capture")
=> false
```

Re-running is idempotent — it reports no change rather than stacking blocks:

```ts continue
const c3 = ctxFor(box.root);
const again = await runUnignore(c3);
c3.lines.join("")
=> Already converted for git-annex — no change.

again.data?.["changed"]
=> false
```

```ts cleanup
await box.cleanup();
```

On a box that never had the asset block (a fresh box, or one already
hand-edited), `unignore` still installs the capture-staging rule rather than
no-op'ing — the rule is required either way:

```ts
const fresh = await makeTmpBox();
const c = ctxFor(fresh.root);
await runUnignore(c);
(await fresh.read(".gitignore")).includes("**/tmp-capture/**/*.attach/**")
=> true

await fresh.cleanup();
```
