# Durable complete-set capture acceptance

Acceptance needs neither chat nor transcription. Its declaration is immutable,
owner scoped, and accepted only with all declared bytes.

```ts setup
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { acceptQuickCapture } from "../../../src/core/quick-capture/acceptance.js";
import { readCapture, captureDirectory, writeCapture, QuickCaptureError } from "../../../src/core/quick-capture/store.js";
import { reconcileCaptureSource } from "../../../src/core/quick-capture/source.js";
import { processCapture } from "../../../src/core/quick-capture/worker.js";
import { readFile, writeFile, rename, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const id = "11111111-1111-4111-8111-111111111111";
const imageId = "22222222-2222-4222-8222-222222222222";
const declaration = {version:1 as const,capturedAt:"2026-10-12T12:00:00Z",source:"apple-app-intents" as const,input:"Keep exact words"};
const image = {version:1 as const,capturedAt:"2026-10-12T12:00:00Z",source:"apple-share-extension" as const,input:"Find the problem",material:{kind:"image" as const,id:imageId,mimeType:"image/png" as const,byteLength:3,sha256:createHash("sha256").update("abc").digest("hex"),fileName:"screenshot.png"}};
async function staged(box) {
  const path = box.path("_tmp/upload"); await writeFile(path,"abc");
  return {path,size:3,sha256:image.material.sha256};
}
```

```ts
const box = await makeTmpBox({git:true});
await acceptQuickCapture({boxRoot:box.root,id,owner:"owner@example.test",declaration})
=> {id:"11111111-1111-4111-8111-111111111111",state:"accepted"}

await acceptQuickCapture({boxRoot:box.root,id,owner:"owner@example.test",declaration})
=> {id:"11111111-1111-4111-8111-111111111111",state:"accepted"}

await acceptQuickCapture({boxRoot:box.root,id,owner:"other@example.test",declaration})
=> throws QuickCaptureError: This capture belongs to another user.

await acceptQuickCapture({boxRoot:box.root,id,owner:"owner@example.test",declaration:{...declaration,input:"Changed"}})
=> throws QuickCaptureError: This capture ID already belongs to different content.

const raw = await readCapture(box.root,id);
[raw.state,raw.declaration.input,raw.sourceRef]
=> ["accepted","Keep exact words",null]

await box.cleanup();
```

Incomplete declarations never seal. The exact material and instructions are
preserved together, and a restart can recover materialization.

```ts
const box = await makeTmpBox({git:true});
await acceptQuickCapture({boxRoot:box.root,id,owner:null,declaration:image})
=> throws QuickCaptureError: The complete declared material was not received.

const bytes = await staged(box);
await acceptQuickCapture({boxRoot:box.root,id,owner:null,declaration:image,bytes:{...bytes,size:2}})
=> throws QuickCaptureError: The complete declared material was not received.

await readCapture(box.root,id)
=> null

await acceptQuickCapture({boxRoot:box.root,id,owner:null,declaration:image,bytes})
=> {id:"11111111-1111-4111-8111-111111111111",state:"accepted"}

const record = await processCapture({boxRoot:box.root,jev:undefined,chat:undefined},id);
[record.state,record.sourceRef,record.sourceCommitted]
=> ["needs-choice","_content/incoming/11111111-1111-4111-8111-111111111111.memo.card",true]
```

A capture with words is routed to a chat, which files it, so its source waits
in the git-ignored incoming folder: written, and not in git yet.

```ts continue
execFileSync("git",["status","--porcelain","--untracked-files=all"],{cwd:box.root,encoding:"utf8"}).split("\n").filter(Boolean)
=> []

await readFile(join(captureDirectory(box.root,id),"material"),"utf8")
=> abc

const replay = await processCapture({boxRoot:box.root,jev:undefined,chat:undefined},id);
[replay.state,replay.sourceRef]
=> ["needs-choice","_content/incoming/11111111-1111-4111-8111-111111111111.memo.card"]

await box.cleanup();
```

Identity follows a filed memo. Removing a committed source creates a terminal
Gone receipt; replay cannot recreate the old source path.

```ts
const box = await makeTmpBox({git:true});
const saved = {...declaration,input:undefined,material:{kind:"clipping" as const,text:"Quoted evidence"}};
await acceptQuickCapture({boxRoot:box.root,id,owner:null,declaration:saved});
const first = await processCapture({boxRoot:box.root,jev:undefined,chat:undefined},id);
first.state
=> saved

await writeCapture(box.root,{...first,sourceRef:"../../etc/passwd"});
await reconcileCaptureSource(box.root,id)
=> throws QuickCaptureError: The saved source reference is invalid.
await writeCapture(box.root,first);

await mkdir(box.path("_content/filed"),{recursive:true});
await rename(box.path(first.sourceRef),box.path("_content/filed/source.memo.card"));
const filed = await reconcileCaptureSource(box.root,id);
[filed.sourceRef,filed.state]
=> ["_content/filed/source.memo.card","saved"]

(await readCapture(box.root,id)).sourceRef
=> _content/filed/source.memo.card

// A duplicate elsewhere must not trigger a scan when the stored reference is valid.
const sourceText=await readFile(box.path(filed.sourceRef),"utf8");
await writeFile(box.path("_content/filed/copy.memo.card"),sourceText);
(await reconcileCaptureSource(box.root,id)).sourceRef
=> _content/filed/source.memo.card

await rm(box.path("_content/filed/copy.memo.card"));
await rm(box.path(filed.sourceRef));
await acceptQuickCapture({boxRoot:box.root,id,owner:null,declaration:saved})
=> throws QuickCaptureError: This capture was deleted. It cannot be recreated by retrying.

(await readCapture(box.root,id)).state
=> gone

await writeFile(box.path("_content/filed/copy.memo.card"),sourceText);
const terminal=await reconcileCaptureSource(box.root,id);
[terminal.state,terminal.declaration.material]
=> ["gone",null]

await box.cleanup();
```
