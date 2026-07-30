# Upload wrapper

`buildUploadWrapper` builds the `<upload>` chat-message wrapper — a
chat-vocabulary lock-in, so the exact string is pinned here (parity with
`buildCaptureWrapper`). The `failed` attribute is present only when non-zero;
`bytes` is the compact human size; the body is the batch's one-line summary.

```ts setup
import { buildUploadWrapper } from "../../../src/core/bulk-upload/deliver.js";

async function catchName(fn) {
  try { await fn(); return "no-throw"; } catch (e) { return e.name; }
}
```

## A clean batch: no `failed` attribute

```ts
buildUploadWrapper({
  docPath: "store/photos/tmp-upload/upload-20260727T1400-abcd1234/Batch.upload-batch.card",
  fileCount: 34,
  totalBytes: 117440512,
  failedCount: 0,
  summary: "34 files uploaded (112 MB).",
})
=> <upload doc="store/photos/tmp-upload/upload-20260727T1400-abcd1234/Batch.upload-batch.card" files="34" bytes="112 MB">
34 files uploaded (112 MB).
</upload>
```

## A batch with failures carries `failed="N"`

```ts
buildUploadWrapper({
  docPath: "tmp-upload/b/Batch.upload-batch.card",
  fileCount: 31,
  totalBytes: 4300,
  failedCount: 3,
  summary: "31 files uploaded (4.2 KB); 3 failed.",
})
=> <upload doc="tmp-upload/b/Batch.upload-batch.card" files="31" bytes="4.2 KB" failed="3">
31 files uploaded (4.2 KB); 3 failed.
</upload>
```

## Small sizes render in bytes; the summary is trimmed

```ts
buildUploadWrapper({
  docPath: "tmp-upload/c/Batch.upload-batch.card",
  fileCount: 1,
  totalBytes: 12,
  failedCount: 0,
  summary: "  1 file uploaded (12 B).  ",
})
=> <upload doc="tmp-upload/c/Batch.upload-batch.card" files="1" bytes="12 B">
1 file uploaded (12 B).
</upload>
```

## An introduced batch carries the boxholder's words above the summary

When the batch was submitted with composer text, that text is the body's first
paragraph — it is what tells the agent the batch is introduced, so it should
file against it rather than asking what the files are.

The blank line between the two is load-bearing, so these examples compare the
JSON-escaped string — the newlines stay visible instead of being swallowed by
the expected-block parser.

```ts
JSON.stringify(buildUploadWrapper({
  docPath: "chats/2026-07-30/tmp-upload/upload-20260730T1912-9f3c1e00/Batch.upload-batch.card",
  fileCount: 70,
  totalBytes: 41943040,
  failedCount: 0,
  summary: "70 files uploaded (40 MB).",
  note: "Receipts from the Tokyo trip — file them under the 2026 travel folder.",
}))
=> "<upload doc=\"chats/2026-07-30/tmp-upload/upload-20260730T1912-9f3c1e00/Batch.upload-batch.card\" files=\"70\" bytes=\"40 MB\">\nReceipts from the Tokyo trip — file them under the 2026 travel folder.\n\n70 files uploaded (40 MB).\n</upload>"
```

## The note is body text, so quotes and newlines in it are safe

Unlike `doc`, the note is free-form user prose and can contain anything a person
types. It goes in the body precisely so it can never break attribute parsing.

```ts
JSON.stringify(buildUploadWrapper({
  docPath: "tmp-upload/d/Batch.upload-batch.card",
  fileCount: 2,
  totalBytes: 2048,
  failedCount: 0,
  summary: "2 files uploaded (2 KB).",
  note: 'These are the "before" shots.\nThe after ones come later.',
}))
=> "<upload doc=\"tmp-upload/d/Batch.upload-batch.card\" files=\"2\" bytes=\"2 KB\">\nThese are the \"before\" shots.\nThe after ones come later.\n\n2 files uploaded (2 KB).\n</upload>"
```

## No note, or a blank one, renders exactly as before

A batch submitted from an empty composer must be byte-identical to the
pre-note wrapper — that compatibility is what lets the note be purely additive.

```ts
const withoutNote = buildUploadWrapper({
  docPath: "tmp-upload/e/Batch.upload-batch.card",
  fileCount: 5, totalBytes: 500, failedCount: 0, summary: "5 files uploaded (500 B).",
});
withoutNote
=> <upload doc="tmp-upload/e/Batch.upload-batch.card" files="5" bytes="500 B">
5 files uploaded (500 B).
</upload>
```

```ts continue
const blankNote = buildUploadWrapper({
  docPath: "tmp-upload/e/Batch.upload-batch.card",
  fileCount: 5, totalBytes: 500, failedCount: 0, summary: "5 files uploaded (500 B).",
  note: "   \n  ",
});
blankNote === withoutNote
=> true
```

## A doc path with a quote or newline is a broken invariant (throws)

The `doc` path is server-generated; a quote or newline would break attribute
parsing, so it fails loudly rather than emitting an unparseable message.

```ts
await catchName(() => buildUploadWrapper({
  docPath: 'tmp-upload/"evil".card',
  fileCount: 1, totalBytes: 1, failedCount: 0, summary: "x",
}))
=> InvariantError
```

```ts continue
await catchName(() => buildUploadWrapper({
  docPath: "tmp-upload/a\nb.card",
  fileCount: 1, totalBytes: 1, failedCount: 0, summary: "x",
}))
=> InvariantError
```
