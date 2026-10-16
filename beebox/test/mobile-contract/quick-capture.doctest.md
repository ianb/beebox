# Quick capture wire fixtures

The generic acceptance declaration preserves material roles, admits complete
inputs, and refuses empty/unknown versions or file-bearing follow-up.

```ts setup
import { readFile } from "node:fs/promises";
import { quickCaptureDeclarationSchema, quickCaptureReceiptSchema } from "../../src/shared/quick-capture.js";
async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(`./fixtures/quick-capture/${name}.json`, import.meta.url), "utf8"));
}
```

```ts
quickCaptureDeclarationSchema.parse(await fixture("text"))
=> {version:1,capturedAt:"2026-10-12T12:00:00Z",source:"apple-app-intents",input:"Phone test alpha"}

quickCaptureDeclarationSchema.parse(await fixture("image-with-words")).material
=> {kind:"image",id:"11111111-1111-4111-8111-111111111111",mimeType:"image/png",byteLength:3,sha256:"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",fileName:"screenshot.png"}

quickCaptureDeclarationSchema.parse(await fixture("clipping")).input
=> undefined

quickCaptureDeclarationSchema.parse(await fixture("context")).parentCaptureId
=> 11111111-1111-4111-8111-111111111111

quickCaptureReceiptSchema.parse(await fixture("receipt"))
=> {id:"11111111-1111-4111-8111-111111111111",state:"accepted"}

quickCaptureDeclarationSchema.safeParse(await fixture("invalid-empty")).success
=> false

quickCaptureDeclarationSchema.safeParse(await fixture("invalid-material-context")).success
=> false

quickCaptureDeclarationSchema.safeParse({version:2,capturedAt:"2026-10-12T12:00:00Z",source:"apple-app-intents",input:"hello"}).success
=> false
```


Interrupted provenance is technical audio metadata, never fabricated words.

```ts
quickCaptureDeclarationSchema.parse(await fixture("audio-interrupted")).recordingInterrupted
=> true

quickCaptureDeclarationSchema.safeParse(await fixture("invalid-interrupted-nonaudio")).success
=> false
```
