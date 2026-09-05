# Personality boxholder identity

Who the boxholder is lives on `people/*.person.card` files flagged
`boxholder: true` — the single, plural-capable source of truth. The
personality card carries only the relational notes (`boxholder.relationships`).
`loadBoxholders` reads the flagged person cards; `compilePersonality` bakes the
resulting "Your boxholder is …" line into the agent guide.

```ts setup
import { compilePersonality } from "../../src/schemas/personality.js";
import { loadBoxholders } from "../../src/core/boxholder-cards.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const base = { type: "personality", version: "1.0.0", body: "" } as const;
```

## One boxholder — name and called

```ts
const md = compilePersonality({ ...base }, { boxholders: [{ name: "Priya Marlowe", called: "Priya" }] });
md.includes("Your boxholder is **Priya Marlowe** (Priya).")
=> true
```

## A boxholder with no alias omits the parenthetical

```ts
const md = compilePersonality({ ...base }, { boxholders: [{ name: "Priya Marlowe" }] });
md.includes("Your boxholder is **Priya Marlowe**.")
=> true
```

## Several boxholders — an oxford-joined sentence

```ts
const md = compilePersonality({ ...base }, {
  boxholders: [{ name: "Priya", called: "A" }, { name: "Juniper" }, { name: "Odette" }],
});
md.includes("Your boxholders are **Priya** (A), **Juniper**, and **Odette**.")
=> true
```

## No boxholders — no identity line, relationships still emit

```ts
const md = compilePersonality(
  { ...base, boxholder: { relationships: [{ text: "Prefers terse replies", confidence: "confirmed", source: "user-stated" }] } },
  { boxholders: [] },
);
JSON.stringify([md.includes("Your boxholder"), md.includes("Prefers terse replies")])
=> [false,true]
```

## `loadBoxholders` reads flagged, active person cards only

```ts
const box = await makeTmpBox();
await box.write("people/Priya_Marlowe.person.card", "---\nstatus: active\nname: Priya Marlowe\naliases:\n  - Priya\nboxholder: true\n---\n");
await box.write("people/Jo_Smith.person.card", "---\nstatus: archived\nname: Jo Smith\nboxholder: true\n---\n");
await box.write("people/Pat_Lee.person.card", "---\nstatus: active\nname: Pat Lee\n---\n");
JSON.stringify(await loadBoxholders(box.root))
=> [{"name":"Priya Marlowe","called":"Priya"}]
```

```ts cleanup
await box.cleanup();
```
