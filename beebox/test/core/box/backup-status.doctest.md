# Backup status

What of a box exists anywhere but this machine. The two pure pieces are tested
here; the git and filesystem gathering around them needs a real repo.

```ts setup
import {
  parseCountObjects,
  assessAssetRisk,
  isOffsiteRemoteUrl,
} from "../../../src/core/box/backup-status.js";
```

## Repo size comes out of `git count-objects -vH`

`-H` is the only form that reports pack size, so it hands back human units that
have to be multiplied out. Loose objects (`size`) and packs (`size-pack`) both
count; the other keys are counts, not bytes, and must not be summed in.

```ts
const output = [
  "count: 42",
  "size: 5.22 MiB",
  "in-pack: 13500",
  "packs: 2",
  "size-pack: 133.62 MiB",
  "prune-packable: 0",
  "garbage: 0",
  "size-garbage: 0 bytes",
].join("\n");
parseCountObjects(output)
=> 145584292
```

A box whose objects are all loose reports no `size-pack` line at all.

```ts
parseCountObjects("count: 3\nsize: 12.00 KiB")
=> 12288
```

Unparseable or empty output is zero rather than `NaN` — a size we could not
measure must not reach the page as "NaN bytes at risk".

```ts
parseCountObjects("")
=> 0

parseCountObjects("size: not-a-number MiB\nsize-pack: 4 QiB")
=> 0
```

## Asset risk distinguishes "no annex remote" from "not tracked at all"

These are different problems and a boxholder has to tell them apart. An annexed
box with no annex-capable remote has its filenames on GitHub and its bytes only
here — pushing harder will never move them.

```ts
assessAssetRisk({
  annex: { bytes: 10100000000, fileCount: 3026 },
  annexRemoteConfigured: false,
  untrackedAssets: { bytes: 0, fileCount: 0 },
})
=> {
  "reason": "no-annex-remote",
  "bytes": 10100000000,
  "fileCount": 3026
}
```

Give that same box a remote git-annex can send content to and there is nothing
to warn about.

```ts
assessAssetRisk({
  annex: { bytes: 10100000000, fileCount: 3026 },
  annexRemoteConfigured: true,
  untrackedAssets: { bytes: 0, fileCount: 0 },
})
=> null
```

A box with no annex is the worse case: its `*.attach/` payloads are gitignored,
so git holds not even a pointer to them.

```ts
assessAssetRisk({
  annex: null,
  annexRemoteConfigured: false,
  untrackedAssets: { bytes: 369098752, fileCount: 1072 },
})
=> {
  "reason": "not-tracked",
  "bytes": 369098752,
  "fileCount": 1072
}
```

An annexed box holding no assets yet is not at risk, even with no annex remote
— there is nothing to strand, and warning anyway trains the boxholder to ignore
the warning.

```ts
assessAssetRisk({
  annex: { bytes: 0, fileCount: 0 },
  annexRemoteConfigured: false,
  untrackedAssets: { bytes: 0, fileCount: 0 },
})
=> null
```

Same for a box with neither an annex nor any attachments — a fresh box is
quiet, not warned at.

```ts
assessAssetRisk({
  annex: null,
  annexRemoteConfigured: false,
  untrackedAssets: { bytes: 0, fileCount: 0 },
})
=> null
```

## "Offsite" means a different machine, not merely a different directory

git-annex will treat a sibling clone at a local path as a content remote, and
for its purposes that is right — the bytes really are reachable. For a backup
it is not: a local path dies with the disk. So only a remote naming a host
counts.

```ts
isOffsiteRemoteUrl("git@github.com-box-hearth:marlowe/box-hearth.git")
=> true

isOffsiteRemoteUrl("https://github.com/marlowe/box-hearth.git")
=> true

isOffsiteRemoteUrl("ssh://git@example.com/srv/box.git")
=> true
```

A path on this machine does not, in any of the forms git accepts for one.

```ts
isOffsiteRemoteUrl("/Users/me/src/boxes/hearth")
=> false

isOffsiteRemoteUrl("../sibling-box")
=> false

isOffsiteRemoteUrl("file:///Users/me/src/boxes/hearth")
=> false

isOffsiteRemoteUrl("")
=> false
```

