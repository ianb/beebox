# Adding API Endpoints

How to add new API endpoints to callback-box using tRPC. Follow an existing router like `calendar.ts` as a reference.

## When to Use tRPC vs REST

**Use tRPC** for standard request/response endpoints — queries (reads) and mutations (writes) — and for real-time/streaming, which is tRPC **subscriptions over the WebSocket** (`events.subscribe` is the global event-bus stream, `events.turnStream` the resumable per-turn chat stream; the client routes subscriptions through `wsLink` via the `splitLink` in `src/frontend/src/lib/trpc/`). This is the default for all new endpoints.

**Keep as REST** (raw Fastify routes in `src/webapp/routes/`) only for what doesn't fit the tRPC shape:
- File uploads/downloads (`multipart/form-data`, streamed bodies)
- OAuth redirect flows
- Webhook receivers (external services POST to us)
- The `/chat/send` POST (needs the request's user + the session registry)

Older raw routes are tech debt — migrate when you touch the area.

## Files to Touch

### 1. Create or Edit a Router

Routers live in `src/webapp/trpc/routers/<name>.ts`. Each router groups related procedures.

```typescript
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";

export const myRouter = router({
  // Query — read-only, called with useQuery() on frontend
  getThings: publicProcedure
    .input(z.object({
      count: z.number().int().positive().default(10),
      filter: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      // ctx.boxRoot, ctx.services, ctx.eventBus, etc.
      const items = await loadItems(ctx.boxRoot, input.count);
      return { items };
    }),

  // Mutation — write operation, called with useMutation() on frontend
  createThing: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      content: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const path = await saveThing(ctx.boxRoot, input);
      ctx.eventBus.emit("file-change", { path }); // notify subscribed clients
      return { success: true, path };
    }),
});
```

**Queries** are for reading data. They can be cached, deduplicated, and refetched automatically.

**Mutations** are for writes/side effects. They don't cache. Use `ctx.eventBus.emit()` if other clients should see the change.

### 2. Register the Router

Add it to `src/webapp/trpc/router.ts`:

```typescript
import { myRouter } from "./routers/my.js";

export const appRouter = router({
  // ... existing routers
  my: myRouter,
});
```

### 3. Use It in the Frontend

```typescript
import { trpc } from "../lib/trpc";

// Query — automatic loading/error states
function MyComponent() {
  const { data, isLoading, error } = trpc.my.getThings.useQuery({ count: 20 });

  // Conditional query (only runs when path is truthy)
  const detail = trpc.my.getThing.useQuery(
    { path: selectedPath! },
    { enabled: !!selectedPath }
  );
}

// Mutation
function CreateForm() {
  const utils = trpc.useUtils();
  const mutation = trpc.my.createThing.useMutation({
    onSuccess: () => {
      utils.my.getThings.invalidate(); // refetch after mutation
    },
  });

  const handleSubmit = () => {
    mutation.mutate({ name: "test", content: "hello" });
  };

  return <button disabled={mutation.isPending} onClick={handleSubmit}>Create</button>;
}
```

### 4. Frontend Types

Use `RouterOutput` for type inference — don't manually define frontend interfaces:

```typescript
import type { RouterOutput } from "../lib/trpc";

// Derive types from the router's actual return values
type ThingItem = RouterOutput["my"]["getThings"]["items"][number];
```

## Context

Every procedure receives `ctx` with:

| Field | Type | Description |
|-------|------|-------------|
| `ctx.boxRoot` | `string` | Absolute path to the box directory |
| `ctx.boxSlug` | `string` | URL slug for the box (e.g., `"test1"`) |
| `ctx.eventBus` | `EventBus` | SQLite-backed event bus feeding `events.subscribe` subscriptions (see `src/core/event-bus.ts`) |
| `ctx.services` | `Services` | Injected services (calendar, telegram, dropbox, claude CLI) |
| `ctx.chatSession` | `ChatSession` | Per-box chat session singleton |

## Error Handling

Use `TRPCError` with appropriate codes:

```typescript
import { TRPCError } from "@trpc/server";

throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid input" });
throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Service not configured" });
```

On the frontend, errors are available as `error.message` from query/mutation hooks.

## Input Validation

All inputs are validated with Zod schemas. Common patterns:

```typescript
// Required string
z.string().min(1)

// Optional with default
z.number().int().positive().default(10)

// Enum
z.enum(["great", "ok", "meh"])

// Cross-field validation
z.object({
  comment: z.string().optional(),
  audioData: z.string().optional(),
}).refine((d) => d.comment || d.audioData, {
  message: "Either comment or audioData is required",
})
```

## Gotchas

### Define explicit return interfaces for complex data

TypeScript inference breaks down when procedures return data with:
- Index signatures (`[key: string]: unknown`) on source types
- Conditional spreads (`...(flag ? { x: 1 } : {})`)
- Empty array fallbacks typed as `Record<string, unknown>`

Fix: define an interface and type the return array explicitly:

```typescript
interface MyItem {
  name: string;
  status: "active" | "inactive";
  extra?: { count: number } | undefined; // note: | undefined for exactOptionalPropertyTypes
}

// In the procedure:
const items: MyItem[] = [];
// ... populate ...
return { items };

// NOT: return { items: [] as Array<Record<string, unknown>> };
```

### Don't pass `queryKey` to tRPC hooks

tRPC manages query keys internally. To trigger refetches, use:
- `utils.my.getThings.invalidate()` — after a mutation
- `useEffect` watching a trigger prop — for external signals (like subscription events)

### `exactOptionalPropertyTypes`

The tsconfig has `exactOptionalPropertyTypes: true`. Optional properties that could be `undefined` need `| undefined`:

```typescript
interface MyResult {
  name: string;
  extra?: string | undefined; // NOT just: extra?: string
}
```

### Queries without input

For procedures with no input, call with no arguments:

```typescript
// Backend
myQuery: publicProcedure.query(async ({ ctx }) => { ... })

// Frontend
const { data } = trpc.my.myQuery.useQuery();
```

### Audio as base64

For endpoints that accept audio (brief feedback, query responses), convert Blob to base64 on the frontend and send as a string field. Don't use file uploads for small audio clips:

```typescript
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Then in the mutation call:
const audioData = await blobToBase64(audioBlob);
mutation.mutate({ briefPath, targetId, audioData, audioMimeType: audioBlob.type });
```
