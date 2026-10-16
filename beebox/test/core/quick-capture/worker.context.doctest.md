# Explicit original capture context

Follow-up is separately accepted and ordered. A material-only parent starts
no work until human words arrive; later context follows the same fixed chat.

```ts setup
import { mkdir, rename } from "node:fs/promises";
import { makeTmpBox, type TmpBox } from "../../helpers/doctest-helpers.js";
import { invariant } from "../../../src/shared/invariant.js";
import type { QuickChatChat } from "../../../src/core/chat/routing/quick-chat-submit/submit.js";
import type { QuickChatRecord } from "../../../src/core/chat/routing/quick-chat-record.js";
import { acceptQuickCapture } from "../../../src/core/quick-capture/acceptance.js";
import { processCapture } from "../../../src/core/quick-capture/worker.js";
import { readQuickChatRecord } from "../../../src/core/chat/routing/quick-chat-store.js";
import { chooseQuickChat } from "../../../src/core/chat/routing/quick-chat-submit/submit.js";
const parent="11111111-1111-4111-8111-111111111111";
const first="22222222-2222-4222-8222-222222222222";
const second="33333333-3333-4333-8333-333333333333";
const declaration={version:1 as const,capturedAt:"2026-10-12T12:00:00Z",source:"apple-native-input" as const};
function present<T>(value: T | null | undefined): T { invariant(value !== null && value !== undefined, "expected a value"); return value; }
function offered(record: QuickChatRecord | null) {
  invariant(record?.state === "needs-choice", "expected a record waiting for a choice");
  return record;
}
function context(box: TmpBox) {
  const delivered: { id: string; session: string; words: string; sourceRef: string | undefined }[] = [];
  const chat: QuickChatChat = {
    async reserve(opts) {return {kind:"reserved" as const,sessionId:opts.sessionId};},
    async deliver(args) {delivered.push({id:args.messageId,session:args.delivery.session,words:args.message,sourceRef:args.sourceRef});return {kind:"accepted" as const,queued:false};}
  };
  return {boxRoot:box.root,jev:undefined,delivered,chat};
}
```

Context cannot bind to a missing original or another owner's capture.

```ts
const box=await makeTmpBox({git:true});
await acceptQuickCapture({boxRoot:box.root,id:first,owner:null,declaration:{...declaration,parentCaptureId:parent,input:"Explain this"}})
=> throws QuickCaptureError: Wait for the original capture to be accepted before sending context.

await acceptQuickCapture({boxRoot:box.root,id:parent,owner:"a@example.test",declaration:{...declaration,material:{kind:"url",url:"https://example.com/"}}});
await acceptQuickCapture({boxRoot:box.root,id:first,owner:"b@example.test",declaration:{...declaration,parentCaptureId:parent,input:"Explain this"}})
=> throws QuickCaptureError: This capture belongs to another user.

await box.cleanup();
```

The first words prompt routing. A later event waits until that choice is fixed
and delivery acknowledged; it then uses the same session with its own UUID.

```ts
const box=await makeTmpBox({git:true});
const ctx=context(box);
await acceptQuickCapture({boxRoot:box.root,id:parent,owner:null,declaration:{...declaration,material:{kind:"url",url:"https://example.com/"}}});
await processCapture(ctx,parent);
await acceptQuickCapture({boxRoot:box.root,id:first,owner:null,declaration:{...declaration,parentCaptureId:parent,input:"Explain this"}});
await acceptQuickCapture({boxRoot:box.root,id:second,owner:null,declaration:{...declaration,parentCaptureId:parent,input:"Compare it"}});
present(await processCapture(ctx,first)).state
=> needs-choice

present(await processCapture(ctx,second)).state
=> blocked

const choice=offered(await readQuickChatRecord(box.root,first));
await chooseQuickChat(ctx,{id:first,candidateId:present(choice.choices[0])});
present(await processCapture(ctx,first)).state
=> sent

await mkdir(box.path("_content/filed"),{recursive:true});
await rename(box.path("_content/captures/11111111-1111-4111-8111-111111111111.doc.card"),box.path("_content/filed/source.doc.card"));
const done=present(await processCapture(ctx,second));
[done.state,done.sourceRef,ctx.delivered.length]
=> ["sent","_content/filed/source.doc.card",2]

present(ctx.delivered[0]).session===present(ctx.delivered[1]).session
=> true

[present(ctx.delivered[0]).sourceRef,present(ctx.delivered[1]).sourceRef]
=> ["_content/captures/11111111-1111-4111-8111-111111111111.doc.card","_content/filed/source.doc.card"]

ctx.delivered.map(item=>item.words)
=> ["Explain this","Compare it"]

await processCapture(ctx,second);
ctx.delivered.length
=> 2

await box.cleanup();
```

A delivery whose deduplication window has ended is never sent again, even by
explicit Retry. Its retained source remains available for human reconciliation.

```ts setup
import { saveQuickChatRecord } from "../../../src/core/chat/routing/quick-chat-store.js";
import { readCapture, writeCapture } from "../../../src/core/quick-capture/store.js";
```

```ts
const box=await makeTmpBox({git:true});
const ctx=context(box);
await acceptQuickCapture({boxRoot:box.root,id:parent,owner:null,declaration:{...declaration,input:"Old thought"}});
await processCapture(ctx,parent);
const choices=offered(await readQuickChatRecord(box.root,parent));
const picked=choices.candidates.find(candidate=>candidate.id===choices.choices[0]);
await saveQuickChatRecord(box.root,{...choices,state:"sending",selected:present(picked),delivery:null,destination:{label:"Original chat"},deliveryStartedAt:"2020-01-01T00:00:00Z"});
const expired=present(await processCapture({...ctx,manualRetry:true},parent));
[expired.state,expired.sourceCommitted,ctx.delivered.length,expired.error]
=> ["failed",true,0,"This may already be in its chat. Check it before starting a new send."]

await box.cleanup();
```

Automatic recovery stops after seven days. A not-yet-delivered original can be
recovered by explicit Retry, while preserving its original UUID.

```ts
const box=await makeTmpBox({git:true});
const ctx=context(box);
await acceptQuickCapture({boxRoot:box.root,id:parent,owner:null,declaration:{...declaration,material:{kind:"url",url:"https://example.com/"}}});
const record=present(await readCapture(box.root,parent));
record.acceptedAt="2020-01-01T00:00:00Z";
await writeCapture(box.root,record);
const automatic=present(await processCapture(ctx,parent));
[automatic.state,automatic.sourceCommitted,ctx.delivered.length]
=> ["failed",null,0]

const manual=present(await processCapture({...ctx,manualRetry:true},parent));
[manual.id,manual.state,manual.sourceCommitted]
=> ["11111111-1111-4111-8111-111111111111","saved",true]

await box.cleanup();
```


Context points to the original capture, never to another context event.

```ts
const box=await makeTmpBox({git:true});
await acceptQuickCapture({boxRoot:box.root,id:parent,owner:null,declaration:{...declaration,material:{kind:"url",url:"https://example.com/"}}});
await acceptQuickCapture({boxRoot:box.root,id:first,owner:null,declaration:{...declaration,parentCaptureId:parent,input:"Original context"}});
await acceptQuickCapture({boxRoot:box.root,id:second,owner:null,declaration:{...declaration,parentCaptureId:first,input:"Nested context"}})
=> throws QuickCaptureError: Add context to an original capture, not another context event.

await box.cleanup();
```

Non-coining harnesses such as Codex assign the real chat after reserving was
unsupported. Both immediate and delayed assignment retain the same chat; a
lost completion response retries the message ID, never routes another chat.

```ts setup
import { EventEmitter } from "node:events";
import { writeFile } from "node:fs/promises";
import { setChatRuntime, clearChatRuntime, type ChatRuntime } from "../../../src/webapp/chat-runtime.js";
import type { ReserveResult } from "../../../src/core/chat/session/reserve.js";
import { ChatSessionRegistry } from "../../../src/core/chat/session/registry/core.js";
import { ChatSession } from "../../../src/core/chat/session/run/core.js";
import { createFakeChatBackend } from "../../../src/services/claude-chat/core.js";
import { plainTestPrompt } from "../../helpers/chat-session-spawner-helpers.js";
import { quickChatChat } from "../../../src/webapp/trpc/quick-chat-delivery.js";
class ScriptedLostResponse extends Error { constructor() {super("Synthetic completion response lost.");this.name="ScriptedLostResponse";} }
// A registry whose engine cannot be told a chat id, as Codex's cannot.
class UnsupportedRegistry extends ChatSessionRegistry {
  override async reserve(): Promise<ReserveResult> {return {kind:"unsupported"};}
}
class FakeSession extends ChatSession {
  readonly current: () => string | null;
  constructor(boxRoot: string, current: () => string | null) {
    super(boxRoot, {backend:createFakeChatBackend(),systemPrompt:plainTestPrompt,skipBootstrap:true});
    this.current=current;
  }
  override getSessionId() {return this.current();}
}
function codexRuntime(box: TmpBox, mode: "post-send" | "delayed" | "lost-response") {
  let assigned: string | null=null;
  const actual="44444444-4444-4444-8444-444444444444";
  const registry=new UnsupportedRegistry(box.root,{backend:createFakeChatBackend()});
  const session=new FakeSession(box.root,()=>assigned);
  const targets: string[]=[];const claims=new Set<string>();let attempts=0;
  function assign() {assigned=actual;registry.emit("session-assigned",{sessionId:actual});}
  const partial: Pick<ChatRuntime,"registry"|"resolveSendTarget"|"sendUserMessage">={
    registry,
    async resolveSendTarget(args) {targets.push(args.sessionParam);return {ok:true,target:{session,id:args.sessionParam==="new"?null:args.sessionParam}};},
    async sendUserMessage(args) {
      attempts++;
      const messageId=present(args.messageId);
      if(claims.has(messageId)) return {status:200,body:{deduplicated:true}};
      claims.add(messageId);
      if(mode!=="delayed") assign();
      if(mode==="lost-response"&&attempts===1) throw new ScriptedLostResponse();
      return {status:200,body:{turnId:"turn"}};
    },
  };
  // Cast: a deliberately partial fake; quick chat reads only the three members above, and the remaining ChatRuntime members (schedules, wiring, maintenance) are never read on this path.
  setChatRuntime(box.root,partial as ChatRuntime);
  return {ctx:{boxRoot:box.root,jev:undefined,chat:quickChatChat({boxRoot:box.root,user:null})},assign,actual,targets,claims};
}
async function chooseParent(box: TmpBox,runtime: ReturnType<typeof codexRuntime>) {
  await writeFile(box.path("_config/box.json"),JSON.stringify({agentEngine:"codex"}));
  await acceptQuickCapture({boxRoot:box.root,id:parent,owner:null,declaration:{...declaration,input:"Initial thought"}});
  await processCapture(runtime.ctx,parent);
  const options=offered(await readQuickChatRecord(box.root,parent));
  await chooseQuickChat(runtime.ctx,{id:parent,candidateId:present(options.choices[0])});
}
function fixedDestination(record: QuickChatRecord | null) {
  invariant(record?.state === "sending" || record?.state === "sent", "expected a record with a fixed destination");
  return record;
}
async function waitBound(box: TmpBox) {
  for(let n=0;n<200;n++) {
    const record=fixedDestination(await readQuickChatRecord(box.root,parent));
    if(record.destination.sessionId) return record;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  return fixedDestination(await readQuickChatRecord(box.root,parent));
}
async function acceptFollowup(box: TmpBox) {
  await acceptQuickCapture({boxRoot:box.root,id:first,owner:null,declaration:{...declaration,parentCaptureId:parent,input:"Follow up"}});
}
```

```ts
const box=await makeTmpBox({git:true});
const runtime=codexRuntime(box,"post-send");
await chooseParent(box,runtime);
const bound=await waitBound(box);
[bound.state,bound.destination.sessionId,bound.delivery?.session,bound.delivery?.exactSession]
=> ["sent","44444444-4444-4444-8444-444444444444","44444444-4444-4444-8444-444444444444",true]

await acceptFollowup(box);
present(await processCapture(runtime.ctx,first)).state
=> sent

runtime.targets
=> ["new","44444444-4444-4444-8444-444444444444"]

clearChatRuntime(box.root);
await box.cleanup();
```

```ts
const box=await makeTmpBox({git:true});
const runtime=codexRuntime(box,"delayed");
await chooseParent(box,runtime);
await acceptFollowup(box);
present(await processCapture(runtime.ctx,first)).state
=> blocked

runtime.assign();
const bound=await waitBound(box);
[bound.state,bound.destination.sessionId]
=> ["sent","44444444-4444-4444-8444-444444444444"]

present(await processCapture(runtime.ctx,first)).state
=> sent

runtime.targets
=> ["new","44444444-4444-4444-8444-444444444444"]

clearChatRuntime(box.root);
await box.cleanup();
```

```ts
const box=await makeTmpBox({git:true});
const runtime=codexRuntime(box,"lost-response");
await chooseParent(box,runtime);
const bound=await waitBound(box);
[bound.state,bound.destination.sessionId]
=> ["sending","44444444-4444-4444-8444-444444444444"]

present(await processCapture(runtime.ctx,parent)).state
=> sent

await acceptFollowup(box);
present(await processCapture(runtime.ctx,first)).state
=> sent

[runtime.targets,runtime.claims.size]
=> [["new","44444444-4444-4444-8444-444444444444","44444444-4444-4444-8444-444444444444"],2]

clearChatRuntime(box.root);
await box.cleanup();
```
