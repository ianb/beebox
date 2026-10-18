// # Durable complete-set capture acceptance
//
// Acceptance needs neither chat nor transcription. Its declaration is immutable,
// owner scoped, and accepted only with all declared bytes.

import { test } from "tap";
import "agent-doctest/tap";
import { makeTmpBox, type TmpBox } from "../../helpers/test-helpers.js";
import { invariant } from "../../../src/shared/invariant.js";
import { acceptQuickCapture } from "../../../src/core/quick-capture/acceptance.js";
import { readCapture, captureDirectory, writeCapture } from "../../../src/core/quick-capture/store.js";
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
function present<T>(value: T | null | undefined): T { invariant(value !== null && value !== undefined, "expected a value"); return value; }
async function staged(box: TmpBox) {
  const path = box.path("_tmp/upload"); await writeFile(path,"abc");
  return {path,size:3,sha256:image.material.sha256};
}

void test("line 28", async (t) => {
  // doctest:L29
  const box = await makeTmpBox({git:true});
  t.check(await acceptQuickCapture({boxRoot:box.root,id,owner:"owner@example.test",declaration}), {
    id: "11111111-1111-4111-8111-111111111111",
    state: "accepted",
  });

  // doctest:L33
  t.check(await acceptQuickCapture({boxRoot:box.root,id,owner:"owner@example.test",declaration}), {
    id: "11111111-1111-4111-8111-111111111111",
    state: "accepted",
  });

  // doctest:L36
  await t.checkThrows(async () => (await acceptQuickCapture({boxRoot:box.root,id,owner:"other@example.test",declaration})), "QuickCaptureError: This capture belongs to another user.");

  // doctest:L39
  await t.checkThrows(async () => (await acceptQuickCapture({boxRoot:box.root,id,owner:"owner@example.test",declaration:{...declaration,input:"Changed"}})), "QuickCaptureError: This capture ID already belongs to different content.");

  // doctest:L42
  const raw = present(await readCapture(box.root,id));
  await t.checkText([raw.state,raw.declaration.input,raw.sourceRef], "[\"accepted\",\"Keep exact words\",null]");

  // doctest:L46
  await box.cleanup();
});

// Incomplete declarations never seal. The exact material and instructions are
// preserved together, and a restart can recover materialization.
void test("Incomplete declarations never seal.", async (t) => {
  // doctest:L53
  const box = await makeTmpBox({git:true});
  await t.checkThrows(async () => (await acceptQuickCapture({boxRoot:box.root,id,owner:null,declaration:image})), "QuickCaptureError: The complete declared material was not received.");

  // doctest:L57
  const bytes = await staged(box);
  await t.checkThrows(async () => (await acceptQuickCapture({boxRoot:box.root,id,owner:null,declaration:image,bytes:{...bytes,size:2}})), "QuickCaptureError: The complete declared material was not received.");

  // doctest:L61
  t.check(await readCapture(box.root,id), null);

  // doctest:L64
  t.check(await acceptQuickCapture({boxRoot:box.root,id,owner:null,declaration:image,bytes}), {
    id: "11111111-1111-4111-8111-111111111111",
    state: "accepted",
  });

  // doctest:L67
  const record = present(await processCapture({boxRoot:box.root,jev:undefined,chat:undefined},id));
  t.check([record.state,record.sourceRef,record.sourceCommitted], [
    "needs-choice",
    "_content/incoming/11111111-1111-4111-8111-111111111111.doc.card",
    true,
  ]);

  // A capture with words is routed to a chat, which files it, so its source waits
  // in the git-ignored incoming folder: written, and not in git yet.

  // doctest:L76
  t.check(execFileSync("git",["status","--porcelain","--untracked-files=all"],{cwd:box.root,encoding:"utf8"}).split("\n").filter(Boolean), []);

  // doctest:L79
  t.check(await readFile(join(captureDirectory(box.root,id),"material"),"utf8"), "abc");

  // doctest:L82
  const replay = present(await processCapture({boxRoot:box.root,jev:undefined,chat:undefined},id));
  t.check([replay.state,replay.sourceRef], [
    "needs-choice",
    "_content/incoming/11111111-1111-4111-8111-111111111111.doc.card",
  ]);

  // doctest:L86
  await box.cleanup();
});

// Identity follows a filed doc. Removing a committed source creates a terminal
// Gone receipt; replay cannot recreate the old source path.
void test("Identity follows a filed doc.", async (t) => {
  // doctest:L93
  const box = await makeTmpBox({git:true});
  const saved = {...declaration,input:undefined,material:{kind:"clipping" as const,text:"Quoted evidence"}};
  await acceptQuickCapture({boxRoot:box.root,id,owner:null,declaration:saved});
  const first = present(await processCapture({boxRoot:box.root,jev:undefined,chat:undefined},id));
  t.check(first.state, "saved");

  // doctest:L100
  await writeCapture(box.root,{...first,sourceRef:"../../etc/passwd"});
  await t.checkThrows(async () => (await reconcileCaptureSource(box.root,id)), "QuickCaptureError: The saved source reference is invalid.");

  // doctest:L103
  await writeCapture(box.root,first);

  // doctest:L105
  await mkdir(box.path("_content/filed"),{recursive:true});
  await rename(box.path(present(first.sourceRef)),box.path("_content/filed/source.doc.card"));
  const filed = present(await reconcileCaptureSource(box.root,id));
  t.check([filed.sourceRef,filed.state], [
    "_content/filed/source.doc.card",
    "saved",
  ]);

  // doctest:L111
  t.check((present(await readCapture(box.root,id))).sourceRef, "_content/filed/source.doc.card");

  // doctest:L114
  // A duplicate elsewhere must not trigger a scan when the stored reference is valid.
  const sourceText=await readFile(box.path(present(filed.sourceRef)),"utf8");
  await writeFile(box.path("_content/filed/copy.doc.card"),sourceText);
  t.check(present(await reconcileCaptureSource(box.root,id)).sourceRef, "_content/filed/source.doc.card");

  // doctest:L120
  await rm(box.path("_content/filed/copy.doc.card"));
  await rm(box.path(present(filed.sourceRef)));
  await t.checkThrows(async () => (await acceptQuickCapture({boxRoot:box.root,id,owner:null,declaration:saved})), "QuickCaptureError: This capture was deleted. It cannot be recreated by retrying.");

  // doctest:L125
  t.check((present(await readCapture(box.root,id))).state, "gone");

  // doctest:L128
  await writeFile(box.path("_content/filed/copy.doc.card"),sourceText);
  const terminal=present(await reconcileCaptureSource(box.root,id));
  await t.checkText([terminal.state,terminal.declaration.material], "[\"gone\",null]");

  // doctest:L133
  await box.cleanup();
});
