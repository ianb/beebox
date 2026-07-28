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
