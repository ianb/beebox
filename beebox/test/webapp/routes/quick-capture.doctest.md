# Complete multipart quick capture

One request verifies declaration plus exact material bytes. There is no second
client finalize call to lose when a share extension exits.

```ts setup
import { makeTestServer } from "../../helpers/doctest-server.js";
import { buildMultipartForm } from "../../../src/lib/multipart.js";
import { readCapture } from "../../../src/core/quick-capture/store.js";
import { createMobilePairingTicket, redeemMobilePairingTicket } from "../../../src/core/mobile/pairing.js";
import { createHash } from "node:crypto";
const id="11111111-1111-4111-8111-111111111111";
const declaration={version:1,capturedAt:"2026-10-12T12:00:00Z",source:"apple-share-extension",material:{kind:"clipping",text:"Quoted evidence"}};
async function upload(ctx,value,extra=[]) {
  const {body,boundary}=buildMultipartForm([{kind:"field",field:{name:"declaration",value:JSON.stringify(value)}},...extra]);
  return ctx.request({method:"POST",url:`/api/quick-captures/${id}`,payload:body,headers:{"content-type":`multipart/form-data; boundary=${boundary}`}});
}
async function mobile(ctx,email) {
  const ticket=createMobilePairingTicket(ctx.boxRoot,{createdBy:email});
  const pair=await redeemMobilePairingTicket(ctx.boxRoot,{pairingToken:ticket.token,deviceLabel:"Synthetic test phone"});
  return {authorization:`Bearer ${pair.deviceToken}`};
}
async function ownedUpload(ctx,opts) {
  const {body,boundary}=buildMultipartForm([{kind:"field",field:{name:"declaration",value:JSON.stringify(opts.value)}}]);
  return ctx.request({method:"POST",url:`/api/quick-captures/${id}`,payload:body,headers:{...opts.headers,"content-type":`multipart/form-data; boundary=${boundary}`}});
}
async function eventUpload(ctx,opts) {
  const {body,boundary}=buildMultipartForm([{kind:"field",field:{name:"declaration",value:JSON.stringify(opts.value)}}]);
  return ctx.request({method:"POST",url:`/api/quick-captures/${opts.id}`,payload:body,headers:{"content-type":`multipart/form-data; boundary=${boundary}`}});
}
async function settleEvent(ctx,eventId) {
  for(let n=0;n<200;n++) {
    const record=await readCapture(ctx.boxRoot,eventId);
    if(record!==null&&record.state!=="accepted"&&record.state!=="preparing") return record;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  return readCapture(ctx.boxRoot,eventId);
}
async function settle(ctx) {
  for(let n=0;n<200;n++) {
    const record=await readCapture(ctx.boxRoot,id);
    if(record?.state==="saved"||record?.state==="failed") return record;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  return readCapture(ctx.boxRoot,id);
}
```

```ts
const ctx=await makeTestServer();
await upload(ctx,declaration)
=> {statusCode:200,body:{id:"11111111-1111-4111-8111-111111111111",state:"accepted"}}

await settle(ctx);
await upload(ctx,declaration)
=> {statusCode:200,body:{id:"11111111-1111-4111-8111-111111111111",state:"accepted"}}

await upload(ctx,{...declaration,material:{kind:"clipping",text:"Different evidence"}})
=> {statusCode:409,body:{error:"This capture ID already belongs to different content."}}

const detail=await ctx.request({method:"GET",url:`/api/trpc/quickCapture.detail?input=${encodeURIComponent(JSON.stringify({id}))}`});
[detail.statusCode,detail.body.result.data.state,detail.body.result.data.serverAccepted,detail.body.result.data.material.text]
=> [200,"saved",true,"Quoted evidence"]

await ctx.cleanup();
```

Missing file and undeclared/extra bytes refuse the entire composite.

```ts
const ctx=await makeTestServer();
const image={...declaration,input:"Find the problem",material:{kind:"image",id,mimeType:"image/png",byteLength:3,sha256:createHash("sha256").update("abc").digest("hex"),fileName:"shot.png"}};
await upload(ctx,image)
=> {statusCode:400,body:{error:"The complete declared material was not received."}}

await readCapture(ctx.boxRoot,id)
=> null

await upload(ctx,declaration,[{kind:"file",file:{name:"material",filename:"shot.png",contentType:"image/png",data:Buffer.from("abc")}}])
=> {statusCode:400,body:{error:"This declaration does not accept a file."}}

await upload(ctx,image,[{kind:"file",file:{name:"material",filename:"shot.png",contentType:"image/png",data:Buffer.from("ab")}}])
=> {statusCode:400,body:{error:"The complete declared material was not received."}}

await ctx.cleanup();
```


Owner identity is enforced equally for HTTP replay and tRPC read/write. A
human delete leaves a permanent Gone receipt that stale transfer cannot undo.

```ts
const ctx=await makeTestServer({openAccess:false});
const a=await mobile(ctx,"a@example.test");
const b=await mobile(ctx,"b@example.test");
await ownedUpload(ctx,{value:declaration,headers:a})
=> {statusCode:200,body:{id:"11111111-1111-4111-8111-111111111111",state:"accepted"}}

await settle(ctx);
await ownedUpload(ctx,{value:declaration,headers:b})
=> {statusCode:403,body:{error:"This capture belongs to another user."}}

const hidden=await ctx.request({method:"GET",url:`/api/trpc/quickCapture.detail?input=${encodeURIComponent(JSON.stringify({id}))}`,headers:b});
[hidden.statusCode,hidden.body.error.message]
=> [403,"This capture belongs to another user."]

const otherList=await ctx.request({method:"GET",url:"/api/trpc/quickCapture.list",headers:b});
otherList.body.result.data
=> {captures:[]}

const deleted=await ctx.request({method:"POST",url:"/api/trpc/quickCapture.delete",headers:{...a,"content-type":"application/json"},payload:{id}});
[deleted.statusCode,deleted.body.result.data.state]
=> [200,"gone"]

await ownedUpload(ctx,{value:declaration,headers:a})
=> {statusCode:410,body:{error:"This capture was deleted. It cannot be recreated by retrying."}}

await ctx.cleanup();
```


Deleting an original removes its exposed source content but retains a pending
context event's own words. Late choice and new context cannot revive the source.

```ts
const ctx=await makeTestServer();
const eventId="22222222-2222-4222-8222-222222222222";
await upload(ctx,{...declaration,input:"Parent private words"});
await settleEvent(ctx,id);
await eventUpload(ctx,{id:eventId,value:{version:1,capturedAt:"2026-10-12T12:01:00Z",source:"apple-native-input",parentCaptureId:id,input:"My retained context"}});
await settleEvent(ctx,eventId);
const before=await ctx.request({method:"GET",url:`/api/trpc/quickCapture.detail?input=${encodeURIComponent(JSON.stringify({id:eventId}))}`});
[before.body.result.data.state,before.body.result.data.input,before.body.result.data.delivery.state]
=> ["blocked","My retained context","needs-choice"]

await ctx.request({method:"POST",url:"/api/trpc/quickCapture.delete",headers:{"content-type":"application/json"},payload:{id}});
const original=await ctx.request({method:"GET",url:`/api/trpc/quickCapture.detail?input=${encodeURIComponent(JSON.stringify({id}))}`});
const gone=original.body.result.data;
[gone.state,gone.input,gone.material,gone.sourceRef,gone.transcript,gone.delivery]
=> ["gone",null,null,null,null,null]

const tombstone=await readCapture(ctx.boxRoot,id);
[tombstone.declaration.input,tombstone.declaration.material,tombstone.transcript]
=> [null,null,null]

const after=await ctx.request({method:"GET",url:`/api/trpc/quickCapture.detail?input=${encodeURIComponent(JSON.stringify({id:eventId}))}`});
const kept=after.body.result.data;
[kept.state,kept.input,kept.sourceRef,kept.delivery]
=> ["blocked","My retained context",null,null]

const late=await ctx.request({method:"POST",url:"/api/trpc/quickCapture.choose",headers:{"content-type":"application/json"},payload:{id:eventId,candidateId:before.body.result.data.delivery.choices[0].candidateId}});
[late.statusCode,late.body.error.message]
=> [404,"The original capture was deleted."]

await eventUpload(ctx,{id:"33333333-3333-4333-8333-333333333333",value:{version:1,capturedAt:"2026-10-12T12:02:00Z",source:"apple-native-input",parentCaptureId:id,input:"Late words"}})
=> {statusCode:410,body:{error:"The original capture was deleted."}}

await ctx.cleanup();
```


URLSession's declaration part names application/json. Multipart's parsed JSON
field is accepted just like the text field, with the same receipt identity.

```ts
const ctx=await makeTestServer();
const form=buildMultipartForm([{kind:"field",field:{name:"declaration",value:JSON.stringify(declaration)}}]);
const jsonBody=Buffer.from(form.body.toString("utf8").replace('name="declaration"\r\n\r\n','name="declaration"\r\nContent-Type: application/json\r\n\r\n'));
await ctx.request({method:"POST",url:`/api/quick-captures/${id}`,payload:jsonBody,headers:{"content-type":`multipart/form-data; boundary=${form.boundary}`}})
=> {statusCode:200,body:{id:"11111111-1111-4111-8111-111111111111",state:"accepted"}}

await settleEvent(ctx,id);
await ctx.cleanup();
```


The declaration limit accounts for UTF-8 and JSON escaping. A valid 100000-unit
CJK clipping needs 300000 UTF-8 bytes; worst-case escaped content needs 600000.

```ts
const ctx=await makeTestServer();
const quoted="文".repeat(100000);
await upload(ctx,{...declaration,material:{kind:"clipping",text:quoted}})
=> {statusCode:200,body:{id:"11111111-1111-4111-8111-111111111111",state:"accepted"}}

(await readCapture(ctx.boxRoot,id)).declaration.material.text.length
=> 100000

await settleEvent(ctx,id);
const escapedId="22222222-2222-4222-8222-222222222222";
await eventUpload(ctx,{id:escapedId,value:{...declaration,material:{kind:"clipping",text:"\u0000".repeat(100000)}}})
=> {statusCode:200,body:{id:"22222222-2222-4222-8222-222222222222",state:"accepted"}}

(await readCapture(ctx.boxRoot,escapedId)).declaration.material.text.length
=> 100000

await settleEvent(ctx,escapedId);
await ctx.cleanup();
```

Discarding an uncertain upload reserves its UUID under the requesting owner
before any buffered POST can seal. A 404 read alone is never deletion evidence.

```ts
const ctx=await makeTestServer();
const deleted=await ctx.request({method:"POST",url:"/api/trpc/quickCapture.delete",headers:{"content-type":"application/json"},payload:{id}});
[deleted.statusCode,deleted.body.result.data]
=> [200,{id:"11111111-1111-4111-8111-111111111111",state:"gone",attempts:0,serverAccepted:true}]

await upload(ctx,declaration)
=> {statusCode:410,body:{error:"This capture was deleted. It cannot be recreated by retrying."}}

await ctx.cleanup();
```
