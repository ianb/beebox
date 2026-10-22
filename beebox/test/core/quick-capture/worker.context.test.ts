// # Explicit original capture context
//
// Follow-up is separately accepted and ordered. A material-only parent starts
// no work until human words arrive; later context follows the same fixed chat.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { capture, any, isoDate } from "@ianbicking/tap-check/check";
import { mkdir, rename } from "node:fs/promises";
import { makeTmpBox, type TmpBox } from "../../helpers/test-helpers.js";
import { invariant } from "../../../src/shared/invariant.js";
import type { QuickChatChat } from "../../../src/core/chat/routing/quick-chat-submit/submit.js";
import type { QuickChatRecord } from "../../../src/core/chat/routing/quick-chat-record.js";
import { acceptQuickCapture } from "../../../src/core/quick-capture/acceptance.js";
import { processCapture } from "../../../src/core/quick-capture/worker.js";
import { readQuickChatRecord } from "../../../src/core/chat/routing/quick-chat-store.js";
import { chooseQuickChat } from "../../../src/core/chat/routing/quick-chat-submit/submit.js";
import { saveQuickChatRecord } from "../../../src/core/chat/routing/quick-chat-store.js";
import { readCapture, writeCapture } from "../../../src/core/quick-capture/store.js";
import { writeFile } from "node:fs/promises";
import { setChatRuntime, clearChatRuntime, type ChatRuntime } from "../../../src/webapp/chat-runtime.js";
import type { ReserveResult } from "../../../src/core/chat/session/reserve.js";
import { ChatSessionRegistry } from "../../../src/core/chat/session/registry/core.js";
import { ChatSession } from "../../../src/core/chat/session/run/core.js";
import { ChatScheduleManager } from "../../../src/core/chat/schedules/core.js";
import { createFakeChatBackend } from "../../../src/services/claude-chat/core.js";
import { plainTestPrompt } from "../../helpers/chat-session-spawner-helpers.js";
import { quickChatChat } from "../../../src/webapp/trpc/quick-chat-delivery.js";

const parent="11111111-1111-4111-8111-111111111111";
const first="22222222-2222-4222-8222-222222222222";
const second="33333333-3333-4333-8333-333333333333";
const declaration={version:1 as const,capturedAt:"2026-10-12T12:00:00Z",source:"apple-native-input" as const};
const ACTUAL="44444444-4444-4444-8444-444444444444";
const CAPTURED_PATH="_content/captures/11111111-1111-4111-8111-111111111111.doc.card";
const INCOMING_PATH="_content/incoming/11111111-1111-4111-8111-111111111111.doc.card";
const FOLLOW_UP_DIGEST="15346d26407649b875d18bf964262a9ae75806ac1f71abc5c2905b449c3b0c83";
// The record of a follow-up capture: the original's id and the capture's words.
function followUp<const R extends object>(who: {id: string; digest: string; input: string},rest: R) {
  return {id:who.id,owner:null,digest:who.digest,declaration:{...declaration,input:who.input,parentCaptureId:parent},acceptedAt:isoDate(),attempts:0,...rest};
}
function parentRecord<const R extends object>(who: {digest: string; input: string},rest: R) {
  return {id:parent,owner:null,digest:who.digest,declaration:{...declaration,input:who.input},acceptedAt:isoDate(),attempts:0,...rest};
}
// The original capture's quick-chat record after it was routed to a new general chat.
function chatRecord<const T extends object,const R extends object>(selectedTarget: T,rest: R) {
  return {
    id:parent,
    message:"Initial thought",
    createdAt:isoDate(),
    origin:"external" as const,
    source:"apple-native-input" as const,
    sourceRef:INCOMING_PATH,
    captureInputKind:"words" as const,
    candidates:[{id:"c0",label:"New general chat",target:NEW_SESSION}],
    probabilities:{},
    preferenceApplied:false,
    selected:{id:"c0",label:"New general chat",target:selectedTarget},
    delivery:{session:ACTUAL,exactSession:true,contextDir:"",engine:"codex" as const},
    destination:{label:"New general chat",sessionId:ACTUAL},
    deliveryStartedAt:isoDate(),
    ...rest,
  };
}
const NEW_SESSION={kind:"new-session",contextDir:""} as const;
const EXISTING_SESSION={kind:"existing-session",sessionId:ACTUAL,contextDir:""} as const;
const FOLLOW_UP_SENT=followUp({id:first,digest:FOLLOW_UP_DIGEST,input:"Follow up"},{state:"sent",sourceRef:INCOMING_PATH});
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

// A delivery whose deduplication window has ended is never sent again, even by
// explicit Retry. Its retained source remains available for human reconciliation.
// Non-coining harnesses such as Codex assign the real chat after reserving was
// unsupported. Both immediate and delayed assignment retain the same chat; a
// lost completion response retries the message ID, never routes another chat.
class ScriptedLostResponseError extends Error { constructor() {super("Synthetic completion response lost.");this.name="ScriptedLostResponseError";} }
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
  const actual=ACTUAL;
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
      if(mode==="lost-response"&&attempts===1) throw new ScriptedLostResponseError();
      return {status:200,body:{turnId:"turn"}};
    },
  };
  // Quick chat reads only the three members above. The rest are inert: a schedule manager over the box's empty schedule file, no-op wiring, and maintenance that is already done.
  const runtime: ChatRuntime={
    ...partial,
    scheduleManager: new ChatScheduleManager(box.root,{onFire:()=>{}}),
    wireSession:()=>{},
    maintenance:Promise.resolve(),
  };
  setChatRuntime(box.root,runtime);
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

// Context cannot bind to a missing original or another owner's capture.
void test("Context cannot bind to a missing original or another owner's capture.", async (t) => {
  const box=await makeTmpBox({git:true});
  await t.checkThrows(async () => (await acceptQuickCapture({boxRoot:box.root,id:first,owner:null,declaration:{...declaration,parentCaptureId:parent,input:"Explain this"}})), "QuickCaptureError: Wait for the original capture to be accepted before sending context.");

  await acceptQuickCapture({boxRoot:box.root,id:parent,owner:"a@example.test",declaration:{...declaration,material:{kind:"url",url:"https://example.com/"}}});
  await t.checkThrows(async () => (await acceptQuickCapture({boxRoot:box.root,id:first,owner:"b@example.test",declaration:{...declaration,parentCaptureId:parent,input:"Explain this"}})), "QuickCaptureError: This capture belongs to another user.");

  await box.cleanup();
});

// The first words prompt routing. A later event waits until that choice is fixed
// and delivery acknowledged; it then uses the same session with its own UUID.
void test("The first words prompt routing.", async (t) => {
  const box=await makeTmpBox({git:true});
  const ctx=context(box);
  await acceptQuickCapture({boxRoot:box.root,id:parent,owner:null,declaration:{...declaration,material:{kind:"url",url:"https://example.com/"}}});
  await processCapture(ctx,parent);
  await acceptQuickCapture({boxRoot:box.root,id:first,owner:null,declaration:{...declaration,parentCaptureId:parent,input:"Explain this"}});
  await acceptQuickCapture({boxRoot:box.root,id:second,owner:null,declaration:{...declaration,parentCaptureId:parent,input:"Compare it"}});
  t.check(present(await processCapture(ctx,first)), followUp({id:first,digest:"89f4df11da04cf0c031706f67e0e3930bbbb7cf75c704985cd601b67d4cfbc83",input:"Explain this"},{state:"needs-choice",sourceRef:CAPTURED_PATH}));

  t.check(present(await processCapture(ctx,second)), followUp({id:second,digest:"937f9dde3a5e9105ce112146a31b0738b59aef5b8f948d310b010ce781767ffc",input:"Compare it"},{state:"blocked",error:"Choose a destination for the original capture before sending context."}));

  const choice=offered(await readQuickChatRecord(box.root,first));
  await chooseQuickChat(ctx,{id:first,candidateId:present(choice.choices[0])});
  t.check(present(await processCapture(ctx,first)), followUp({id:first,digest:"89f4df11da04cf0c031706f67e0e3930bbbb7cf75c704985cd601b67d4cfbc83",input:"Explain this"},{state:"sent",sourceRef:CAPTURED_PATH}));

  await mkdir(box.path("_content/filed"),{recursive:true});
  await rename(box.path("_content/captures/11111111-1111-4111-8111-111111111111.doc.card"),box.path("_content/filed/source.doc.card"));
  const done=present(await processCapture(ctx,second));
  t.check(done, followUp({id:second,digest:"937f9dde3a5e9105ce112146a31b0738b59aef5b8f948d310b010ce781767ffc",input:"Compare it"},{state:"sent",sourceRef:"_content/filed/source.doc.card"}));

  // Both events go to one session, each with its own capture id and the source path current at delivery.
  const firstSession=capture(any(String));
  const secondSession=capture(any(String));
  t.check(ctx.delivered, [
    {id:first,session:firstSession,words:"Explain this",sourceRef:CAPTURED_PATH},
    {id:second,session:secondSession,words:"Compare it",sourceRef:"_content/filed/source.doc.card"},
  ]);
  t.check(secondSession.value, firstSession.value);

  await processCapture(ctx,second);
  t.check(ctx.delivered, [
    {id:first,session:firstSession.value,words:"Explain this",sourceRef:CAPTURED_PATH},
    {id:second,session:firstSession.value,words:"Compare it",sourceRef:"_content/filed/source.doc.card"},
  ]);

  await box.cleanup();
});

void test("line 100", async (t) => {
  const box=await makeTmpBox({git:true});
  const ctx=context(box);
  await acceptQuickCapture({boxRoot:box.root,id:parent,owner:null,declaration:{...declaration,input:"Old thought"}});
  await processCapture(ctx,parent);
  const choices=offered(await readQuickChatRecord(box.root,parent));
  const picked=choices.candidates.find(candidate=>candidate.id===choices.choices[0]);
  await saveQuickChatRecord(box.root,{...choices,state:"sending",selected:present(picked),delivery:null,destination:{label:"Original chat"},deliveryStartedAt:"2020-01-01T00:00:00Z"});
  const expired=present(await processCapture({...ctx,manualRetry:true},parent));
  t.check(expired, parentRecord({digest:"4eb7264f8136d7fa4f29e4f62da109e501849cd1df3c9e57af3fc6fad7c425ee",input:"Old thought"},{
    state:"failed",
    sourceRef:INCOMING_PATH,
    sourceCommitted:true,
    error:"This may already be in its chat. Check it before starting a new send.",
  }));
  t.check(ctx.delivered, []);

  await box.cleanup();
});

// Automatic recovery stops after seven days. A not-yet-delivered original can be
// recovered by explicit Retry, while preserving its original UUID.
void test("Automatic recovery stops after seven days.", async (t) => {
  const box=await makeTmpBox({git:true});
  const ctx=context(box);
  await acceptQuickCapture({boxRoot:box.root,id:parent,owner:null,declaration:{...declaration,material:{kind:"url",url:"https://example.com/"}}});
  const record=present(await readCapture(box.root,parent));
  record.acceptedAt="2020-01-01T00:00:00Z";
  await writeCapture(box.root,record);
  const automatic=present(await processCapture(ctx,parent));
  t.check(automatic, {
    id:parent,
    owner:null,
    digest:"b7107ab606b8e6f76f09b8d6a78063b5c0aa67217afdc3199a7a91d2fbf78eff",
    declaration:{...declaration,material:{kind:"url" as const,url:"https://example.com/"}},
    acceptedAt:isoDate(),
    state:"failed",
    attempts:0,
    error:"Automatic retry ended. Your capture is retained. Retry explicitly to recover it.",
  });
  t.check(ctx.delivered, []);

  const manual=present(await processCapture({...ctx,manualRetry:true},parent));
  t.check(manual, {
    id:parent,
    owner:null,
    digest:"b7107ab606b8e6f76f09b8d6a78063b5c0aa67217afdc3199a7a91d2fbf78eff",
    declaration:{...declaration,material:{kind:"url" as const,url:"https://example.com/"}},
    acceptedAt:isoDate(),
    state:"saved",
    error:"Automatic retry ended. Your capture is retained. Retry explicitly to recover it.",
    attempts:0,
    sourceRef:CAPTURED_PATH,
    sourceCommitted:true,
    filingRequested:true,
  });

  await box.cleanup();
});

// Context points to the original capture, never to another context event.
void test("Context points to the original capture, never to another context event.", async (t) => {
  const box=await makeTmpBox({git:true});
  await acceptQuickCapture({boxRoot:box.root,id:parent,owner:null,declaration:{...declaration,material:{kind:"url",url:"https://example.com/"}}});
  await acceptQuickCapture({boxRoot:box.root,id:first,owner:null,declaration:{...declaration,parentCaptureId:parent,input:"Original context"}});
  await t.checkThrows(async () => (await acceptQuickCapture({boxRoot:box.root,id:second,owner:null,declaration:{...declaration,parentCaptureId:first,input:"Nested context"}})), "QuickCaptureError: Add context to an original capture, not another context event.");

  await box.cleanup();
});

void test("line 224", async (t) => {
  const box=await makeTmpBox({git:true});
  const runtime=codexRuntime(box,"post-send");
  await chooseParent(box,runtime);
  const bound=await waitBound(box);
  t.check(bound, chatRecord(NEW_SESSION,{state:"sent",sentAt:isoDate()}));

  await acceptFollowup(box);
  t.check(present(await processCapture(runtime.ctx,first)), FOLLOW_UP_SENT);

  t.check(runtime.targets, [
    "new",
    ACTUAL,
  ]);

  clearChatRuntime(box.root);
  await box.cleanup();
});

void test("line 243", async (t) => {
  const box=await makeTmpBox({git:true});
  const runtime=codexRuntime(box,"delayed");
  await chooseParent(box,runtime);
  await acceptFollowup(box);
  t.check(present(await processCapture(runtime.ctx,first)), followUp({id:first,digest:FOLLOW_UP_DIGEST,input:"Follow up"},{
    state:"blocked",
    error:"Waiting for the original chat to identify itself. Your words are kept. If the box restarted before recording that identity, send them explicitly in the original chat.",
  }));

  runtime.assign();
  const bound=await waitBound(box);
  t.check(bound, chatRecord(EXISTING_SESSION,{state:"sent",sentAt:isoDate()}));

  t.check(present(await processCapture(runtime.ctx,first)), FOLLOW_UP_SENT);

  t.check(runtime.targets, [
    "new",
    ACTUAL,
  ]);

  clearChatRuntime(box.root);
  await box.cleanup();
});

void test("line 266", async (t) => {
  const box=await makeTmpBox({git:true});
  const runtime=codexRuntime(box,"lost-response");
  await chooseParent(box,runtime);
  const bound=await waitBound(box);
  t.check(bound, chatRecord(EXISTING_SESSION,{state:"sending",lastError:"Synthetic completion response lost."}));

  t.check(present(await processCapture(runtime.ctx,parent)), parentRecord({digest:"c11a5e11a2e1e181c8c0c8f8c60462aa6c4fb9cea5eef0f8929ec3717709b7dc",input:"Initial thought"},{
    state:"sent",
    sourceRef:INCOMING_PATH,
    sourceCommitted:true,
  }));

  await acceptFollowup(box);
  t.check(present(await processCapture(runtime.ctx,first)), FOLLOW_UP_SENT);

  t.check(runtime.targets, [
    "new",
    ACTUAL,
    ACTUAL,
  ]);
  t.check(runtime.claims, new Set([parent,first]));

  clearChatRuntime(box.root);
  await box.cleanup();
});
