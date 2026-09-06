# Deciding what OCR should do with a PDF

A PDF arriving from a scanner has three possible states, not two, and the third
one bit a real document: a text layer that is *present* but useless.

A scanner that OCRs to "searchable PDF" can embed a layer like
`p o w e r f u l  a n d  r u l e d` — one character per token. Character count
alone calls that a text layer, so the document was filed with it and nothing
flagged the problem: a bad layer reads exactly like a good one to everything
downstream. Re-OCRing the same pages recovered 2056 usable words against 112.

```ts setup
import { assessTextLayer } from "../../../src/core/commands/pdf-probe.js";
import { ocrIntentFor } from "../../../src/core/commands/scan-import-pdf.js";

const spaced = (s) => s.split("").join(" ");
const prose =
  "Long ago there was a wizard, who was extremely powerful and ruled most of " +
  "the world. But even a wizard cannot live forever, so when he was soon to " +
  "die he put every grain of power he had into a dull rock.";
```

## Ordinary prose is good

```ts
assessTextLayer(prose)
=> good
```

Including prose thick with English's one-letter words, which is the obvious
false positive for a single-character-token test:

```ts
assessTextLayer("I asked a friend, and I gave a book to a boy I know, and a dog I saw ran off with a bone I had.")
=> good
```

## A character-spaced layer is junk

```ts
assessTextLayer(spaced("powerfulandruledmostoftheworldbuteven"))
=> junk
```

The real shape — spaced words interleaved with a few intact ones — is still
junk, because the single-character tokens dominate:

```ts
assessTextLayer("MFG.CO. Hsstings, Minnesots / Logan, Ohio / " + spaced("ongagothere") + " was a wizard " + spaced("whowasextremely"))
=> junk
```

## Too little text to judge reads as good

Below the sample threshold the ratio is noise, and guessing `junk` would pay
for OCR on a document whose layer is fine.

```ts
assessTextLayer("A B C")
=> good
```

```ts
assessTextLayer("")
=> good
```

## The three-way intent

No layer at all — OCR the layout's regions, the only way to get any text:

```ts
ocrIntentFor({ hasTextLayer: false, textLayerQuality: "none" })
=> regions
```

A junk layer — replace it wholesale. `regions` is wrong here: it leaves the
existing layer in place around what it OCRs, so fragments of the garbage
survive into the output.

```ts
ocrIntentFor({ hasTextLayer: true, textLayerQuality: "junk" })
=> replace
```

A good layer — read it, and run no OCR at all:

```ts
ocrIntentFor({ hasTextLayer: true, textLayerQuality: "good" })
=> off
```
