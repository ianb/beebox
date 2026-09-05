# `bbx attachments unignore`

The inverse of `init-gitignore`, for the git-annex migration: drop the asset
ignore block so `git add` can see assets at all. See
`src/core/commands/attachments-gitignore.ts`.

This is a **required** migration step, not a tidy-up. `annex.largefiles` is
consulted by `git add`, which never sees an ignored path — so leaving the block
in place produces a box where no asset is annexed and nothing reports it.

```ts setup
import { spawnSync } from "node:child_process";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { runInitGitignore, runUnignore } from "../../../src/core/commands/attachments-gitignore.js";

/** Minimal CommandContext: the two fields these subcommands touch. */
function ctxFor(root: string): { boxRoot: string; writeLine: (s: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { boxRoot: root, writeLine: (s: string) => lines.push(s), lines };
}

function checkIgnore(boxRoot: string, boxRelativePath: string): { ignored: boolean; rule: string } {
  const result = spawnSync(
    "git",
    ["check-ignore", "-v", "--no-index", "--", boxRelativePath],
    { cwd: boxRoot, encoding: "utf-8" },
  );
  if (result.status !== 0 && result.status !== 1) throw new Error(result.stderr);
  const source = result.stdout.split("\t")[0] ?? "";
  const rule = source.split(":").at(-1) ?? "";
  return { ignored: result.status === 0 && !rule.startsWith("!"), rule };
}
```

Starting from a box with the asset block installed, `unignore` removes the
extension patterns and leaves the capture-staging rule behind:

```ts
const box = await makeTmpBox({ git: true });
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

The broad staging rule must not swallow the committed metadata alongside the
media. The directory negation is load-bearing here: without it Git will not
re-include a manifest below a nested child `.attach/` directory.

```ts continue
await box.write("tmp-capture/cap.attach/photo-001.image.card", "card");
await box.write("tmp-capture/cap.attach/photo-001.attach/manifest.json", "{}");
await box.write("tmp-capture/cap.attach/audio-001.attach/audio-001.timing.json", "{}");
await box.write("tmp-capture/cap.attach/photo-001.attach/photo-001.jpg", "media");
[
  checkIgnore(box.root, "tmp-capture/cap.attach/photo-001.image.card"),
  checkIgnore(box.root, "tmp-capture/cap.attach/photo-001.attach/manifest.json"),
  checkIgnore(box.root, "tmp-capture/cap.attach/audio-001.attach/audio-001.timing.json"),
  checkIgnore(box.root, "tmp-capture/cap.attach/photo-001.attach/photo-001.jpg"),
]
=> [
  {
    "ignored": false,
    "rule": "!**/tmp-capture/**/*.attach/**/*.card"
  },
  {
    "ignored": false,
    "rule": "!**/tmp-capture/**/*.attach/**/manifest.json"
  },
  {
    "ignored": false,
    "rule": "!**/tmp-capture/**/*.attach/**/*.timing.json"
  },
  {
    "ignored": true,
    "rule": "**/tmp-capture/**/*.attach/**"
  }
]
```

The rule is unanchored. Delivery targets `<contextDir>/tmp-capture/`, not only
the box root, so a root-anchored rule would miss real captures and annex them
on arrival:

```ts continue
await box.write("landmarks/trip/tmp-capture/cap.attach/photo-002.jpg", "media");
checkIgnore(box.root, "landmarks/trip/tmp-capture/cap.attach/photo-002.jpg")
=> {
  "ignored": true,
  "rule": "**/tmp-capture/**/*.attach/**"
}
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

An asset rule sitting OUTSIDE the managed block is a hard failure, not a silent
pass. Marker-presence is the wrong test: a hand-edited `.gitignore` that still
ignores `.jpg` would leave those assets reaching neither git nor the annex, and
nothing else reports it.

```ts continue
await box.write(".gitignore", "**/*.attach/**/*.jpg\nnode_modules/\n");
const c4 = ctxFor(box.root);
const stray = await runUnignore(c4);
`${stray.success} ${c4.lines.join(" ").includes("outside the managed block")}`
=> false true
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

An existing annex box carrying the old managed block is refreshed in place,
so rerunning `bbx attachments unignore` is the migration path:

```ts
const stale = await makeTmpBox({ git: true });
await stale.write(
  ".gitignore",
  "# bbx-assets (managed by bbx attachments unignore)\n**/tmp-capture/**/*.attach/**\n",
);
const c = ctxFor(stale.root);
const refreshed = await runUnignore(c);
refreshed.data?.["changed"]
=> true

c.lines.join("")
=> Refreshed the git-annex block in .gitignore.

(await stale.read(".gitignore")).includes("!**/tmp-capture/**/*.attach/**/manifest.json")
=> true

await stale.cleanup();
```
