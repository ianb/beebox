# Duplication detection

Simple, deterministic shared-span detection across named text fragments, used by
the prompt viewer. Plus `estimateTokens`, a rough deterministic token estimate.

```ts setup
import { findDuplication, estimateTokens } from "../../../src/dev/lib/duplication.js";
```

## estimateTokens

A deterministic estimate: `round(length / 3.7)`. Not a real tokenizer.

```ts
estimateTokens("")
=> 0

estimateTokens("a".repeat(37))
=> 10
```

## A shared run of ≥ 12 words is reported

Two fragments that embed the same 16-word passage (in different surrounding
text) yield one finding, reported with the shared span taken from fragment `a`,
normalized (lowercased, punctuation stripped).

```ts
const shared = "the quick brown fox jumps over the lazy dog and then runs away very fast indeed";
const findings = findDuplication([
  { name: "frag-a", text: `Alpha beta ${shared}, gamma!` },
  { name: "frag-b", text: `Delta epsilon ${shared}; zeta.` },
]);
findings.length
=> 1

findings[0].a
=> frag-a

findings[0].b
=> frag-b

findings[0].words
=> 16

findings[0].text
=> the quick brown fox jumps over the lazy dog and then runs away very fast indeed
```

## An overlap shorter than 12 words is not reported

An 8-word shared run (a single shingle) falls under the 12-word threshold.

```ts
const short = "one two three four five six seven eight";
findDuplication([
  { name: "a", text: `xx ${short}` },
  { name: "b", text: `yy ${short} zz` },
])
=> []
```

## Identical-text fragments are collapsed, never self-matched

The same content appearing under two names (e.g. once in the inventory and once
in an assembled situation) is deduped before pairing, so it produces no finding.

```ts
const body = "the quick brown fox jumps over the lazy dog and then runs away very fast indeed";
findDuplication([
  { name: "inventory-name", text: body },
  { name: "chat/some-layer", text: body },
])
=> []
```
