# canonical-refs: `bbx validate --canonical` and `--canonical --fix`

A ref is **canonical** when it addresses its target from the box root
(`/_content/store/notes/Plan.doc.card`) — or is the one sanctioned exception, a card's own
`attach/…` scope. A document-relative ref still resolves, but it means something
different depending on where the document lives, so `--canonical` reports it and
`--canonical --fix` rewrites the ones whose target actually exists.

Card BODY refs (Markdoc tag refs, inline markdown links) get this warning by
default now (Track B, `docs/plans/one-root-box-layout.md`) — see the "quiet"
example below. Frontmatter refs stay opt-in: a box carries legacy relative
refs by the hundred, and reporting them in the normal walk would bury the
broken-ref signal. `--canonical` reports frontmatter refs too.

```ts setup
import { z } from "zod";
import { body, cardSchema, type CardSchema } from "../../src/cards/index.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { lintCardsDispatch } from "../../src/core/card-lint.js";
import type { LoadCardContext } from "../../src/core/card-io.js";
import {
  checkCanonicalRef,
  collectDossierCanonicalWarnings,
} from "../../src/core/canonical-refs.js";
import {
  canonicalizeBox,
  formatCanonicalizeReport,
} from "../../src/core/canonicalize-refs.js";
import { loadValidationIgnore } from "../../src/core/validation-ignore.js";
import {
  canonicalCounts,
  formatCanonicalReport,
} from "../../src/cli/commands/validate-canonical.js";

const docSchema: CardSchema = cardSchema("doc", {
  fields: {
    title: z.string(),
    ref: z.string().optional(),
    refs: z.array(z.string()).optional(),
    body: body(z.string()),
  },
});

const ctx: LoadCardContext = {
  cardSchemas: new Map<string, CardSchema>([["doc", docSchema]]),
};

const MEETING =
  "---\n" +
  "type: doc\n" +
  "title: Ashfield sync\n" +
  "ref: Plan.doc.card\n" +
  "refs:\n" +
  "  - /_content/store/notes/Plan.doc.card#risks\n" +
  "  - attach/photo.jpg\n" +
  "  - ../people/Missing.person.card\n" +
  "---\n" +
  "See [the plan](Plan.doc.card?view=ledger) and [the site](https://example.com).\n";

const GUIDE =
  "# Guide\n" +
  "\n" +
  "Read [the plan](../store/notes/Plan.doc.card) and [again](/_content/store/notes/Plan.doc.card).\n" +
  "Also [missing](../store/notes/Gone.doc.card) and [outside](../../escape.md).\n";

/** A box holding one referring card, its target, and one dossier. */
async function seedBox() {
  const box = await makeTmpBox();
  await box.write("_content/store/notes/Plan.doc.card", "---\ntype: doc\ntitle: Plan\n---\nThe plan.\n");
  await box.write("_content/store/notes/Meeting.doc.card", MEETING);
  await box.write("_content/store/notes/Meeting.attach/photo.jpg", "IMG");
  await box.write("_content/docs/guide.md", GUIDE);
  return box;
}
```

## Which forms count as canonical

Box-root-absolute is canonical; so is a card's `attach/` scope, an external URL,
and a bare fragment. A document-relative path is not — and the check names the
box-root form it should have been written as, suffix and all.

```ts
const from = { fromPath: "_content/store/notes/Meeting.doc.card", kind: "card" } as const;

checkCanonicalRef({ ref: "/_content/store/notes/Plan.doc.card", ...from }).status
=> canonical

checkCanonicalRef({ ref: "attach/photo.jpg", ...from }).status
=> canonical

checkCanonicalRef({ ref: "https://example.com/x", ...from }).status
=> canonical

checkCanonicalRef({ ref: "#risks", ...from }).status
=> canonical

JSON.stringify(checkCanonicalRef({ ref: "../people/Dana.person.card?view=card", ...from }))
=> {"status":"rewritable","canonical":"/_content/store/people/Dana.person.card?view=card"}
```

A `.md` dossier owns no attach scope, so `attach/x` there is a literal
subdirectory — non-canonical like any other relative path. And a ref that climbs
out of the BOX NAMESPACE has no box-root form to offer, so it is reported, never
rewritten — the same "escapes" verdict now covers a ref that physically stays
inside the box root but lands outside every underscore area (Track B's
namespace fence, `docs/plans/one-root-box-layout.md`).

```ts
checkCanonicalRef({ ref: "attach/photo.jpg", fromPath: "_content/docs/guide.md", kind: "markdown" }).status
=> rewritable

checkCanonicalRef({ ref: "../../escape.md", fromPath: "_content/docs/guide.md", kind: "markdown" }).status
=> escapes
```

## Report mode flags card refs with their rewrite

`lintCardsDispatch` emits `type: "canonical"` warnings for frontmatter refs
only when asked (body refs/links are on by default — see below). Each message
names the ref and the canonical form, so the report doubles as a preview of
what `--fix` would write. The absolute ref, the `attach/` ref, and the
external link are not flagged.

```ts
const box = await seedBox();
const report = await lintCardsDispatch(
  [box.path("_content/store/notes/Meeting.doc.card")],
  { boxRoot: box.root, ctx, canonical: true },
);
report.results[0]!.warnings.filter((w) => w.type === "canonical").map((w) => w.message).join("\n")
=>
Non-canonical ref at body:1:link: Plan.doc.card?view=ledger → /_content/store/notes/Plan.doc.card?view=ledger
Non-canonical ref at ref: Plan.doc.card → /_content/store/notes/Plan.doc.card
Non-canonical ref at refs[2]: ../people/Missing.person.card → /_content/store/people/Missing.person.card
```

The body link comes first — it's the always-on Track B check, run before the
opt-in frontmatter pass.

Without `--canonical` there are still no FRONTMATTER canonical warnings — but
the body link's warning is still there (default-on), alongside the ordinary
broken-ref warning for the target that really is missing:

```ts continue
const quiet = await lintCardsDispatch(
  [box.path("_content/store/notes/Meeting.doc.card")],
  { boxRoot: box.root, ctx },
);
quiet.results[0]!.warnings.map((w) => w.type).join(",")
=> canonical,reference
```

## Report mode flags dossier links as their own bucket

Formal `[text](path)` links in plain `.md` dossiers are checked the same way,
with `kind: "markdown"`.

```ts continue
const dossier = await collectDossierCanonicalWarnings([box.path("_content/docs/guide.md")], box.root);
dossier.join("\n")
=>
_content/docs/guide.md: Non-canonical ref at line 3: ../store/notes/Plan.doc.card → /_content/store/notes/Plan.doc.card
_content/docs/guide.md: Non-canonical ref at line 4: ../store/notes/Gone.doc.card → /_content/store/notes/Gone.doc.card
_content/docs/guide.md: Non-canonical ref at line 4: ../../escape.md escapes the box — no box-root form, fix it by hand
```

Card refs and dossier links are counted — and printed — as two distinct buckets.
The same two numbers are what `--json` reports as `nonCanonicalRefs` and
`nonCanonicalDossierLinks`.

```ts continue
const buckets = { cardSummary: report, viewWarnings: [], dossierWarnings: dossier };
JSON.stringify(canonicalCounts(buckets))
=> {"refs":3,"dossierLinks":3}

formatCanonicalReport({ ...buckets, dossierWarnings: [] }, { colors: false })
=> Canonical refs: 3 non-canonical refs, 0 non-canonical dossier links — rerun with `--canonical --fix` to rewrite the ones whose target exists
```

```ts continue
await box.cleanup();
```

## `--fix` rewrites what resolves and leaves the rest alone

The rewrite is text-surgical: the frontmatter key order is untouched (a
parse-and-reserialize would reorder keys to schema order), the `?view=` suffix
survives, and the dangling `../people/Missing.person.card` stays exactly as
written — re-expressing a ref whose target doesn't exist would invent a path
nobody can verify.

```ts
const box = await seedBox();
const fixed = await canonicalizeBox(box.root, { ignore: await loadValidationIgnore(box.root) });
JSON.stringify(fixed)
=> {"refsRewritten":2,"dossierLinksRewritten":1,"refsRepaired":0,"dossierLinksRepaired":0,"ambiguous":0,"filesChanged":2,"skipped":3}
```

```ts continue
await box.read("_content/store/notes/Meeting.doc.card")
=>
---
type: doc
title: Ashfield sync
ref: /_content/store/notes/Plan.doc.card
refs:
  - /_content/store/notes/Plan.doc.card#risks
  - attach/photo.jpg
  - ../people/Missing.person.card
---
See [the plan](/_content/store/notes/Plan.doc.card?view=ledger) and [the site](https://example.com).
```

The dossier's one resolvable link is rewritten in place; the already-absolute
link, the dangling one, and the box-escaping one are left alone.

```ts continue
await box.read("_content/docs/guide.md")
=>
# Guide
«blankline»
Read [the plan](/_content/store/notes/Plan.doc.card) and [again](/_content/store/notes/Plan.doc.card).
Also [missing](../store/notes/Gone.doc.card) and [outside](../../escape.md).
```

Re-running the report against the fixed box comes back clean except for the
dangling refs it deliberately refused to touch:

```ts continue
const after = await lintCardsDispatch(
  [box.path("_content/store/notes/Meeting.doc.card")],
  { boxRoot: box.root, ctx, canonical: true },
);
const afterDossier = await collectDossierCanonicalWarnings([box.path("_content/docs/guide.md")], box.root);
JSON.stringify(
  canonicalCounts({ cardSummary: after, viewWarnings: [], dossierWarnings: afterDossier }),
)
=> {"refs":1,"dossierLinks":2}
```

Running `--fix` again is a no-op — nothing left that both resolves and is
relative:

```ts continue
const again = await canonicalizeBox(box.root, { ignore: await loadValidationIgnore(box.root) });
JSON.stringify({ refs: again.refsRewritten, links: again.dossierLinksRewritten, files: again.filesChanged })
=> {"refs":0,"links":0,"files":0}
```

```ts continue
await box.cleanup();
```

## What `--fix` refuses to touch: fenced examples, block-scalar prose, comments

The fixer shares `bbx mv`'s text-surgical scan but not all of its posture. Three
lines below carry the text `Plan.doc.card` and are deliberately *not* rewritten:

- the line inside a **fenced code block** — `--fix` passes `skipFencedCode`
  where `bbx mv` does not, because a fenced example may be teaching the legacy
  relative form on purpose, and normalizing it would erase what it shows;
- the line inside a **YAML block scalar** (`notes: |`), which is prose, not YAML;
- nothing in either case is a ref, so nothing is counted.

The two lines that *are* refs get rewritten with their **end-of-line comments**
preserved in place — before, the comment was captured as part of the token, so
the ref never resolved and `--fix` silently skipped it.

```ts
const FENCE = "`".repeat(3);
const box = await makeTmpBox();
await box.write("_content/store/notes/Plan.doc.card", "---\ntype: doc\ntitle: Plan\n---\nThe plan.\n");
await box.write(
  "_content/store/notes/Notes.doc.card",
  "---\ntype: doc\ntitle: Notes\nref: Plan.doc.card  # the plan\nrefs:\n  - Plan.doc.card # also\n" +
    "notes: |\n  Write it as:\n  - ref: Plan.doc.card\n---\n" +
    "Inline [plan](Plan.doc.card).\n" +
    FENCE + "md\nFenced [plan](Plan.doc.card)\n" + FENCE + "\n",
);

const fixed = await canonicalizeBox(box.root, { ignore: await loadValidationIgnore(box.root) });
JSON.stringify(fixed)
=> {"refsRewritten":3,"dossierLinksRewritten":0,"refsRepaired":0,"dossierLinksRepaired":0,"ambiguous":0,"filesChanged":1,"skipped":0}
```

```ts continue
const notes = await box.read("_content/store/notes/Notes.doc.card");
notes.split("\n").filter((line) => line.includes("Plan.doc.card")).join("\n")
=>
ref: /_content/store/notes/Plan.doc.card  # the plan
  - /_content/store/notes/Plan.doc.card # also
  - ref: Plan.doc.card
Inline [plan](/_content/store/notes/Plan.doc.card).
Fenced [plan](Plan.doc.card)
```

```ts continue
await box.cleanup();
```

## A ref with no path names nothing — broken, not canonical

`ref: ""`, `#only`, and `?view=only` all parse to an empty path. They used to
resolve to the card's own *directory*, and an existence check on a directory
succeeds — so a malformed ref read as a valid one. Now the shared algebra fails
closed on them, and each surfaces as an ordinary broken-ref warning.

```ts
const box = await makeTmpBox();
await box.write(
  "_content/store/notes/Empty.doc.card",
  '---\ntype: doc\ntitle: Empty\nref: ""\nrefs:\n  - "#only"\n  - "?view=only"\n---\nbody\n',
);
const report = await lintCardsDispatch(
  [box.path("_content/store/notes/Empty.doc.card")],
  { boxRoot: box.root, ctx, canonical: true },
);
report.results[0].warnings.map((w) => `${w.type}: ${w.message}`).join("\n")
=>
reference: Broken reference at ref:  does not exist
reference: Broken reference at refs[0]: #only does not exist
reference: Broken reference at refs[1]: ?view=only does not exist
```

None of the three is canonical-rewritable — there is no target to re-express
from the box root, and `--fix` leaves the card untouched:

```ts continue
JSON.stringify(canonicalCounts({ cardSummary: report, viewWarnings: [], dossierWarnings: [] }))
=> {"refs":0,"dossierLinks":0}

const fixed = await canonicalizeBox(box.root, { ignore: await loadValidationIgnore(box.root) });
JSON.stringify({ refs: fixed.refsRewritten, files: fixed.filesChanged, skipped: fixed.skipped })
=> {"refs":0,"files":0,"skipped":0}
```

```ts continue
await box.cleanup();
```

## Refs written with box-root intent are repaired, not just canonicalized

Old code wrote bare refs meaning them *from the box root* — under v3 that
means a bare ref that happens to already start with an underscore area name,
just missing its leading `/` (the natural v3 analogue of v2's bare
`people/Dana.person.card`, whose box-root form was `/people/...`). Read
document-relative they dangle; read from the box root they resolve. So when a
non-canonical ref's document-relative target does NOT exist, `--fix` tries the
same bare path from the box root, and writes the `/`-leading form when *that*
target exists.

The box below carries all four cases in one card: two refs with box-root intent
(one with a `#fragment`), one that resolves BOTH ways, and one that resolves
neither. The "resolves both ways" case needs a bare ref that ALSO starts with
an area name for its box-root reading to be legal under the namespace fence —
so its document-relative reading happens to land in a coincidentally
same-named `_content/` subdirectory two levels down. That's a deliberate
coincidence, not special-cased: the algebra doesn't treat `_content` as
special except at the root.

```ts
const box = await makeTmpBox();
await box.write("_content/people/Dana.person.card", "---\ntype: person\nname: Dana\n---\nDana.\n");
await box.write("_content/team/Ops.doc.card", "---\ntype: doc\ntitle: Ops\n---\nOps.\n");
await box.write(
  "_content/store/notes/_content/team/Ops.doc.card",
  "---\ntype: doc\ntitle: Ops copy\n---\nCopy.\n",
);
await box.write(
  "_content/store/notes/Thread.doc.card",
  "---\ntype: doc\ntitle: Thread\nref: _content/people/Dana.person.card\nrefs:\n" +
    "  - _content/people/Dana.person.card#bio\n  - _content/team/Ops.doc.card\n  - ghosts/Nobody.doc.card\n---\nThread.\n",
);
await box.write("_content/docs/guide.md", "Ask [Dana](_content/people/Dana.person.card).\n");
```

Report mode is an honest preview of the fix: a repair says so, the ambiguous ref
says why it will be left alone, and the ref that resolves neither way keeps the
plain arrow (`--fix` won't write it — the summary's skipped count is what says
so).

```ts continue
const report = await lintCardsDispatch(
  [box.path("_content/store/notes/Thread.doc.card")],
  { boxRoot: box.root, ctx, canonical: true },
);
report.results[0]!.warnings.filter((w) => w.type === "canonical").map((w) => w.message).join("\n")
=>
Non-canonical ref at ref: _content/people/Dana.person.card → /_content/people/Dana.person.card (repairs dangling ref)
Non-canonical ref at refs[0]: _content/people/Dana.person.card#bio → /_content/people/Dana.person.card#bio (repairs dangling ref)
Non-canonical ref at refs[1]: _content/team/Ops.doc.card resolves both ways — /_content/store/notes/_content/team/Ops.doc.card (document-relative, what runs today) and /_content/team/Ops.doc.card (from the box root); ambiguous, left alone
Non-canonical ref at refs[2]: ghosts/Nobody.doc.card → /_content/store/notes/ghosts/Nobody.doc.card
```

Three of the four are counted broken today — the two box-root-intent refs and the
truly missing one:

```ts continue
report.results[0]!.warnings.filter((w) => w.type === "reference").map((w) => w.message).join("\n")
=>
Broken reference at ref: _content/people/Dana.person.card does not exist
Broken reference at refs[0]: _content/people/Dana.person.card#bio does not exist
Broken reference at refs[2]: ghosts/Nobody.doc.card does not exist
```

`--fix` repairs the two (and the dossier's one), refuses the ambiguous ref, and
leaves the dangling one alone. Repairs are their own bucket in the `--json`
payload: they change what a ref points at (from nothing to something), which an
ordinary canonicalization never does.

```ts continue
const fixed = await canonicalizeBox(box.root, { ignore: await loadValidationIgnore(box.root) });
JSON.stringify(fixed)
=> {"refsRewritten":0,"dossierLinksRewritten":0,"refsRepaired":2,"dossierLinksRepaired":1,"ambiguous":1,"filesChanged":2,"skipped":1}
```

```ts continue
formatCanonicalizeReport(fixed)
=> Canonicalized 0 refs and 0 dossier links in 2 files; repaired 2 dangling refs and 1 dossier link that resolve from the box root; 1 ref ambiguous (both readings exist) left alone; 1 left unrewritten (target missing or ref escapes the box)
```

The `#bio` fragment survives the repair, and the ambiguous and dangling refs are
byte-identical to what was written:

```ts continue
await box.read("_content/store/notes/Thread.doc.card")
=>
---
type: doc
title: Thread
ref: /_content/people/Dana.person.card
refs:
  - /_content/people/Dana.person.card#bio
  - _content/team/Ops.doc.card
  - ghosts/Nobody.doc.card
---
Thread.
```

```ts continue
await box.read("_content/docs/guide.md")
=> Ask [Dana](/_content/people/Dana.person.card).
```

Re-validating proves the point end to end: the repaired refs are no longer
counted broken, only the genuinely missing one is.

```ts continue
const after = await lintCardsDispatch(
  [box.path("_content/store/notes/Thread.doc.card")],
  { boxRoot: box.root, ctx, canonical: true },
);
after.results[0]!.warnings.filter((w) => w.type === "reference").map((w) => w.message).join("\n")
=> Broken reference at refs[2]: ghosts/Nobody.doc.card does not exist
```

What's left non-canonical is exactly the pair `--fix` refuses: the ambiguous ref
and the dangling one.

```ts continue
JSON.stringify(canonicalCounts({ cardSummary: after, viewWarnings: [], dossierWarnings: [] }))
=> {"refs":2,"dossierLinks":0}
```

```ts continue
await box.cleanup();
```
