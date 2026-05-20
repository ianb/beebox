# Intake stage

`runIntake` is the first stage of the triage pipeline. It does three things
in one pass:

1. Routes fresh top-level `box/inbox/*` cards into `box/inbox/intake/`,
   leaving reserved subdirectories alone.
2. Applies each registered intake step to every file in `intake/` until
   no step changes anything (quiescent).
3. Moves the intake-complete items to `box/inbox/staged/`.

See `docs/triage-design.md` and `src/core/intake.ts`.

```ts setup
import { runIntake } from "../src/core/intake.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
```

## Routing fresh arrivals

A top-level card in `box/inbox/` gets pulled into `box/inbox/intake/`,
then (since its filename is already safe) advanced through to
`box/inbox/staged/`.

```
const box = await makeTmpBox();
await box.write("box/inbox/Note.memo.card", "<memo/>");

const result = await runIntake({ boxRoot: box.root });

JSON.stringify({
  routed: result.routed,
  applied: result.applied,
  staged: result.staged,
}, null, 2)
=>
{
  "routed": [
    "Note.memo.card"
  ],
  "applied": [],
  "staged": [
    "Note.memo.card"
  ]
}

await box.list("box/inbox")
=>
box/inbox/intake
box/inbox/staged
box/inbox/staged/Note.memo.card

await box.list("box/inbox/staged")
=>
box/inbox/staged/Note.memo.card
```

```cleanup
await box.cleanup();
```

## Filename normalization

A card with whitespace or shell-unsafe characters gets renamed; the
renamed file then advances to `staged/`.

```
const box = await makeTmpBox();
await box.write("box/inbox/Voice Memo (raw).memo.card", "<memo/>");

const result = await runIntake({ boxRoot: box.root });

JSON.stringify({
  applied: result.applied,
  staged: result.staged,
}, null, 2)
=>
{
  "applied": [
    {
      "step": "filename-normalization",
      "file": "Voice Memo (raw).memo.card",
      "newName": "Voice_Memo_raw.memo.card"
    }
  ],
  "staged": [
    "Voice_Memo_raw.memo.card"
  ]
}
```

```cleanup
await box.cleanup();
```

## Reserved subdirs are skipped

Items already sitting in `intake/`, `staged/`, or `triaged/` aren't
re-routed, and items in legacy buckets like `news/` are left alone too.

```
const box = await makeTmpBox();
await box.write("box/inbox/Fresh.memo.card", "<memo/>");
await box.write("box/inbox/news/News.news-item.card", "<news-item/>");
await box.write("box/inbox/staged/Already.memo.card", "<memo/>");

const result = await runIntake({ boxRoot: box.root });

JSON.stringify({
  routed: result.routed,
  staged: result.staged,
}, null, 2)
=>
{
  "routed": [
    "Fresh.memo.card"
  ],
  "staged": [
    "Fresh.memo.card"
  ]
}

await box.read("box/inbox/news/News.news-item.card")
=> <news-item/>

await box.read("box/inbox/staged/Already.memo.card")
=> <memo/>
```

```cleanup
await box.cleanup();
```

## Empty inbox is a no-op

```
const box = await makeTmpBox();

const result = await runIntake({ boxRoot: box.root });

JSON.stringify(result)
=> {"routed":[],"applied":[],"staged":[]}
```

```cleanup
await box.cleanup();
```
