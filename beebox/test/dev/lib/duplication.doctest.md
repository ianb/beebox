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

## A shared span must be contiguous in BOTH fragments

A run of A's shingles only counts as one span when it is a single contiguous
passage in B too. A's shingles scattered across unrelated parts of B are not
merged into one long span (the diagonal-tracking guarantee).

```ts
// A 12-word passage = 5 overlapping 8-word shingles.
const passage = "w0 w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11";

// (a) The passage appears CONTIGUOUSLY in b → one finding, the whole span.
const contiguous = findDuplication([
  { name: "a", text: `alpha ${passage} omega` },
  { name: "b", text: `beta ${passage} psi` },
]);
contiguous.length
=> 1

contiguous[0].words
=> 12

// (b) b contains each of a's five shingles, but as isolated passages separated
// by junk words — contiguous in a, scattered in b → NOT merged, nothing reported.
const scattered = "w0 w1 w2 w3 w4 w5 w6 w7 j0 w1 w2 w3 w4 w5 w6 w7 w8 j1 w2 w3 w4 w5 w6 w7 w8 w9 j2 w3 w4 w5 w6 w7 w8 w9 w10 j3 w4 w5 w6 w7 w8 w9 w10 w11";
findDuplication([
  { name: "a", text: passage },
  { name: "b", text: scattered },
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
