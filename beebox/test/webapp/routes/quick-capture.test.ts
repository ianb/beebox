// # Complete multipart quick capture
//
// One request verifies declaration plus exact material bytes. There is no second
// client finalize call to lose when a share extension exits.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate, uuid } from "@ianbicking/tap-check/check";
import { z } from "zod";
import { makeTestServer, type InjectResult, type TestServer } from "../../helpers/test-route-server.js";
import type { QuickCaptureDeclaration } from "../../../src/shared/quick-capture.js";
import type { CaptureRecord } from "../../../src/core/quick-capture/store.js";
import { buildMultipartForm, type MultipartPart } from "../../../src/lib/multipart.js";
import { readCapture, writeCapture } from "../../../src/core/quick-capture/store.js";
import { acceptQuickCapture } from "../../../src/core/quick-capture/acceptance.js";
import { materializeCaptureSource } from "../../../src/core/quick-capture/source.js";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { createMobilePairingTicket, redeemMobilePairingTicket } from "../../../src/core/mobile/pairing.js";
import { createHash } from "node:crypto";

const id="11111111-1111-4111-8111-111111111111";
const declaration: QuickCaptureDeclaration={version:1,capturedAt:"2026-10-12T12:00:00Z",source:"apple-share-extension",material:{kind:"clipping",text:"Quoted evidence"}};
const CaptureData=z.looseObject({material:z.looseObject({text:z.unknown()}).nullish(),delivery:z.looseObject({state:z.unknown()}).nullish()});
const TrpcData=z.object({result:z.object({data:CaptureData})});
const Choices=z.object({delivery:z.object({choices:z.array(z.object({candidateId:z.string()}))})});
// The first delivery choice offered on a capture's detail.
function firstChoiceId(res: InjectResult) { return Choices.parse(TrpcData.parse(res.body).result.data).delivery.choices[0]?.candidateId; }
// The text of a clipping capture's declared material.
function clippingText(record: CaptureRecord | null) {
  const material=record?.declaration.material;
  return material?.kind==="clipping" ? material.text : undefined;
}
// The response of a successful tRPC call carrying `data`.
function trpcOk<T>(data: T) { return { statusCode: 200, body: { result: { data } } }; }
// The response of a failed tRPC call.
function trpcFailure(opts: { statusCode: number; message: string; code: number; errorCode: string; path: string }) {
  return {
    statusCode: opts.statusCode,
    body: {
      error: {
        message: opts.message,
        code: opts.code,
        data: { code: opts.errorCode, httpStatus: opts.statusCode, path: opts.path, recovery: null },
      },
    },
  };
}
function declarationPart(value: QuickCaptureDeclaration): MultipartPart {
  return {kind:"field",field:{name:"declaration",value:JSON.stringify(value)}};
}
async function postParts(ctx: TestServer,parts: MultipartPart[]) {
  const {body,boundary}=buildMultipartForm(parts);
  return ctx.request({method:"POST",url:`/api/quick-captures/${id}`,payload:body,headers:{"content-type":`multipart/form-data; boundary=${boundary}`}});
}
async function upload(ctx: TestServer,value: QuickCaptureDeclaration) {
  return postParts(ctx,[declarationPart(value)]);
}
async function mobile(ctx: TestServer,email: string) {
  const ticket=createMobilePairingTicket(ctx.boxRoot,{createdBy:email});
  const pair=await redeemMobilePairingTicket(ctx.boxRoot,{pairingToken:ticket.token,deviceLabel:"Synthetic test phone"});
  if(!pair) throw new Error("pairing failed");
  return {authorization:`Bearer ${pair.deviceToken}`};
}
async function ownedUpload(ctx: TestServer,opts: { value: QuickCaptureDeclaration; headers: Record<string, string> }) {
  const {body,boundary}=buildMultipartForm([{kind:"field",field:{name:"declaration",value:JSON.stringify(opts.value)}}]);
  return ctx.request({method:"POST",url:`/api/quick-captures/${id}`,payload:body,headers:{...opts.headers,"content-type":`multipart/form-data; boundary=${boundary}`}});
}
async function eventUpload(ctx: TestServer,opts: { id: string; value: QuickCaptureDeclaration }) {
  const {body,boundary}=buildMultipartForm([{kind:"field",field:{name:"declaration",value:JSON.stringify(opts.value)}}]);
  return ctx.request({method:"POST",url:`/api/quick-captures/${opts.id}`,payload:body,headers:{"content-type":`multipart/form-data; boundary=${boundary}`}});
}
async function settleEvent(ctx: TestServer,eventId: string) {
  for(let n=0;n<200;n++) {
    const record=await readCapture(ctx.boxRoot,eventId);
    if(record!==null&&record.state!=="accepted"&&record.state!=="preparing") return record;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  return readCapture(ctx.boxRoot,eventId);
}
async function settle(ctx: TestServer) {
  for(let n=0;n<200;n++) {
    const record=await readCapture(ctx.boxRoot,id);
    if(record?.state==="saved"||record?.state==="failed") return record;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  return readCapture(ctx.boxRoot,id);
}

void test("line 72", async (t) => {
  const ctx=await makeTestServer();
  t.check(await upload(ctx,declaration), {
    statusCode: 200,
    body: {
      id: "11111111-1111-4111-8111-111111111111",
      state: "accepted",
    },
  });

  await settle(ctx);
  t.check(await upload(ctx,declaration), {
    statusCode: 200,
    body: {
      id: "11111111-1111-4111-8111-111111111111",
      state: "accepted",
    },
  });

  t.check(await upload(ctx,{...declaration,material:{kind:"clipping",text:"Different evidence"}}), {
    statusCode: 409,
    body: {
      error: "This capture ID already belongs to different content.",
    },
  });

  const detail=await ctx.request({method:"GET",url:`/api/trpc/quickCapture.detail?input=${encodeURIComponent(JSON.stringify({id}))}`});
  t.check(detail, trpcOk({
    id,
    state: "saved",
    capturedAt: "2026-10-12T12:00:00Z",
    source: "apple-share-extension",
    material: { kind: "clipping", text: "Quoted evidence" },
    sourceRef: "_content/captures/11111111-1111-4111-8111-111111111111.doc.card",
    attempts: 0,
    serverAccepted: true,
  }));

  await ctx.cleanup();
});

// Missing file and undeclared/extra bytes refuse the entire composite.
void test("Missing file and undeclared/extra bytes refuse the entire composite.", async (t) => {
  const ctx=await makeTestServer();
  const image: QuickCaptureDeclaration={...declaration,input:"Find the problem",material:{kind:"image",id,mimeType:"image/png",byteLength:3,sha256:createHash("sha256").update("abc").digest("hex"),fileName:"shot.png"}};
  t.check(await upload(ctx,image), {
    statusCode: 400,
    body: {
      error: "The complete declared material was not received.",
    },
  });

  t.check(await readCapture(ctx.boxRoot,id), null);

  t.check(await postParts(ctx,[declarationPart(declaration),{kind:"file",file:{name:"material",filename:"shot.png",contentType:"image/png",data:Buffer.from("abc")}}]), {
    statusCode: 400,
    body: {
      error: "This declaration does not accept a file.",
    },
  });

  t.check(await postParts(ctx,[declarationPart(image),{kind:"file",file:{name:"material",filename:"shot.png",contentType:"image/png",data:Buffer.from("ab")}}]), {
    statusCode: 400,
    body: {
      error: "The complete declared material was not received.",
    },
  });

  await ctx.cleanup();
});

// Owner identity is enforced equally for HTTP replay and tRPC read/write. A
// human delete leaves a permanent Gone receipt that stale transfer cannot undo.
void test("Owner identity is enforced equally for HTTP replay and tRPC read/write.", async (t) => {
  const ctx=await makeTestServer({openAccess:false});
  // A paired phone works only while its pairer can open the box.
  await ctx.seed("_config/box.json",JSON.stringify({allowedEmails:["a@example.test","b@example.test"]}));
  const a=await mobile(ctx,"a@example.test");
  const b=await mobile(ctx,"b@example.test");
  t.check(await ownedUpload(ctx,{value:declaration,headers:a}), {
    statusCode: 200,
    body: {
      id: "11111111-1111-4111-8111-111111111111",
      state: "accepted",
    },
  });

  await settle(ctx);
  t.check(await ownedUpload(ctx,{value:declaration,headers:b}), {
    statusCode: 403,
    body: {
      error: "This capture belongs to another user.",
    },
  });

  const hidden=await ctx.request({method:"GET",url:`/api/trpc/quickCapture.detail?input=${encodeURIComponent(JSON.stringify({id}))}`,headers:b});
  t.check(hidden, trpcFailure({
    statusCode: 403,
    message: "This capture belongs to another user.",
    code: -32003,
    errorCode: "FORBIDDEN",
    path: "quickCapture.detail",
  }));

  const otherList=await ctx.request({method:"GET",url:"/api/trpc/quickCapture.list",headers:b});
  t.check(otherList, trpcOk({ captures: [] }));

  const deleted=await ctx.request({method:"POST",url:"/api/trpc/quickCapture.delete",headers:{...a,"content-type":"application/json"},payload:{id}});
  t.check(deleted, trpcOk({
    id,
    state: "gone",
    capturedAt: "2026-10-12T12:00:00Z",
    source: "apple-share-extension",
    attempts: 0,
    serverAccepted: true,
  }));

  t.check(await ownedUpload(ctx,{value:declaration,headers:a}), {
    statusCode: 410,
    body: {
      error: "This capture was deleted. It cannot be recreated by retrying.",
    },
  });

  await ctx.cleanup();
});

// Deleting an original removes its exposed source content but retains a pending
// context event's own words. Late choice and new context cannot revive the source.
void test("Deleting an original removes its exposed source content but retains a pending...", async (t) => {
  const ctx=await makeTestServer();
  const eventId="22222222-2222-4222-8222-222222222222";
  await upload(ctx,{...declaration,input:"Parent private words"});
  await settleEvent(ctx,id);
  await eventUpload(ctx,{id:eventId,value:{version:1,capturedAt:"2026-10-12T12:01:00Z",source:"apple-native-input",parentCaptureId:id,input:"My retained context"}});
  await settleEvent(ctx,eventId);
  const before=await ctx.request({method:"GET",url:`/api/trpc/quickCapture.detail?input=${encodeURIComponent(JSON.stringify({id:eventId}))}`});
  t.check(before, trpcOk({
    id: eventId,
    state: "blocked",
    capturedAt: "2026-10-12T12:01:00Z",
    source: "apple-native-input",
    input: "My retained context",
    parentCaptureId: id,
    sourceRef: "_content/incoming/11111111-1111-4111-8111-111111111111.doc.card",
    error: "Choose a destination for the original capture before sending context.",
    attempts: 0,
    serverAccepted: true,
    delivery: {
      id: uuid(),
      message: "Parent private words",
      createdAt: isoDate(),
      state: "needs-choice",
      reason: "routing-unavailable",
      choices: [{ candidateId: "c0", label: "New general chat" }],
    },
  }));

  await ctx.request({method:"POST",url:"/api/trpc/quickCapture.delete",headers:{"content-type":"application/json"},payload:{id}});
  const original=await ctx.request({method:"GET",url:`/api/trpc/quickCapture.detail?input=${encodeURIComponent(JSON.stringify({id}))}`});
  t.check(original, trpcOk({
    id,
    state: "gone",
    capturedAt: "2026-10-12T12:00:00Z",
    source: "apple-share-extension",
    attempts: 0,
    serverAccepted: true,
  }));

  const tombstone=await readCapture(ctx.boxRoot,id);
  t.check(tombstone, {
    id,
    owner: null,
    digest: "d5f883ff8a5324b716c46c0cf6f82841615d95571e60fc18793758a85850d90f",
    declaration: { version: 1, capturedAt: "2026-10-12T12:00:00Z", source: "apple-share-extension" },
    acceptedAt: isoDate(),
    state: "gone",
    sourceRef: "_content/incoming/11111111-1111-4111-8111-111111111111.doc.card",
    sourceCommitted: true,
    attempts: 0,
  });

  const after=await ctx.request({method:"GET",url:`/api/trpc/quickCapture.detail?input=${encodeURIComponent(JSON.stringify({id:eventId}))}`});
  t.check(after, trpcOk({
    id: eventId,
    state: "blocked",
    capturedAt: "2026-10-12T12:01:00Z",
    source: "apple-native-input",
    input: "My retained context",
    parentCaptureId: id,
    error: "The original capture was deleted. Your context words are kept; copy them into a new capture if needed.",
    attempts: 0,
    serverAccepted: true,
  }));

  const late=await ctx.request({method:"POST",url:"/api/trpc/quickCapture.choose",headers:{"content-type":"application/json"},payload:{id:eventId,candidateId:firstChoiceId(before)}});
  t.check(late, trpcFailure({
    statusCode: 404,
    message: "The original capture was deleted.",
    code: -32004,
    errorCode: "NOT_FOUND",
    path: "quickCapture.choose",
  }));

  t.check(await eventUpload(ctx,{id:"33333333-3333-4333-8333-333333333333",value:{version:1,capturedAt:"2026-10-12T12:02:00Z",source:"apple-native-input",parentCaptureId:id,input:"Late words"}}), {
    statusCode: 410,
    body: {
      error: "The original capture was deleted.",
    },
  });

  await ctx.cleanup();
});

// URLSession's declaration part names application/json. Multipart's parsed JSON
// field is accepted just like the text field, with the same receipt identity.
void test("URLSession's declaration part names application/json.", async (t) => {
  const ctx=await makeTestServer();
  const form=buildMultipartForm([{kind:"field",field:{name:"declaration",value:JSON.stringify(declaration)}}]);
  const jsonBody=Buffer.from(form.body.toString("utf8").replace('name="declaration"\r\n\r\n','name="declaration"\r\nContent-Type: application/json\r\n\r\n'));
  t.check(await ctx.request({method:"POST",url:`/api/quick-captures/${id}`,payload:jsonBody,headers:{"content-type":`multipart/form-data; boundary=${form.boundary}`}}), {
    statusCode: 200,
    body: {
      id: "11111111-1111-4111-8111-111111111111",
      state: "accepted",
    },
  });

  await settleEvent(ctx,id);
  await ctx.cleanup();
});

// The declaration limit accounts for UTF-8 and JSON escaping. A valid 100000-unit
// CJK clipping needs 300000 UTF-8 bytes; worst-case escaped content needs 600000.
void test("The declaration limit accounts for UTF-8 and JSON escaping.", async (t) => {
  const ctx=await makeTestServer();
  const quoted="文".repeat(100000);
  t.check(await upload(ctx,{...declaration,material:{kind:"clipping",text:quoted}}), {
    statusCode: 200,
    body: {
      id: "11111111-1111-4111-8111-111111111111",
      state: "accepted",
    },
  });

  t.check(clippingText(await readCapture(ctx.boxRoot,id)), quoted);

  await settleEvent(ctx,id);
  const escapedId="22222222-2222-4222-8222-222222222222";
  t.check(await eventUpload(ctx,{id:escapedId,value:{...declaration,material:{kind:"clipping",text:"\u0000".repeat(100000)}}}), {
    statusCode: 200,
    body: {
      id: "22222222-2222-4222-8222-222222222222",
      state: "accepted",
    },
  });

  t.check(clippingText(await readCapture(ctx.boxRoot,escapedId)), "\u0000".repeat(100000));

  await settleEvent(ctx,escapedId);
  await ctx.cleanup();
});

// Discarding an uncertain upload reserves its UUID under the requesting owner
// before any buffered POST can seal. A 404 read alone is never deletion evidence.
void test("Discarding an uncertain upload reserves its UUID under the requesting owner b...", async (t) => {
  const ctx=await makeTestServer();
  const deleted=await ctx.request({method:"POST",url:"/api/trpc/quickCapture.delete",headers:{"content-type":"application/json"},payload:{id}});
  t.check(deleted, trpcOk({ id, state: "gone", attempts: 0, serverAccepted: true }));

  t.check(await upload(ctx,declaration), {
    statusCode: 410,
    body: {
      error: "This capture was deleted. It cannot be recreated by retrying.",
    },
  });

  await ctx.cleanup();
});

// A crash can land between writing the source and recording that it was
// written. Deleting the capture then still finds the source by its `share-id` and
// removes it.
void test("A crash can land between writing the source and recording that it was written.", async (t) => {
  const ctx=await makeTestServer();
  await acceptQuickCapture({boxRoot:ctx.boxRoot,id,owner:null,declaration:{...declaration,input:"Keep this"}});
  const record=await readCapture(ctx.boxRoot,id);
  if(record===null) throw new Error("capture was not stored");
  const written=await materializeCaptureSource(ctx.boxRoot,record);
  await writeCapture(ctx.boxRoot,{...record,state:"preparing"});
  const exists=(rel: string)=>access(join(ctx.boxRoot,rel)).then(()=>true,()=>false);
  const before=await exists(written);
  await ctx.request({method:"POST",url:"/api/trpc/quickCapture.delete",headers:{"content-type":"application/json"},payload:{id}});
  t.check(({written,before,after:await exists(written)}), {
    written: "_content/incoming/11111111-1111-4111-8111-111111111111.doc.card",
    before: true,
    after: false,
  });

  await ctx.cleanup();
});
