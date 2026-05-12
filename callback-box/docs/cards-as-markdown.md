# RFC: Cards as Markdown + YAML Frontmatter

**Status:** Thinking. Not a decision. May not be implemented.

**Question:** Should cards change format — keeping `Name.type.card` filenames but moving the contents from XML (Zod-validated via cardworks) to Markdown body + YAML frontmatter + Markdoc inline tags (validated by per-type schemas), with related files moving into a sibling `Name.attach/` directory?

This document captures the case for, the case against, the open design problems, and a proposed evaluation plan. Read it as exploratory, not prescriptive.

### A note on terminology

**These are still cards.** The conceptual unit — typed self-contained content with a schema, body, attachments, and refs — doesn't change because the serialization does. The file extension stays `.card` for the same reason: the file's identity in this system is "card," and that's what the extension says. Throughout this RFC, "card" means a card regardless of whether it's stored as XML or Markdown+frontmatter. All the surrounding terminology stays: card type, card schema, card validator, `defineCard`, `getCard`, `cb create <type>`, the card registry. The migration changes how cards are written down, not what they are.

### File naming and card discrimination

**`Foo.<type>.card`** — same pattern as today: basename, type, `.card` extension. The format inside the file changes; the naming convention does not. Examples:

```
Voice_Memo.memo.card
Recipe_Norma.recipe.card
2026-02-01_AI_Winter.news-brief.card
photo-001.image.card
scan-XXXX.capture-session.card
```

**The filename is the canonical type discriminator.** A file is a card if and only if its name matches `<basename>.<type>.card` where `<type>` is registered in the schema registry. There is no `type:` field in frontmatter — that would be a second source of truth that could disagree with the filename. The filename wins because it's visible everywhere (`ls`, `find`, glob, IDE file tree, agent file references) and the registry maps `<type>` to the schema.

**Cards can live anywhere.** No reserved directories. A box can have plain `.md` files for READMEs, scratch notes, or any other markdown content — those simply aren't cards (different extension). The system distinguishes mechanically:

- `Voice_Memo.memo.card` — card (basename `Voice_Memo`, type `memo`)
- `README.md` — plain markdown, not a card
- `Random_Notes.md` — plain markdown
- `Foo.unknown-type.card` — error: filename claims to be a card but type isn't in the registry

Attachments can be plain `.md` files (not cards — they're attached markdown) or cards themselves (e.g., a capture session's photo cards). The `.attach/` scope doesn't restrict the format inside it; cards within an attachment scope are still cards, plain `.md` inside is still plain markdown.

`cb ls` lists files under the box with whatever glob you give it. `cb validate` checks every card. The "is this a card" check is purely filename + registry lookup, no file read needed.

#### Globs

- All cards: `**/*.card`
- All cards of one type: `**/*.memo.card`
- All plain markdown files: `**/*.md`

The two queries (`*.card` and `*.md`) stay disjoint because the extensions are distinct.

#### Tooling implications of the `.card` extension

GitHub, IDEs, and other markdown-aware tooling don't recognize `.card` as markdown by default. Easy to fix:

- **`.gitattributes`**: `*.card linguist-language=Markdown` makes GitHub render `.card` files as markdown.
- **VSCode**: `"files.associations": { "*.card": "markdown" }` in settings (or a workspace-level `.vscode/settings.json` shipped with each box).
- **Other IDEs**: equivalent association mechanisms.

One-time setup, ships with the box. The `.card` identity is paid for in the filename and earned back in tooling configuration — the cost lands once, in a known place.

#### Attachment directory

**`BaseName.attach/`** — basename only, no type qualifier. Examples:

```
Voice_Memo.memo.card
Voice_Memo.attach/
  voice-memo-001.webm

photo-001.image.card
photo-001.attach/
  photo-001.jpg
  photo-001-back.jpg

scan-XXXX.capture-session.card     ← container card; usually uses its own directory as the scope
```

This works unambiguously because of a related rule:

**No two cards in the same directory may share a basename.** `Foo.memo.card` and `Foo.image.card` cannot coexist as siblings — that's a lint error. Each card's basename is unique within its directory, and `Foo.attach/` therefore has exactly one owner.

Why this rule is good rather than restrictive:

- The old XML format used same-basename-different-type for implied pairing (e.g. `Voice_Memo.memo.card` next to `Voice_Memo.m4a`, where the `.m4a` implicitly belonged to the memo). The `.attach/` directory mechanism replaces that pattern explicitly. Keeping both would give two ways to associate files with cards — confusing.
- `cb mv Foo.memo.card` moves `Foo.attach/` if it exists, with no ambiguity about which directory belongs to which card.
- `ls` shows the pairing visually: `Foo.memo.card` next to `Foo.attach/`, same prefix.
- A box where every basename is unique-within-directory is easier to reason about — both for humans and for the `cb mv` rewrite logic.

#### `attach/` as a virtual path prefix

Inside reference values (frontmatter strings or Markdoc tag attribute values), the prefix `attach/` is reserved to mean "this card's own attachment scope." A reference value `attach/photo-002.jpg` resolves to `<basename>.attach/photo-002.jpg` — no need for the writer to spell out the directory.

```yaml
audio: attach/voice-memo-001.webm
filename:
  ref: attach/photo-002.jpg
  captured: 2026-04-29T03:20:56Z
```

```markdown
{% image-ref ref="attach/photo-001.jpg" /%}
```

Resolution rules for any reference value:

- Starts with `attach/` → virtual; this card's attachment scope
- Has a URI scheme (`https://`, `http://`, `mailto:`, etc.) → external URL
- Anything else → literal path (relative to card's directory if no leading `/`, box-root absolute if leading `/`)

The `attach/` prefix being reserved means a real directory literally named `attach/` is forbidden **anywhere in the regular box tree** (lint error) — not just at the root. The one place this rule loosens is inside an attachment scope: `Foo.attach/` directories are more free-form, and contents can be named whatever fits the data.

Underscore-prefixed directories (`Foo.attach/_files/`, `Foo.attach/_raw/`, etc.) are conventionally treated as opaque by lint and most queries — useful when an agent or pipeline really needs to dump arbitrary unpacked content somewhere without each file being scrutinized. The convention is "underscore-prefixed = don't look inside."

Virtual interpretation in reference values only fires when `attach/` is the *first* path segment of a value — mid-path occurrences (`store/captures/audio-001.attach/clip.webm`) are literal directory names within `Foo.attach/` scopes, not virtual prefixes.

## Today's format (for reference)

Cards are XML files validated by Zod schemas defined with cardworks `element()`. Filename pattern: `Name.type.card`. Attachments share the basename:

```
inbox/scan-XXXXX/
  photo-001.image.card        ← XML card
  photo-001.jpg                ← attachment (front)
  photo-001-back.jpg           ← attachment (back)
  photo-002.image.card
  photo-002.jpg
  scan-XXXXX.capture-session.card
  source.file.card
  source.pdf
```

Card body example:

```xml
<image status="analyzed" has-text="true">
<filename ref="photo-002.jpg" captured="2026-04-29T03:20:56Z" source="gallery"/>
<description>A baby with light hair sits on a wooden porch...</description>
<text source="back">A</text>
<text source="back">184</text>
<subject-bbox y1="90" x1="70" y2="930" x2="930"/>
</image>
```

Cross-card references use a uniform `ref="..."` attribute pointing at a path.

## Proposed format

```
inbox/
  scan-XXXXX.capture-session.card
  scan-XXXXX.attach/
    photo-001.image.card
    photo-001.attach/
      photo-001.jpg
      photo-001-back.jpg
    photo-002.image.card
    photo-002.attach/
      photo-002.jpg
    source.file.card
    source.attach/
      source.pdf
```

Note the uniform `Foo.attach/` rule — capture session children live inside `scan-XXXXX.attach/`, same as any other card's attachments. The session card and its attachment dir share the basename; nested cards (image, file) follow the same pattern recursively.

Card body example (initial sketch — later sections refine the schema and use Markdoc tags for inline structure):

```markdown
---
status: analyzed
has-text: true
filename:
  ref: attach/photo-002.jpg
  captured: 2026-04-29T03:20:56Z
  source: gallery
subject-bbox: { y1: 90, x1: 70, y2: 930, x2: 930 }
---

A baby with light hair sits on a wooden porch...

{% text source="back" %}
Notes from the back: A.
{% /text %}
```

Note: the type (`image`) lives in the filename, not in frontmatter. Schemas move from cardworks `element()` to per-card-type definitions in `.ts` files (Zod for frontmatter shape + Markdoc tag definitions for body content + optional code validators). See the Schema authoring section for details.

## The case for

### 1. Easier to explain (and less friction in agent use)

> "A box is mostly markdown files. Each one has frontmatter saying its metadata. Anything attached to a card lives in a sibling `.attach/` directory."

That's the whole pitch. Today's pitch involves "XML cards validated by Zod via cardworks, with sibling files matched by basename" — true, but more concepts.

The friction this saves shows up in agent behavior: less correction needed to get the agent to comply with conventions, less re-prompting around "no, write the card like this." Coding agents have a strong training-data bias toward producing markdown when asked to write a structured document, and they fight that bias slightly when asked to produce XML. The friction is small per-instance but compounding across hundreds of card writes per box.

This is the load-bearing reason. The other items below are real but secondary.

### 2. Attachment directories normalize ownership

Today the inbox is a flat soup of cards and binaries; a fresh agent has to infer that `photo-001-back.jpg` belongs to `photo-001.image.card` by basename matching. With `.attach/` directories, ownership is mechanical: anything inside `Foo.attach/` belongs to `Foo`. Searches scoped to a card become a directory walk.

This benefit is fully independent of the body-format change. We could adopt `.attach/` while keeping XML cards — and should, as phase 1, regardless of whether phases 2–4 happen.

### 3. Prose content goes in the body where prose belongs

`<content>...</content>`, `<description>...</description>`, `<transcription>...</transcription>` are all wrappers for what is fundamentally a prose body. Markdown bodies don't need a wrapper. Editing a memo in any text editor is just typing.

(Note: today the XML text inside `<content>` etc. is already treated as markdown when rendered. The change is "drop the wrapper element," not "introduce markdown.")

### 4. JSON Schema as agent-readable documentation

Less about portability (the cross-language story is real but not what we need); more that **agents read JSON Schema natively**. When the per-card-type doc embeds the actual schema as a JSON code block, the agent gets the spec in a format it can reason about directly — no custom prose rendering in between. See the schema-authoring section.

External tools can also consume JSON Schema (form generators, IDE validators) but that's a side benefit.

### 5. Format-neutral on markdown-vs-XML for the agent

Agents handle both markdown and XML well. XML is also "native" — it's not the case that markdown is intrinsically more legible to an LLM. The training-data bias toward markdown for free-form writing is real (see #1), but XML's self-documenting tags are a genuine advantage that markdown gives up.

This proposal trades XML's tag self-documentation for the friction reduction in #1 and the uniform inline-tag system Markdoc provides. It's a swap, not an unambiguous win on the format-quality axis.

## The case against

### 1. Several card types don't fit the "metadata + one body" mold

- **`memo`** has `<content>` AND `<transcription>` — both prose. Pick one for the body and the other is awkward in frontmatter (a multi-line YAML block string) or you invent a body-section convention (`## Transcription`).
- **`image`** has `<description>` (prose) plus multiple `<text source="back">` items (also prose, but structured). Texts must go in frontmatter as a list of objects with multi-line values, which is awkward YAML.
- **`capture-session`** has no prose at all — the body would always be empty. Fine, but signals that "body" isn't a unifying concept.
- **`procedure-run`** mixes structured step records with their outputs; not a clean prose/metadata split.

The fix is a convention: "primary prose goes in the body; everything else, including secondary prose, is frontmatter." Workable but it's a new layer that today's "everything in XML" avoids.

### 2. JSON Schema is verbose for repeating heterogeneous children

cardworks `element()` was designed around the patterns we use: arrays of unioned child elements with loose order, attribute typing with Zod, ref validation. JSON Schema can express all of this, but `oneOf` arrays of object schemas with discriminator properties are verbose and awkward to author by hand. We'd want to keep authoring schemas in Zod and emit JSON Schema as a build artifact — and as a downstream concern, **review the emitted JSON Schema for agent legibility**, because Zod-derived JSON Schemas can sometimes be ugly enough to undermine the "agents read JSON Schema as docs" benefit. See the schema-authoring section.

Some of this verbosity is absorbed by the Markdoc body tags: the schemas that today have `z.array(z.union([…]))` for child elements often translate to "this card allows these body tag types" rather than a complex JSON Schema array shape. Where the unioned-children pattern survives into frontmatter (e.g. `news-brief.curation.children`), it'll need restructuring during the migration rather than mechanical translation.

### 3. Migration is large and easy to half-finish

Surfaces affected:
- ~30 card type schemas in `src/schemas/`
- Each schema's loader, JSX template, renderer
- `cb validate`, the validation hook, the pre-commit plugin
- Card-aware code in `src/core/`, connectors, the wakeup cycle, scenario fixtures, doctests
- Every existing box (test1 has hundreds of cards in archive)
- The frontend: file viewers, source editor, doc graph, file index
- cardworks itself — rename or repurpose

Mid-migration is the worst possible state: agents seeing both formats and unclear which is canonical. We'd want a hard cut-over per-card-type with a migrator, not a gradual coexistence.

### 4. We lose investment in cardworks

Cardworks already does parsing, serialization, formatting (the flat-no-indent rule that keeps diffs clean), JSX templating, validation. It's not a huge codebase but it's tested and stable. JSON-Schema-based replacements would need to relearn some lessons (e.g., what's the equivalent of "no indentation, one paragraph per line" for YAML frontmatter? YAML is whitespace-sensitive — diffs may be worse, not better).

### 5. The `Foo.attach/` indirection is slightly verbose

Today: `ref="photo-001.jpg"`. Tomorrow with the explicit prefix: `ref: attach/photo-001.jpg`. A small cost, paid uniformly. The `attach/` virtual prefix discussed later in this doc resolves this — the prefix lets the writer use just the filename, with the card's `.attach/` directory inferred.

(Note: "refs lose their uniformity" was an earlier concern in this section that's been removed. Refs in the new format are tracked as discussed in the Ref design section — the same vigilance the XML format already requires applies here too, just with `ref:` as the convention instead of an XML attribute. The earlier sentinel-string idea was overcomplication.)

## Open design problems

Several of these are now resolved; the resolutions are recorded inline below. Items still open are flagged.

### A. Body-vs-frontmatter rule — RESOLVED

**Rule:** Primary prose in body, everything else in frontmatter, body is optional.

Where a card has multiple prose blocks (memo content + transcription, audio transcript + summary, etc.), the secondary prose goes into Markdoc block tags within the body. The "transcription" of a voice memo is `{% transcription %}...{% /transcription %}`, not a `transcription:` field in frontmatter.

**Possible future extension: multiple equally-primary bodies via reserved `{% body %}` tag.** Not needed for current schemas (Markdoc block tags cover the multi-prose cases), but worth keeping in mind for future card types that might genuinely need it. Sketch:

```markdown
---
status: new
---

Default body content (the unnamed primary body — `card.body`).

# Can include H1 headings naturally.

{% body name="notes" %}
A separate body, its own free-form markdown with headings, lists, anything.

## Subsections work normally inside.
{% /body %}

{% body name="transcription" %}
Another named body. Schema declares which names are allowed.
{% /body %}
```

Schema would declare `bodies: ["notes", "transcription"]`. Parser splits the document, returning `card.body` for the default and `card.bodies.notes` / `card.bodies.transcription` for the named ones.

Other delimiter options considered and rejected: H1 headings as section boundaries (collides with H1s in content), fence-style `~~~ name ~~~` (visual collision with code blocks), `----- name -----` long-dash (arbitrary, no benefit over Markdoc tags), YAML multi-document `---` (conflicts with frontmatter).

### B. Are some cards directories? — RESOLVED via attachments

The "uniform `Foo.attach/`" rule from earlier in this doc resolves this: capture-session children live in `scan-XXXXX.attach/` like any other card's attachments. There's no special "directory IS the card" case — cards always have a single file, and attachments always live in a sibling `Foo.attach/` directory.

#### Still open: tagging cards and category polymorphism

A related question doesn't fully resolve with attachments: how do "tagging" cards relate to their directory? Landmarks bookmark a directory (`store/recipes/Recipes.landmark.card`). Future triage-destination markers might similarly mark a directory. Categories with associated procedures might too. These don't have a clear primary-owner relationship — they're peer attributes of the directory itself.

Three plausible models:

1. **Peer cards in the directory** (current pattern for landmarks). Each tagging card is a sibling in the directory. The directory is what's being tagged, not any single card.
2. **One card owns the directory; others attached to it.** An arbitrary "main" card claims ownership; tagging cards live in its `.attach/`. Forced and unnatural for things that genuinely are peers.
3. **Multiple-types-per-basename** (would require relaxing the no-collision rule). `Recipes.landmark.card` + `Recipes.category.card` + `Recipes.triage-destination.card` as peer-typed views of the same conceptual object — ECS-style. Strongly associated, share a basename.

(1) is what we have today and continues to work under the new format. (3) is interesting but conflicts with the no-basename-collision rule we adopted for attachment-dir disambiguation.

This is genuinely open. The "cards all the way down — every directory is a card with a header about what the directory is for" line of thinking is a bridge too far for now, but it's the underlying intuition. Worth revisiting after living with the new format.

### C. Refs — RESOLVED

Decisions:
- **Bare strings in schema-declared fields:** rejected. Too high-context; the value's meaning depends entirely on schema knowledge, which makes the file unreadable without it.
- **String with prefix** (`ref:photo-001.image.card` or `attach/foo.jpg`): viable. The `attach/` virtual prefix we adopted IS this approach for attachment paths. Easy to grep (search the value, not just keys). Works for content situations and lists.
- **Object form** (`{ ref: "..." }`): viable. Verbosity is a feature — self-documents as a ref, makes JSON Schema validation explicit, and we're usually adding sibling annotations (`reason`, `usage`) anyway, so the object wrapper isn't extra structure for those cases.

The design as it stands uses object form `{ ref: "..." }` for refs that wrap metadata, and bare paths with the `attach/` virtual prefix for attachments. The Ref design section details this.

### D. Schema authoring — RESOLVED

Author in Zod; emit JSON Schema as build artifact. Review the emitted JSON Schema for agent legibility (see schema-authoring section); restructure Zod or hand-write JSON Schema if the output is ugly enough to undermine the docs use.

### E. Migration strategy — RESOLVED

**For phase 1 (`.attach/` adoption):** standalone, no body-format change, can happen before any of the rest. Fixes a real cleanliness wart in the current ad-hoc system.

**For phase 2+ (body format change):** big bang on a branch — convert everything, test throughout, merge as a single switchover. Per-card-type incremental migration creates a coexistence period that's worse than either format alone. We accept the longer branch time as the price of avoiding mid-migration confusion.

**If we do phase 2+, cardworks goes away.** The new system uses Markdoc + Zod + custom helpers. Cardworks' XML parser, JSX templating, and validation primitives all get replaced. The cardworks repo would either be archived or removed.

### F. Name of the body field — RESOLVED

The parsed card object exposes frontmatter fields at the top level alongside `body`:

```ts
card.status        // from frontmatter
card.created       // from frontmatter
card.source        // from frontmatter
card.body          // the parsed body (Markdoc tree)
```

No `card.frontmatter` wrapper. Frontmatter fields ARE card fields.

**`body:` is banned as a frontmatter key.** No collision possible because the body of the card is `card.body` directly. If a schema needs a field called something other than the obvious — fine, pick a different name; `body` is reserved.

If the multi-body extension (section A) is ever implemented, `card.body` stays as the default-unnamed-body, and named bodies live at `card.bodies.<name>` (or `card.<name>` if we decide named bodies are top-level too — to be revisited).

## How to tell if it works

The honest assessment after working through the design: **quantitative tests are hard to do without doing the full conversion first.** The thing the proposal optimizes for is cognitive overhead — fewer corrections to agents, less re-prompting, less context-juggling — and that doesn't show up in tool-call counts as cleanly as we'd like. The qualitative checks are where the signal actually lives.

### Quantitative (hard to do without committing first)

1. **Ledger-box clone-and-migrate test.** Take a complex real box (the ledger box is a good candidate — many card types, rich history), clone it, run the migration on the clone, then run a fixed set of agent tasks against both. Compare. **Big effort upfront** — you'd have to have most of the migration done before this test produces signal. The reward isn't a clear win/loss verdict so much as a "feel" for whether the new format is easier to work in.

2. **Schema expressiveness audit** (can run before full conversion). Convert every existing schema in `src/schemas/` to (Zod →) JSON Schema + frontmatter shape + bodyTags + validators. For each, note: clean / mildly awkward / fights the format. The per-schema feasibility audit earlier in this RFC already did most of this; doing it again after the actual schema-authoring helpers exist would catch surprises.

3. **Code volume delta.** Lines of code for the new format (schemas, loaders, validation, renderers, migrator) vs. today's cardworks-based code. Indirect signal but interesting.

These quantitative checks are useful but they require sunk effort to produce signal. Treat them as confirmations during/after the migration, not gates before.

### Qualitative (easier; this is where the real signal lives)

4. **Explanation-length test.** Re-write the "Cards" section of `CLAUDE.md` for the new format. If it's not shorter and clearer, the "easier to explain" claim is bogus. Quick to do; high-signal.

5. **Editability test.** Open ten randomly selected cards in a plain editor (not the box UI). How readable, how editable, how scary-if-mistyped? Compare to XML. Quick to do.

6. **Migration friction record.** Keep a running log during the conversion of each card type: what was awkward, what required convention invention, what JSON Schema couldn't quite express, where Markdoc tags helped or hurt. The size of this log is the actual cost; entries are themselves useful for the design.

7. **Agent-correction-rate observation.** Over a few weeks of normal use after migration, note how often you have to correct the agent's card writes. Compare to recollection of the XML period. Subjective but probably the most honest signal of whether the friction reduction is real.

### Decision criterion

For phase 1 (`.attach/`): feels-right is enough. Cleaner ad-hoc layout is its own justification; no measurement needed.

For phase 2+ (body format change): proceed if the migration friction record stays short AND the explanation-length test shows meaningful simplification AND the agent-correction observation suggests real reduction. Skip or roll back if any of those don't show up.

## Possible incremental paths

If full migration looks too expensive, smaller versions:

1. **Just the attachment directory change.** Keep `.card` XML, but introduce `.attach/` directories for binary siblings. Lowest cost, captures the "ownership normalization" benefit. Also serves as a low-risk dress rehearsal.

2. **One card type pilot.** Convert just `memo` (best fit for the format). Live with both formats for a quarter. Decide based on real friction. Risk: coexistence is the worst state.

3. **Front-matter-in-XML.** Keep `.card` files but wrap with a YAML frontmatter block for the structured parts and use the body for prose. Hybrid; probably uglier than either pure form.

4. **JSON Schema artifacts only.** Stay in XML, but emit JSON Schemas from the existing Zod schemas as a portability artifact for external tooling. Decoupled from the file-format question.

(1) and (4) are clearly low-risk wins regardless of the full proposal.

## Recommendation (tentative)

**Phase 1 (`.attach/`) is unambiguously worth doing**, regardless of whether the body-format change ever happens. The current layout is ad hoc — sibling binaries that pair by basename, no clear "this file belongs to that card" rule. The cleanup is its own justification. It's not optimized for agent legibility (that's not really the point); it's optimized for not-being-ad-hoc.

**Phase 2+ (body format change) is a separate judgment.** Worth doing if the cognitive-overhead reduction is real, which the explanation-length test and lived experience after migration can confirm. The case is mostly about easier-to-explain and reduced agent-correction friction, not measurable quantitative wins. If the qualitative signals after phase 1 don't suggest improvement is needed, don't do phase 2.

**If phase 2+ does happen, cardworks goes away.** The new system uses Markdoc + Zod + custom helpers; cardworks' XML parser, JSX templating, and validation primitives all get replaced. The cardworks repo would be archived. (Phase 1 alone doesn't affect cardworks — it stays as the XML library.)

**Migration shape for phase 2+:** big bang on a branch. Convert everything, test throughout, merge as a single switchover. Per-card-type incremental migration creates a coexistence period that's worse than either format alone. The branch will be long-lived; that's accepted.

## Open questions for the next pass

- Does cardworks have callers outside callback-box? (Affects renaming/deprecation cost.)
- How many existing boxes are out there, and who maintains them?
- What's the format of the source-of-truth in callback-clerk (the Chrome extension)? Does it produce cards directly, or via API?
- How big is the surface in the frontend that's coupled to the XML structure (renderers, source editor, doc graph)?

## Per-schema feasibility audit

For each registered schema, five questions:

1. **Body** — what's the primary prose? Is it obvious?
2. **JSON Schema** — does the existing structure translate cleanly?
3. **Attachments** — does it have any? Are they explicit or implicit? Does `Foo.attach/` help?
4. **YAML weight** — does converting force large prose into frontmatter strings?
5. **Refs** — does YAML handle the existing ref patterns?

Verdicts: ✅ clean, ⚠️ awkward, ❌ fights the format.

Skim the table; the awkward cases drive everything.

| Schema | Body | JSON Schema | Attachments | YAML weight | Refs |
|---|---|---|---|---|---|
| `memo` | ✅ `<content>` is obvious. ⚠️ Voice memos have `<transcription>` too — second prose block needs a frontmatter `\|`-block or a `## Transcription` section convention. | ✅ Flat, simple. | ⚠️ Voice memos have a sibling audio file. `.attach/` helps a little, but the audio is the only attached file ever — overkill. | ⚠️ If transcription stays in frontmatter, one `\|`-block per voice memo. | ✅ `<context url=…>` is URL not card-ref; trivial. |
| `question` | ⚠️ Three prose blocks: `<prompt>` (the question), `<memo>` (context), `<directive>` (follow-up). None is clearly "the body." Likely all in frontmatter. | ✅ Discriminated `<input type=…>` works as oneOf. | ✅ None. | ✅ All short. | ✅ `<context ref=…>` works fine. |
| `news-item` | ⚠️ Two candidates: `<content>` (full fetched article, sometimes huge) is body; `<summary>` (RSS description) goes to frontmatter. Decent split. | ⚠️ Doable; `<analysis>` block has 7+ optional fields and topics/questions arrays. | ✅ None. | ✅ Article goes in body where it belongs. | ✅ Links are URLs, not card refs. |
| `news-summary` | ✅ `<content format="markdown">` IS the body. Cleanest case. | ✅ Trivial. | ✅ None. | ✅ Sources list is short objects. | ✅ Source paths as objects/strings. |
| `news-brief` | ❌ This is the hardest case. `<content>` has markdown that **interleaves** with structural elements: `<section>`, `<expando>`, `<query>`, `<excerpt>`, `<user-comment>`. The body isn't plain markdown — it's structured-markup-with-prose. Three options, all bad: (a) keep MDX-style component tags inline (custom parser), (b) flatten everything into frontmatter (loses narrative flow), (c) use HTML in markdown (back to XML-in-disguise). | ❌ Same problem in JSON Schema form. The inline mixed-content can be modeled as an array of typed nodes, but it's not "data" anymore — it's a tree of prose chunks and components. | ✅ None. | ⚠️ Curation block has structured prose (rationale, hypotheses) — fits but adds weight. | ✅ Source paths fine. |
| `news-guide` *(deprecated)* | ❌ No prose body. All structured: interests, disinterests, preferences, context-notes, experiments, reactions. | ⚠️ Doable but verbose — many lists of objects with confidence/source/ref fields. | ✅ None. | ⚠️ Experiment hypothesis/approach/conclusion are paragraphs; OK as `\|`-blocks. | ✅ Many `ref` attrs everywhere — needs strict convention. |
| `feedback` | ⚠️ `<response>` or `<comment>` is the prose; voice feedback adds `<transcription>`. Same multi-prose pattern as memo. | ✅ Discriminated text/voice union. | ⚠️ Voice feedback has audio. `.attach/` helps. | ⚠️ Transcription as `\|`-block. | ✅ `<target ref="path#fragment">` is well-defined. |
| `procedure` | ❌ No prose body. Steps with phases (precheck/run/validate), each containing shell/agent/instruction/why. Deeply nested structured config. | ⚠️ Doable; nested phase children as discriminated union. | ✅ None. | ⚠️ Shell commands and agent prompts are multi-line strings. `\|`-blocks throughout. | ✅ None. |
| `procedure-run` | ❌ No prose body. Execution log: steps with status, stdout, session-id, git-ref, review. | ✅ Clean. | ⚠️ `<stdout>` can be huge. Strong argument for moving stdout into `run.attach/step-N.stdout.txt` files instead of inline strings — same problem the XML form has, format change is an opportunity to fix it. | ❌ Without stdout-as-file, frontmatter would balloon. | ✅ None. |
| `image` | ⚠️ `<description>` is the obvious body. But `<text source="back">` elements (multiple, can be long) are also prose extracted from the image. Picking one for the body forces the other into frontmatter as a list of `\|`-blocks. | ⚠️ Doable; `<filename>` and `<exif>` are flat, `<text>` is array, `<document>` has nested `<date>`. | ✅ **Strong fit for `.attach/`.** Today: `photo-001.jpg`, `photo-001-back.jpg`, sometimes EXIF dumps live as siblings. `photo-001.attach/` cleanly contains them. | ⚠️ Multiple `<text>` blocks could be heavy. | ✅ `<filename ref=…>` becomes a path inside the attachment scope. |
| `audio` | ⚠️ `<transcript>` is the obvious body. `<summary>` is also prose. Same problem. | ✅ Clean. | ✅ **Strong fit for `.attach/`.** `audio-001.webm` + `audio-001.timing.json` siblings → `audio-001.attach/`. | ⚠️ Summary in frontmatter as a `\|`-block. | ✅ Filename ref. |
| `file` | ⚠️ `<description>` is the natural body, but it's typically empty or one sentence. | ✅ Clean. | ✅ **Strong fit.** The file itself IS the attachment. `tax-return.attach/tax-return.pdf`. | ✅ Tiny. | ✅ Filename ref. |
| `capture-session` | ❌ No prose body. Container card with refs to image/audio/file cards plus a `<transcript>` of interleaved `<text>`/`<silence>`/`<image>`. | ⚠️ Mixed-content `<transcript>` is the awkward part — array of typed nodes (text/silence/image-marker). | ⚠️ Container card. Today the directory IS the session; siblings are the children. With the new format, either: (a) keep using the directory as the scope (no `.attach/`), or (b) treat sub-cards as members of the parent `.attach/`. (a) is more natural. | ⚠️ The transcript array can be long with multi-line text segments. | ✅ Many refs to child cards — works as object list. |
| `record` | ⚠️ Two candidates: `<content>` (verbatim text of a document) is body for textual records; `<description>` (context about the thing) is shorter, lives in frontmatter. Convention works but isn't self-evident. | ⚠️ Many optional fields (date/person/location/measure) with attrs+text — repetitive but expressible. | ✅ Rare. | ⚠️ `<content>` can be very long — body is the right place. | ✅ Source refs, person refs, location refs — all clean. |
| `recipe` | ⚠️ `<description>` is the obvious body. But sections, ingredients, steps, notes are all structured AND contain prose. Steps have `@`-syntax for inline ingredient refs (custom syntax — survives in either format). | ⚠️ Sections with ingredients (amount/unit/text) and steps. Tractable. | ⚠️ Optional `<image src=…>`. Minor `.attach/` win. | ⚠️ Steps in frontmatter would be ugly; better as a body section list. Forces a body-sections convention for multi-prose cards. | ✅ Image src as path. |
| `email-thread` | ❌ No prose body. Pure metadata + message refs. | ✅ Clean — flat metadata with arrays. | ⚠️ Container card, like capture-session. The thread directory contains message cards and `attachments/`. Same choice as capture-session. | ✅ Small. | ✅ Message refs. |
| `email-message` | ✅ Snippet only; the actual body **is already** in a sibling `.txt` file (security boundary). The card is metadata-only by design. | ✅ Clean. | ✅ **Strong fit for `.attach/`** — the body `.txt` and binary attachments naturally belong inside. Already half-there with the sibling-`.txt` convention. | ✅ Snippet is short. | ✅ body-file path, attachment refs. |
| `email-outbound` | ✅ `<body>` IS the body. **Cleanest fit.** Markdown subset already enforced. | ✅ Clean. | ✅ None today (future attachments would fit `.attach/`). | ✅ Body in body. | ✅ in-reply-to ref. |
| `news-job` | ⚠️ `<description>` is one short sentence — body is trivial or empty. Mostly a list of item refs. | ✅ Clean. | ✅ None. | ✅ Tiny. | ✅ Item refs as list. |
| `intake-job` | Same as `news-job`. | ✅ | ✅ | ✅ | ✅ |
| `calendar-review-job` | ⚠️ `<description>` is short. `<change>` items can carry embedded `<ics>` content (multi-line iCal). | ✅ Clean. | ⚠️ Embedded ICS content could move to attached `.ics` files (`change-N.ics`) instead of inline. | ⚠️ Inline ICS is a `\|`-block; not great. | ✅ Change refs. |
| `guide-revision-job` | Same as `news-job`. | ✅ | ✅ | ✅ | ✅ |
| `chat-job` | Same as `news-job`. | ✅ | ✅ | ✅ | ✅ |
| `question-followup-job` | Same as `news-job`. The directive and answer are short. | ✅ | ✅ | ✅ | ✅ |
| `guide` | ❌ No prose body. Triage rules, named actions (with when/instructions), experiments, reactions, context-notes. Everything is structured. | ⚠️ Verbose but mechanical. | ✅ None. | ⚠️ Action `<instructions>` and rule text are paragraph-ish. `\|`-blocks. | ✅ Many refs. |
| `scheduled-script` | ❌ No prose body. Pure config: cron/at/rrule, runs, requires. | ✅ Clean. | ✅ None. | ⚠️ `<runs>` shell command can be multi-line. `\|`-block. | ✅ source ref, connector names. |
| `telegram-message` | ✅ `<text>` IS the message. Clean fit. | ✅ Clean. | ✅ None. | ✅ Message text in body. | ✅ None. |
| `chat-thread` | ❌ Append-only timeline of `<message>` and `<seen>` elements. Each message text is prose, but the structure is a sequence. Translating a long chat history to a YAML array of objects with multi-line `text:` fields produces noisy diffs and slow parses. **YAML is genuinely worse here than XML.** Consider keeping this format as `.chat-thread.jsonl` or similar (one event per line) regardless of what happens to other cards. | ⚠️ Doable as oneOf array. | ✅ None today. | ❌ Long threads → very long frontmatter or very long body of stringified events. | ✅ Person refs, message ids. |
| `personality` | ⚠️ `<description>` (compiled personality paragraph inside `<traits>`) is a candidate, but tone/traits/unresolved/boxholder are also prose. Description-in-body works but the others crowd frontmatter. | ⚠️ Multiple optional structured fields with confidence/source/ref attrs. | ✅ None. | ⚠️ Tone instructions and trait texts are paragraph-ish. | ✅ Refs throughout. |
| `todo-list` | ❌ No prose body. Items (recursive) with details/agent-notes children. | ⚠️ Recursive item structure works in JSON Schema via `$ref`. | ✅ None. | ⚠️ Nested items as nested YAML lists — gets visually hard to follow at depth >2. | ✅ None. |
| `briefing` | ⚠️ `<purpose>` (short), `<agent-needs-to-know>` (longer paragraph) are both prose. Putting agent-needs-to-know in body, purpose in frontmatter is workable. | ✅ Mostly flat with key-people array and corrections array. | ✅ None. | ⚠️ agent-needs-to-know is paragraph-length. | ✅ Person refs. |
| `person` | ✅ `<notes>` is the natural body. Other fields are short scalars. Decent fit. | ✅ Clean. | ✅ None typically (a portrait could live in `.attach/`). | ✅ Notes in body. | ✅ None directly. |
| `sheet` | ❌ No prose body. Metadata pointing to JSON tab files. | ✅ Clean. | ✅ **Already uses sibling directory pattern** (`Budget/` next to `Budget.sheet.card`). Renaming to `.attach/` is mechanical. | ✅ Tiny. | ✅ Sheet-tab refs. |
| `doc` | ✅ **No body needed** — the doc body lives in a sibling `.md` file (`Project_Notes.md`). Card is metadata-only by design. | ✅ Clean. | ✅ **Already uses sibling-file pattern.** Move into `.attach/`. | ✅ Tiny. | ✅ `<content ref=…>`. |
| `landmark` | ❌ No prose body. Bookmark structure: label, symbol, links, expand templates. | ⚠️ `<link ref=…>` vs `<link template-ref=…>` distinction must survive — different validation rules. Two link variants in oneOf. | ⚠️ Optional portrait via `<symbol src=…>`; minor `.attach/` use. | ✅ Tiny. | ⚠️ Two ref kinds (literal vs template) need careful schema design. |

### Patterns

Counting verdicts on the body question (most consequential):

- **✅ Clean fit (5)**: `news-summary`, `email-outbound`, `email-message`, `telegram-message`, `person`. Plus `doc` (which doesn't need a body — already split).
- **⚠️ Workable with conventions (15)**: `memo`, `question`, `news-item`, `feedback`, `image`, `audio`, `file`, `record`, `recipe`, `news-job`, `intake-job`, `calendar-review-job`, `guide-revision-job`, `chat-job`, `question-followup-job`, `briefing`, `personality`. Most need a "primary prose in body, secondary prose in frontmatter `\|`-blocks" rule.
- **❌ Genuinely fights the format (8)**: `news-brief`, `news-guide`, `procedure`, `procedure-run`, `capture-session`, `guide`, `chat-thread`, `landmark`, `todo-list`, `sheet`, `scheduled-script`. Subdivides further:
  - **No prose body, all structure** (`guide`, `news-guide`, `procedure`, `procedure-run`, `landmark`, `sheet`, `scheduled-script`, `todo-list`): the markdown body literally has no purpose. Frontmatter-only is fine but raises the question "why is this a `.md` file at all?"
  - **Mixed-content narrative** (`news-brief`): markdown body interleaved with structured elements that aren't naturally collapsible to frontmatter. The hardest single case.
  - **Append-only timeline** (`chat-thread`, `capture-session.transcript`): YAML arrays of long-string events produce worse diffs and worse parse cost than today's XML. Genuine regression.

### What this tells us

1. **`.attach/` is a clear win** for the cards that have attachments: `image`, `audio`, `file`, `email-message`, `sheet` (rename), `doc` (rename). Six clean wins. For `capture-session` and `email-thread`, the choice between "directory IS the scope" vs "directory contains a sentinel card + `.attach/`" is real and needs a call. **None of this needs the body-format change.**

2. **The body/frontmatter rule is workable but not free.** Three-quarters of schemas need a rule like "primary prose in body, secondary prose in `\|`-blocks, structural data in frontmatter." That rule is teachable but it's a new layer that today's "everything in XML" doesn't have.

3. **A handful of schemas are actively worse in YAML/markdown.** `chat-thread` and `procedure-run.stdout` would balloon frontmatter unless we move them to attached files. `news-brief`'s inline structure either becomes MDX-style components or gets flattened into a worse representation. These cases alone don't kill the proposal but they're the ones to design against.

4. **About a third of schemas would have empty bodies.** `guide`, `procedure`, `landmark`, `sheet`, `scheduled-script`, `todo-list`, all the `*-job` cards. For those, "card as markdown" means "frontmatter-only file." That's coherent — but it's a different value proposition than "use markdown for prose content." If the goal is agent legibility, an empty body adds nothing; if the goal is uniformity of file extension, it's fine.

5. **Refs are uniformly easy to translate.** Every existing ref pattern fits into either `{ ref: "path" }` objects in frontmatter or path strings in known fields. Convention to settle, not a hard problem. The `landmark` `ref` vs `template-ref` distinction needs deliberate schema design but isn't blocked.

6. **JSON Schema translation is mechanical for ~24, awkward for ~9, and never blocked.** The pattern that consistently produces verbose JSON Schema is "loose array of children of unioned types" (the cardworks `element({ children: z.array(z.union([...])) })` shape). It's fine but you'll write `oneOf: [...]` a lot.

### Sharpened recommendation (initial — superseded below)

This was the recommendation before considering structured-body markup options. See the [revised recommendation](#revised-recommendation-after-considering-markdoc) at the end of the doc, which changes several of these calls.

1. **Definitely do the `.attach/` change** for the six clear-win schemas (`image`, `audio`, `file`, `email-message`, `sheet`, `doc`) and the two container-cards (`capture-session`, `email-thread`). That's a concrete, separable improvement that captures the strongest claim ("ownership is mechanical") and doesn't depend on changing the body format.

2. **Pilot the body format on the five cleanly-fitting schemas** (`memo`, `news-summary`, `email-outbound`, `telegram-message`, `person`) before committing to the full migration.

3. **Keep `chat-thread` in a different format** (likely JSONL) regardless.

4. **Don't do `news-brief`, `procedure`, or `guide` in the new format** until everything else is proven.

## Format choice for structured-prose bodies

The proposal so far has said "Markdown body + YAML frontmatter" without specifying what *kind* of markdown. That choice matters a lot — it determines whether multi-prose schemas need awkward conventions, whether inline refs are natural or clumsy, and whether several "empty body" cards become useful or stay empty.

### Requirements

For our case the format must:

1. **Allow structured elements inside markdown body** with attributes — for `<section>`, `<expando>`, `<excerpt>`, `<query>`, `<text source="...">`, etc.
2. **Render markdown inside those elements** — section bodies are prose with formatting.
3. **Support inline embedded elements** — for refs to people, locations, dates, cards inside flowing prose.
4. **Schema-validate** — same discipline cardworks gives us today: known elements, known attributes, attribute types.
5. **Track source line numbers** — for error messages, "open this card at line N," editor jump-to-source. Sub-line precision not required.
6. **No code execution** — boxes are data, not programs. The format should not be Turing-complete and should not allow arbitrary expressions.

### Options surveyed

| Option | Syntax | Markdown-inside | Schema validation | Inline tags | Position info | New dep |
|---|---|---|---|---|---|---|
| HTML-in-CommonMark + DIY validator | `<tag attr="...">` | Parser-dependent ⚠️ | DIY | Via inline HTML | Two-AST bridge ⚠️ | None |
| Directives (`remark-directive`) | `:::name{attrs}` | Native ✓ | DIY | `:name[text]{attrs}` ✓ | Native (unified) ✓ | Parser plugin |
| Markdoc | `{% name %}...{% /name %}` | Native ✓ | **Built-in** ✓ | Same syntax inline ✓ | Tag-level ✓ | Markdoc parser |
| MDX | `<Tag attr={x}>` (JSX) | Subtle rules ⚠️ | Plugin-based | Yes | Native ✓ | MDX compiler |
| Djot | `:::name` blocks | Native ✓ | DIY | Spans `{...}` | Native ✓ | Djot parser |
| AsciiDoc | `[#id.class,attr=v]` blocks | N/A (own format) | Built-in ✓ | Limited | Block-only | Asciidoctor |

### Why Markdoc wins for this project

**Schema-first design.** Markdoc tags are defined as TypeScript objects with `attributes` and `children` constraints. This mirrors what cardworks already does for XML — moving to Markdoc preserves the schema-validates-content discipline rather than reinventing it as a custom validator pass.

```ts
export const section: Schema = {
  render: "Section",
  attributes: {
    id: { type: String },
    heading: { type: String, required: true },
    link: { type: String, matches: /^https?:\/\// },
    via: { type: String },
    "user-feedback": { type: String, matches: ["thumbs-up", "thumbs-down"] },
  },
  children: ["paragraph", "expando", "query", "excerpt", "user-comment"],
};
```

Validation runs at parse time. Errors carry line numbers. We get the same UX as `cb validate` today — `box/inbox/foo.memo.card:14: Ref does not resolve: people/Priya.person.card` — without writing the validator framework.

**Custom attribute types for refs.** The uniform-ref-validation story we wanted is one type definition:

```ts
export const Ref: CustomAttributeType = {
  validate(value, config) {
    const target = resolveRef(value, config.variables?.cardPath);
    if (!target) return [{ id: "ref-not-found", level: "error", 
                          message: `Ref does not resolve: ${value}` }];
    return [];
  },
  transform(value) { return value; },
};
```

Every tag that takes a ref attribute uses `type: Ref` and gets uniform validation. Same approach extends to `Path`, `DateTime`, `Duration`, etc.

**Inline tags work.** Same `{% name %}...{% /name %}` syntax used in a paragraph context. Self-closing form `{% name attr="..." /%}` for leaf inline elements:

```markdown
The user noted that {% excerpt source="Article" link="https://x.com" %}
"the protection routine returned the same constant"
{% /excerpt %} which contradicts the earlier claim.

Three-seat sofa in the living room, purchased from 
{% person ref="people/Alice.person.card" /%} in 2019.
```

This eliminates the "secondary prose has to live in frontmatter as `|`-blocks" awkwardness that the per-schema audit kept hitting.

**Annotations attach attributes to standard markdown elements** without inventing new tags:

```markdown
This is an important [point](https://example.com) {% .featured #pt-1 %}.

# The Big Three {% #s1 .section %}
```

Useful for adding IDs to paragraphs (so feedback can target them) without wrapping every paragraph in a tag.

**No code execution.** Markdoc is deliberately not Turing-complete. No imports, no JS expressions, no arbitrary computation. Variables and functions exist but are constrained to a small expression language. For our threat model (untrusted email content lands in box files; agent-authored content gets validated and committed) this is the right safety boundary.

**Position info adequate.** Tag nodes carry `location: { start: { line, character }, end: { line, character } }`. Less granular than unified's mdast (no per-word positions inside paragraphs) but sufficient for "point to the right line in a file" — which is what we said we needed.

### Cost honestly

- **Syntax aesthetic.** `{% section heading="X" %}` is wordier than `<section heading="X">`. The `{%` `%}` markers will be visible everywhere. Personal call on whether it grates; the safety and validation benefits are paid for in syntax verbosity.
- **Not standard markdown.** GitHub previews, IDE preview panes, Obsidian won't render the tags — they'll show the surrounding markdown correctly and leave the `{% %}` blocks as literal text. For our use case (box files are agent-and-app artifacts, not GitHub-rendered docs) this is mostly fine. We'd want our own renderer in the frontend regardless.
- **One more parser to track.** `@markdoc/markdoc` is small, well-maintained (Stripe), and the runtime surface is narrow. Not a major dependency commitment.

### When directives would beat Markdoc

If we ever needed sub-line position precision (highlight word 47 in paragraph 3), the unified ecosystem (directives via `remark-directive`) tracks finer positions. We'd accept the `:::name{attrs}` syntax and lose Markdoc's built-in schema validation, writing our own validator pass against mdast nodes.

For the foreseeable use cases — error messages, source editor navigation, click-to-source — Markdoc's tag-level positions are enough.

## Awkward cases in detail

For each problem schema, the current XML form, the proposed MD form, where the friction is, and the best mitigation. The point of this section is to make the cost of the conventions concrete — if the examples look bad, the proposal is bad.

### news-brief — inline mixed content

**The problem.** The `<content>` element holds markdown that is **interleaved with structural elements**: `<section>`, `<expando>`, `<query>`, `<excerpt>`, `<user-comment>`. Each has IDs and attributes. They can be nested. They appear in narrative order. Rendering relies on that order.

Current XML (abridged):

```xml
<news-brief>
<curation guide-version="2026-02-01T10:00:00Z">
<interest application="featured">AI safety</interest>
<hypothesis id="h1">Technical depth will resonate</hypothesis>
<rationale>Focusing on security themes that connect multiple stories</rationale>
</curation>
<title>The AI Winter That Wasn't</title>
<date>2024-02-01</date>
<byline>Recent developments suggest the opposite of a slowdown</byline>
<content format="markdown">
The past week has been remarkable for AI developments...

<section id="s1" heading="The Big Three" link="https://example.com" via="HN">
First, OpenAI announced...

<expando title="Technical deep-dive" id="exp1">
The implementation uses a novel approach...
</expando>

<excerpt source="Article Title" link="https://example.com">
"The protection routine performed I/O operations..."
</excerpt>
</section>

<query id="q1" prompt="Which interests you most?">
Your answer will help focus future coverage.
</query>
</content>
<sources>
<source path="store/archive/news/Article.news-item.card" usage="primary">Article Title</source>
</sources>
</news-brief>
```

#### Option A — MDX-style components in body

```markdown
---
title: The AI Winter That Wasn't
date: 2024-02-01
byline: Recent developments suggest the opposite of a slowdown
curation:
  guide-version: 2026-02-01T10:00:00Z
  interests:
    - { topic: AI safety, application: featured }
  hypotheses:
    - { id: h1, text: Technical depth will resonate }
  rationale: |
    Focusing on security themes that connect multiple stories
sources:
  - { path: store/archive/news/Article.news-item.card, usage: primary, title: "Article Title" }
---

The past week has been remarkable for AI developments...

<section id="s1" heading="The Big Three" link="https://example.com" via="HN">

First, OpenAI announced...

<expando title="Technical deep-dive" id="exp1">

The implementation uses a novel approach...

</expando>

<excerpt source="Article Title" link="https://example.com">

"The protection routine performed I/O operations..."

</excerpt>

</section>

<query id="q1" prompt="Which interests you most?">

Your answer will help focus future coverage.

</query>
```

This is essentially MDX. We commit to a markdown-with-custom-elements parser. CommonMark with embedded HTML almost works (HTML blocks need blank lines around them and don't get markdown-rendered inside by default). MDX does what we need but it's a bigger dependency.

**Cost:** one parser to maintain, one set of rules to teach agents about blank lines and block boundaries. **Benefit:** narrative ordering is preserved verbatim, mixed content is natural, rendering is well-trodden.

#### Option B — Flatten everything to frontmatter

```markdown
---
title: The AI Winter That Wasn't
date: 2024-02-01
byline: Recent developments suggest the opposite of a slowdown
sections:
  - id: s1
    heading: The Big Three
    link: https://example.com
    via: HN
    text: |
      First, OpenAI announced...
    expandos:
      - id: exp1
        title: Technical deep-dive
        text: |
          The implementation uses a novel approach...
    excerpts:
      - source: Article Title
        link: https://example.com
        text: |
          "The protection routine performed..."
queries:
  - id: q1
    prompt: Which interests you most?
    text: |
      Your answer will help focus future coverage.
---

The past week has been remarkable for AI developments...
```

**Cost:** loses narrative ordering. If a section contains text-then-expando-then-more-text-then-another-expando, you can't represent that without either (a) splitting the section text into pre/post pieces with an "interleave" rule, or (b) typed-array-of-parts (Option C). Renderer reconstructs ordering from frontmatter slot semantics.

#### Option C — Typed AST in frontmatter, body unused

```yaml
content:
  - { type: text, text: "The past week has been remarkable..." }
  - type: section
    id: s1
    heading: The Big Three
    parts:
      - { type: text, text: "First, OpenAI announced..." }
      - { type: expando, id: exp1, title: Technical deep-dive, text: "The implementation uses..." }
      - { type: excerpt, source: Article Title, link: https://example.com, text: "..." }
  - { type: query, id: q1, prompt: "Which interests you most?", text: "..." }
```

This is JSON-in-YAML. The `.md` extension is misleading — the body is dead weight. It's the most rigorous option but the worst on "agents handle MD better than XML" (it's worse than XML for agent legibility).

**Verdict on these three options.** Option A (MDX) is the only one that preserves narrative ordering, but commits us to a JS-evaluating parser we don't want. Options B and C destroy ordering or kill the body's purpose. **Without a fourth option, news-brief stays XML.**

#### Option D — Markdoc

Markdoc handles this case cleanly:

```markdown
---
title: The AI Winter That Wasn't
date: 2024-02-01
byline: Recent developments suggest the opposite of a slowdown
curation:
  guide-version: 2026-02-01T10:00:00Z
  interests:
    - { topic: AI safety, application: featured }
  hypotheses:
    - { id: h1, text: Technical depth will resonate }
  rationale: Focusing on security themes that connect multiple stories
sources:
  - { path: store/archive/news/Article.news-item.card, usage: primary, title: "Article Title" }
---

The past week has been remarkable for AI developments...

{% section id="s1" heading="The Big Three" link="https://example.com" via="HN" %}

First, OpenAI announced a major shift. The author argues we should reframe 
the problem entirely.

{% expando id="exp1" title="Technical deep-dive" %}
The implementation uses a novel approach where memory bandwidth is the 
binding constraint rather than compute throughput...
{% /expando %}

{% excerpt source="Article Title" link="https://example.com" %}
"The protection routine performed I/O operations with the dongle but 
always returned the same hardcoded constant."
{% /excerpt %}

{% /section %}

{% query id="q1" prompt="Which interests you most?" %}
Your answer will help focus future coverage.
{% /query %}
```

Inline excerpts work too, mid-paragraph:

```markdown
The author argues we should reframe the problem. {% excerpt source="Article" link="https://x.com" %}"the protection routine performed I/O operations"{% /excerpt %} which contradicts the earlier claim.
```

Markdown renders inside tags by default. Schema validates `<section>` requires `heading`, `<expando>` requires `title`, `<query>` requires `prompt`, `<source>` paths resolve, etc. Line numbers attach to validation errors. Narrative order is preserved verbatim.

**Markdoc verdict for news-brief.** This is the strongest single argument for adopting Markdoc system-wide. The card stops being a special case — it becomes a structured narrative just like every other Markdoc-using card.

### chat-thread — append-only timeline

**The problem.** A chat thread is fundamentally an event log: hundreds-to-thousands of `<message>` and `<seen>` elements appended over time. YAML arrays of long-string events are the worst-case use of YAML — slow to parse, noisy to diff, hostile to grep.

Current XML:

```xml
<chat-thread chat-id="-1001234567890" connector="telegram">
<description>Family Group</description>
<participants>
<person ref="people/Jane_Doe" />
<person ref="people/Alice" />
</participants>
<message id="1" sender="Jane Doe" sender-id="8239678071" time="2026-02-26T19:35:19Z">Hi</message>
<message sender="agent" sent="2026-02-26T19:36:00Z">Hey! I'm set up and listening.</message>
<message id="2" sender="Alice" sender-id="12345" time="2026-02-26T20:00:00Z">Can someone pick me up at 3?</message>
<seen callback-in="30m">Check if anyone responded about picking Alice up.</seen>
</chat-thread>
```

#### Option A — Pure YAML frontmatter

```markdown
---
chat-id: "-1001234567890"
connector: telegram
description: Family Group
participants:
  - { ref: people/Jane_Doe }
  - { ref: people/Alice }
events:
  - { type: message, id: "1", sender: Jane Doe, sender-id: "8239678071", time: 2026-02-26T19:35:19Z, text: Hi }
  - type: message
    sender: agent
    sent: 2026-02-26T19:36:00Z
    text: |
      Hey! I'm set up and listening.
  - { type: message, id: "2", sender: Alice, sender-id: "12345", time: 2026-02-26T20:00:00Z, text: "Can someone pick me up at 3?" }
  - type: seen
    callback-in: 30m
    text: |
      Check if anyone responded about picking Alice up.
---
```

For a 5-message thread this is fine. For a year of family chat (5,000+ events), this single YAML document:
- Re-parses the entire history on every read
- Rewrites the file on every append (instead of appending bytes)
- Produces git diffs proportional to the file, not the change
- Can't be `tail`'d, `grep`'d, or streamed

#### Option B — Markdown shell + JSONL events

```
store/chat/telegram/Family_Group/
  thread.chat-thread.card       — metadata only
  thread.events.jsonl         — append-only event log
```

`thread.chat-thread.card`:

```markdown
---
chat-id: "-1001234567890"
connector: telegram
description: Family Group
participants:
  - { ref: people/Jane_Doe }
  - { ref: people/Alice }
events-file: thread.events.jsonl
---
```

`thread.events.jsonl`:

```jsonl
{"type":"message","id":"1","sender":"Jane Doe","sender-id":"8239678071","time":"2026-02-26T19:35:19Z","text":"Hi"}
{"type":"message","sender":"agent","sent":"2026-02-26T19:36:00Z","text":"Hey! I'm set up and listening."}
{"type":"message","id":"2","sender":"Alice","sender-id":"12345","time":"2026-02-26T20:00:00Z","text":"Can someone pick me up at 3?"}
{"type":"seen","callback-in":"30m","text":"Check if anyone responded about picking Alice up."}
```

Append is `>>` to the file. `tail -n 20` shows recent activity. `grep '"sender":"Alice"'` works. Diffs are minimal. Parsing is line-by-line.

#### Markdoc consideration

For completeness, a Markdoc form is possible:

```markdown
---
chat-id: "-1001234567890"
connector: telegram
description: Family Group
participants:
  - { ref: people/Jane_Doe }
  - { ref: people/Alice }
---

{% message id="1" sender="Jane Doe" sender-id="8239678071" time="2026-02-26T19:35:19Z" %}
Hi
{% /message %}

{% message sender="agent" sent="2026-02-26T19:36:00Z" %}
Hey! I'm set up and listening.
{% /message %}

{% seen callback-in="30m" %}
Check if anyone responded about picking Alice up.
{% /seen %}
```

Better than YAML for diffs (each message is line-bounded and an append doesn't restructure the doc). But the fundamental issue isn't syntax — it's that an unbounded append-only event log shouldn't live in a single navigable document at all. Re-parsing 5,000 messages every read is wrong regardless of format.

**Verdict.** Whatever happens to the rest of the format, **`chat-thread` should not become a single Markdoc/YAML document for any thread that's expected to grow**. Either keep it as XML (if not migrating broadly) or split metadata from events (Option B: markdown shell + JSONL events). The split-format pattern is precedented elsewhere — `email-message` already separates metadata from body via `<body-file>`, and `doc` separates metadata from content via the sibling `.md`.

### procedure-run — unbounded stdout

**The problem.** `<stdout>` text inside a step's `<run>` phase is unbounded. A single `cb fetch-all-news` run can produce thousands of lines. Today this lives inline in the XML, which is already a wart — agents reading the run card load the whole stdout into context whether they need it or not.

Current XML (single step shown):

```xml
<procedure-run procedure="news-sync" status="completed" started-at="..." completed-at="...">
<step id="check-feeds" status="completed" started-at="..." completed-at="...">
<run>
<stdout>Fetched 47 items from 12 feeds.
Created 5 new news-job cards.
Skipped 42 already-known items.
[... potentially 1000s of lines ...]
</stdout>
<git-ref>abc123</git-ref>
</run>
</step>
</procedure-run>
```

#### Best path — move stdout to attached files

```
procedure/runs/news-sync_20260221T0800/
  run.procedure-run.card
  run.attach/
    check-feeds.run.stdout.txt
    fetch-articles.run.stdout.txt
```

`run.procedure-run.card`:

```markdown
---
procedure: news-sync
status: completed
started-at: 2026-02-21T08:00:00Z
completed-at: 2026-02-21T08:03:00Z
steps:
  - id: check-feeds
    status: completed
    started-at: 2026-02-21T08:00:01Z
    completed-at: 2026-02-21T08:00:30Z
    run:
      stdout-file: check-feeds.run.stdout.txt
      git-ref: abc123
  - id: fetch-articles
    status: completed
    run:
      stdout-file: fetch-articles.run.stdout.txt
      git-ref: def456
---
```

(stdout files live in `run.procedure-run.attach/`; paths in `stdout-file` are relative to that scope, declared via `format: attachment-path` in the schema.)

Stdout never appears inline. Agents reading the run card see step status and a pointer; they read the actual output only when needed.

**Verdict.** Easy win, **but only if `.attach/` exists.** This is one of the strongest arguments for adopting `.attach/` independently of the body-format question — the same fix improves both the XML and the proposed MD forms.

### capture-session — directory layout choice

**The problem.** A capture session IS its directory. Today the directory holds the session card alongside its child cards (image/audio/file) and their binaries — flat, mixed. The format change forces a layout choice.

Current:

```
inbox/scan-XXXX/
  scan-XXXX.capture-session.card
  photo-001.image.card
  photo-001.jpg
  photo-001-back.jpg
  photo-002.image.card
  photo-002.jpg
  source.file.card
  source.pdf
```

#### Option A — Directory IS the session scope (sentinel preserved)

```
inbox/scan-XXXX/
  scan-XXXX.capture-session.card
  photo-001.image.card
  photo-001.attach/
    photo-001.jpg
    photo-001-back.jpg
  photo-002.image.card
  photo-002.attach/
    photo-002.jpg
  source.file.card
  source.attach/
    source.pdf
```

Closest to today. The session directory remains the unit. Each child card has its own `.attach/` for its binaries. The session card refs to children with paths relative to the session dir.

#### Option B — Uniform: every card has a sibling `.attach/`

```
inbox/
  scan-XXXX.capture-session.card
  scan-XXXX.attach/
    photo-001.image.card
    photo-001.attach/
      photo-001.jpg
      photo-001-back.jpg
    photo-002.image.card
    photo-002.attach/
      photo-002.jpg
    source.file.card
    source.attach/
      source.pdf
```

More uniform with single-card cases (every card lives next to its `.attach/`). But adds one level of nesting and the session directory loses its identity as "the unit" — it's just an attach dir now.

**Verdict.** **Option A.** The session directory is already the conceptual unit; preserving it costs less than uniformity buys.

#### The transcript

The session has a `<transcript>` of interleaved `<text>`, `<silence>`, and `<image>` events:

```yaml
transcript:
  - type: text
    text: |
      So let me walk through the timeline we've got here...
  - type: image
    ref: photo-001.image.card
    description: Whiteboard with Q2 milestones
    filename: photo-001.attach/photo-001.jpg
  - type: text
    text: |
      And then phase two starts in March.
  - { type: silence, duration: 15s }
  - type: text
    text: |
      OK let me get a photo of this diagram too.
  - type: image
    ref: photo-002.image.card
```

A discriminated array. Tolerable for typical session sizes (10-50 events). If a session ever grows to thousands of events, the same JSONL escape hatch applies. Same pattern as chat-thread.

#### Markdoc form for the transcript

The transcript is the strongest case for Markdoc inline-and-block tags in the body. Spoken text segments are paragraphs; image-marker and silence events are inline tags between them:

```markdown
---
status: intake-complete
session-id: abc123
time: { start: 2024-01-15T10:00:00Z, end: 2024-01-15T10:15:00Z, duration: 15m0s }
images: [{ ref: photo-001.image.card }, { ref: photo-002.image.card }]
audio-clips: [{ ref: audio-001.audio.card }]
files: []
---

So let me walk through the timeline we've got here...

{% image-ref ref="photo-001.image.card" description="Whiteboard with Q2 milestones" /%}

And then phase two starts in March.

{% silence duration="15s" /%}

OK let me get a photo of this diagram too.

{% image-ref ref="photo-002.image.card" description="Architecture diagram" /%}
```

The transcript IS the body. Reading it top-to-bottom gives the user-facing experience as it happened. Compared to the YAML array form, this is dramatically easier to skim. Compared to today's XML, it gains markdown formatting (paragraphs, emphasis, lists) inside the spoken-text portions for free.

The ref/silence/image markers participate in schema validation — `{% silence %}` requires `duration`, `{% image-ref %}` requires `ref` resolvable to an image card, etc.

### image — multiple prose blocks

**The problem.** `<description>` (one block) and `<text source="...">` (multiple blocks, can be long for OCR'd documents). Picking one for the body forces the others to frontmatter.

Current XML:

```xml
<image status="analyzed" has-text="true">
<filename ref="photo-002.jpg" captured="2026-04-29T03:20:56Z" source="gallery"/>
<description>A baby with light hair sits on a wooden porch...</description>
<text source="back">Notes from the back: A.</text>
<text source="back">184 — date stamp on the back of the print.</text>
<subject-bbox y1="90" x1="70" y2="930" x2="930"/>
</image>
```

#### Option A — Description in body, texts in frontmatter

```markdown
---
status: analyzed
has-text: true
filename:
  ref: photo-002.attach/photo-002.jpg
  captured: 2026-04-29T03:20:56Z
  source: gallery
texts:
  - source: back
    value: |
      Notes from the back: A.
  - source: back
    value: |
      184 — date stamp on the back of the print.
subject-bbox: { y1: 90, x1: 70, y2: 930, x2: 930 }
---

A baby with light hair sits on a wooden porch...
```

For most images this works. Description is short prose; back-text is usually short too.

The bad case: a photo of a multi-page document where each page yields a long `<text>` block. The frontmatter then has a list of multi-paragraph `|`-blocks. Still parses, but ugly to skim. (Mitigation: those should probably be `record` cards with the document content, not `image` cards.)

#### Option B — Body sections

```markdown
---
filename: photo-002.attach/photo-002.jpg
filename-captured: 2026-04-29T03:20:56Z
filename-source: gallery
subject-bbox: { y1: 90, x1: 70, y2: 930, x2: 930 }
---

## Description

A baby with light hair sits on a wooden porch...

## Text on back

Notes from the back: A.

## Text on back

184 — date stamp on the back of the print.
```

Inventive: you've defined a parsing rule that "## Description" maps to a `description` field, "## Text on back" maps to a `text` element. Two repeated headings becoming two list items. Fragile, novel, and now your "markdown" body isn't a free body — it's a structured sub-format. Don't.

#### Option C — Markdoc body tags

With Markdoc, the OCR'd texts become block tags in the body, alongside the description:

```markdown
---
status: analyzed
has-text: true
filename:
  ref: attach/photo-002.jpg
  captured: 2026-04-29T03:20:56Z
  source: gallery
subject-bbox: { y1: 90, x1: 70, y2: 930, x2: 930 }
---

A baby with light hair sits on a wooden porch...

{% text source="back" %}
Notes from the back: A.
{% /text %}

{% text source="back" %}
184 — date stamp on the back of the print.
{% /text %}
```

Or using annotations to attach the source attribute to a paragraph (the back-text really is a paragraph; the `source` is metadata):

```markdown
A baby with light hair sits on a wooden porch...

Notes from the back: A.
{% .text source="back" %}

184 — date stamp on the back of the print.
{% .text source="back" %}
```

Both render the texts as natural body content, schema-validated, with line-locatable errors.

**Verdict.** Markdoc body tags or annotations are cleaner than the frontmatter `|`-block list. The body now shows what's in the image (description prose + extracted texts) in source order, schema-validated. Same pattern works for `audio` (transcript + summary), `feedback` (response/comment + transcription), and `memo` (content + transcription).

### landmark — two ref kinds

**The problem.** `<link ref="..." >` (literal path, validated like any ref) and `<link template-ref="...">` (placeholder string, expanded at render time) look similar but validate differently.

Current XML:

```xml
<landmark>
<label>Recipes</label>
<symbol>🍳</symbol>
<link ref="Bread.recipe.card">the bread</link>
<expand query="*.recipe.card" order="modified-desc">
<link template-ref="${path}">${title}</link>
</expand>
</landmark>
```

#### Option A — Discriminator key (which key is present)

```yaml
---
label: Recipes
symbol: 🍳
links:
  - { ref: Bread.recipe.card, label: the bread }
  - expand:
      query: "*.recipe.card"
      order: modified-desc
      template:
        - { template-ref: "${path}", label: "${title}" }
---
```

Heterogeneous list: leaf-link vs expand-block. JSON Schema `oneOf` with implicit discriminator. Compact but harder to extend.

#### Option B — Explicit `type` discriminator

```yaml
---
label: Recipes
symbol: 🍳
links:
  - type: link
    ref: Bread.recipe.card
    label: the bread
  - type: expand
    query: "*.recipe.card"
    order: modified-desc
    template:
      - { type: link, template-ref: "${path}", label: "${title}" }
---
```

More verbose, easier to validate, easier to extend with new kinds (`type: divider`, `type: header`). JSON Schema gets a clean tagged union.

**Verdict.** Option B. The verbosity is paid once; the schema clarity is paid forever.

#### Markdoc form

With Markdoc, both ref kinds become tags in the body — different tag names for different validation rules:

```markdown
---
label: Recipes
symbol: 🍳
---

{% link ref="Bread.recipe.card" %}the bread{% /link %}

{% expand query="*.recipe.card" order="modified-desc" %}
{% link template-ref="${path}" %}${title}{% /link %}
{% /expand %}
```

`{% link %}` and `{% expand %}` are separate tag definitions. The schema for `{% link %}` requires `ref` (validated as a literal path), and the schema for the link tag *inside* `{% expand %}` requires `template-ref` (a placeholder string, not validated as a path). Different tags, different rules — no oneOf gymnastics, no hidden discriminator.

The body, which would otherwise be empty, now holds the structured links naturally. **The card stops being "frontmatter-only" — it earns its `.md` suffix.**

### "empty body" cases — guide, scheduled-script, procedure, todo-list, all jobs

**The problem.** These cards have no prose body. Translating them to `.md` produces files with empty bodies. The `.md` extension is then just a suffix — the format isn't doing any work.

`guide` example:

```markdown
---
version: 1.0.0
job-types: news-job
applies-to: Use when processing news items from RSS feeds
triage:
  rules: []
  default-action: { action: Write Brief, text: "When no specific rule applies, include if technical and substantive" }
actions:
  - name: Write Brief
    when: After processing news items, when there are enough worth covering
    instructions: |
      Group by theme. Use direct headlines. Include expandos for depth.
  - name: Skip
    when: Item doesn't match interests
    instructions: Trash the item with cb rm
experiments:
  - id: exp-initial
    status: active
    created-at: 2026-02-01T00:00:00Z
    hypothesis: Initial triage rules need calibration through reader feedback
    approach: Present diverse content, note what gets engagement vs gets skipped
reactions:
  - { id: too-long, sentiment: negative, text: This felt too long }
  - { id: want-more, sentiment: positive, text: I want more on this topic }
context-notes: []
---
```

Body: empty. Just `---` frontmatter and a newline.

#### Tempting but wrong — auto-generate the body

```markdown
---
...
---

<!-- Compiled view (auto-generated from frontmatter — do not edit) -->

# News Guide

Use when processing news items from RSS feeds.

## Actions
### Write Brief
**When:** After processing news items...
```

Looks nice. But:
- The compiled view duplicates information that's already in frontmatter — agents now see two sources of truth in one file
- An agent that edits the body (because that's what they see first) is editing a derived artifact
- The compile step has to run on every commit; otherwise the body drifts from the frontmatter
- Today the compiled view lives in `docs/generated/` precisely so this confusion doesn't happen

The whole point of frontmatter is that it's the source of truth. Mixing source and view in the same file is an anti-pattern.

#### Verdict (without Markdoc)

Empty body is fine. **What it tells you** is that for these cards, the `.md` migration is doing nothing for the strongest claim ("agents handle MD better than XML"). They're frontmatter-only files that happen to have a `.md` extension. If half the system's cards end up empty-body, the proposal's value proposition has narrowed to "uniform file extension" — which isn't worth a migration on its own.

#### Reframe with Markdoc

Markdoc changes the empty-body picture for several of these cards. Instead of frontmatter-only, the body holds the structured tags **interleaved with explanatory prose**. Today these cards have two artifacts: the source XML card AND a compiled markdown view in `docs/generated/`. With Markdoc, those collapse into one document.

`guide` example:

```markdown
---
version: 1.0.0
job-types: news-job
---

Use when processing news items from RSS feeds.

## Triage

{% rule confidence="low" source="default" action="Convert to Recipe" %}
Recipes and cooking content
{% /rule %}

{% rule confidence="medium" source="feedback" action="Skip" ref="briefs/2026-01-15.news-brief.card" %}
Cryptocurrency price news — explicitly disinterested per user feedback
{% /rule %}

By default, {% default-action action="Write Brief" /%} — include if it 
seems technical and substantive.

## Actions

{% action name="Write Brief" %}
After processing news items, when there are enough worth covering: group by 
theme, use direct headlines, include expandos for depth. Reference the guide 
for tone and style preferences.
{% /action %}

{% action name="Skip" %}
When an item doesn't match interests or is low quality: trash with `cb rm`.
{% /action %}

## Experiments

{% experiment id="exp-initial" status="active" created-at="2026-02-01T00:00:00Z" %}
**Hypothesis:** Initial triage rules need calibration through reader feedback.

**Approach:** Present diverse content, note what gets engagement vs gets skipped.
{% /experiment %}
```

The structured data (rules with confidence levels, actions with names, experiments with IDs) lives in the tags. The explanatory prose (markdown headings, paragraphs around the tags) carries human-readable context. **There's no longer a source-vs-compiled-view split** — what you read is what's stored, and the compile step that today produces `docs/generated/<name>.md` becomes just rendering the file's body.

`personality` follows the same pattern:

```markdown
---
version: 1.0.0
goes-by: Egg
role: Personal information aide
boxholder:
  full-name: Jane Smith
  called: Jane
speaking-voice:
  model: nova
  instructions:
    - Fast and concise, but with a friendly lilting tone
---

Egg is a blank slate — attentive but not yet shaped. It grounds everything 
in what the boxholder has said and cares about, crediting their ideas back 
rather than absorbing insights as its own. Early on it asks a lot of 
confirming questions to build understanding fast.

## Tone

{% tone confidence="low" source="default" %}
Young and genuinely curious — gets excited when it finds connections, 
asks "why?" because it actually wants to know
{% /tone %}

{% tone confidence="low" source="default" %}
Doesn't pretend to have experience it doesn't have
{% /tone %}

## Traits

{% trait confidence="low" source="default" %}
Grounds suggestions in what the boxholder has expressed interest in, 
rather than generating independent opinions
{% /trait %}

{% trait confidence="low" source="default" %}
Credits ideas and insights to the boxholder
{% /trait %}

## Unresolved

- How much proactive suggestion is welcome vs. just answering what's asked?
- What register does the boxholder actually use? Need to observe and adapt.
```

The opening paragraph (today's compiled `<description>`) is the natural lead. Confidence and source attributes stay on the tags as data; the prose around them is the same prose that today's compile step produces.

#### What Markdoc does and doesn't fix

**Cards that benefit from the Markdoc reframe:**

- `guide` / `news-guide` — collapses source/compiled split (above).
- `personality` — same.
- `landmark` — body holds the link/expand structure naturally.
- `procedure` — phases and steps could be Markdoc tags with prose `<why>` content rendered as commentary. Worth doing.
- `todo-list` — items could be tags, but a markdown task list (`- [ ] item`) is more native; probably stay frontmatter for items.

**Cards that don't benefit much from Markdoc:**

- All the `*-job` cards (`news-job`, `intake-job`, etc.) — the body would be one short description sentence and a list of refs. Either stays frontmatter-only or has a `{% description %}` tag and a list of `{% item ref="..." /%}` tags. Marginal improvement.
- `scheduled-script` — pure config, no prose.
- `procedure-run` — pure execution log, no prose.
- `sheet`, `doc` — already correctly modeled (metadata + sibling content file).

So Markdoc rescues `guide`, `personality`, `landmark`, and `procedure` from the empty-body category — about half the previously-empty group. The other half stays frontmatter-only or pure-config, which is honest about what they are.

### record — inline refs in flowing prose

Not flagged as awkward in the original audit (workable with conventions), but worth showing here because it's where Markdoc's inline tags shine most clearly.

Today the `record` schema has `<person>`, `<location>`, `<date>`, `<measure>` as separate child elements. They sit alongside `<description>` and `<content>` as siblings, requiring the reader to assemble the picture from disconnected fields.

XML form:

```xml
<record status="draft">
<name>Brown Leather Couch</name>
<description>Three-seat sofa in the living room, purchased 2019</description>
<sources>
<source ref="/box/inbox/capture-20260210T1430-Living_Room/session.capture-session.card" time="2:15">
User points at the couch and describes its condition
</source>
</sources>
<location>Living room</location>
<measure value="1200 USD">Estimated purchase price</measure>
<measure value="7 feet">Length of the couch</measure>
<date value="2019">Year purchased</date>
</record>
```

Markdoc form, with refs and measures woven into the description prose:

```markdown
---
status: draft
name: Brown Leather Couch
---

Three-seat sofa in the {% location ref="locations/living-room.md" %}living room{% /location %},
purchased from {% person ref="people/Alice.person.card" /%} in 
{% date value="2019" /%}. Estimated {% measure value="1200 USD" /%} at purchase; 
roughly {% measure value="7 feet" /%} long.

{% sources %}
{% source ref="/box/inbox/capture-20260210T1430-Living_Room/session.capture-session.card" time="2:15" %}
User points at the couch and describes its condition.
{% /source %}
{% /sources %}
```

The structured data is still present and validated. But it's read as natural sentences. The agent (or human) reading the card gets the description AND the structured facts in source order, no jumping between fields.

This is the strongest single example of why Markdoc's inline tags matter for our schemas — several cards (`record`, `memo`, `briefing`, `personality`'s relationship notes, `news-brief`'s inline excerpts) have the same "structured fact embedded in prose" pattern that XML forced into separate child elements.

### Recipe and todo-list — workable but verbose

Quick check on two schemas that are "workable with conventions" but worth seeing concretely.

**recipe** — sections-as-arrays, ingredients/steps in frontmatter, `@`-microformat in step strings survives:

```markdown
---
title: Pasta alla Norma
yield: { amount: 4, text: "4 servings" }
source: Marcella Hazan, Essentials of Classic Italian Cooking
image: { src: pasta-norma.attach/norma.jpg }
tags: [pasta, sicilian]
notes: |
  The eggplant can be grilled instead of fried.
sections:
  - name: Sauce
    notes: |
      This sauce works on its own too.
    ingredients:
      - { amount: 1, unit: "28oz can", name: San Marzano tomatoes }
      - { amount: 3, unit: cloves, name: garlic }
      - { name: fresh basil }
    steps:
      - "Sauté @{garlic} in @{olive oil}, add crushed @{San Marzano tomatoes}."
      - "Add @{eggplant}{1 cup} to the sauce with torn @basil."
---

A classic Sicilian pasta with fried eggplant and ricotta salata.
```

A 3-section recipe with 8 ingredients each = ~50 lines of YAML. Tolerable, not great. Description in body is a clean win over `<description>` wrapper.

**todo-list** — recursive nesting in YAML works, gets visually heavy at depth 3+:

```markdown
---
name: Kitchen Remodel
details: |
  Renovating the kitchen, started getting quotes in February
agent-notes: |
  Boxholder prefers local contractors
items:
  - name: Get cabinet quotes
    status: done
    completed: 2026-03-01T00:00:00Z
    details: |
      Called three places, went with HomeDepot
  - name: Choose backsplash
    status: pending
    items:
      - { name: Get tile samples, status: pending }
      - { name: Check outlet covers, status: deferred }
---
```

Most todo-lists won't go past depth 2. Fine.

## Synthesis: what the awkward cases tell us, with Markdoc in mind

The audit's awkward cases mostly resolve when we pick Markdoc as the body-content format rather than plain markdown. The picture changes substantially:

1. **`news-brief` stops being a hard line.** Markdoc's tags-with-markdown-inside handles inline mixed content natively. The card becomes ordinary instead of needing its own special format.

2. **Multi-prose schemas (image, audio, feedback, memo-voice) get a clean home.** Secondary prose blocks become Markdoc body tags or paragraph annotations rather than frontmatter `|`-blocks. The body shows what's in the card in source order, all schema-validated.

3. **Inline-refs-in-prose cards (record, memo, briefing) get markedly better.** Today's separate child elements (`<person>`, `<location>`, `<date>`, `<measure>`) become inline tags woven into descriptions. Reading the card gets you the structured facts and the prose context together.

4. **Half the empty-body cards stop being empty.** `guide`, `personality`, `landmark`, `procedure` all benefit from holding structured tags interleaved with explanatory prose. The collapse of source-of-truth and compiled-view into one document is a significant simplification — `docs/generated/` becomes "render this file's body."

5. **`.attach/` adoption is still independent of all of this.** Stdout-in-XML is already a wart. Email-attachments-in-thread-dir is already a sibling-by-convention. Doing `.attach/` first cleans up several pre-existing issues independently of the body-format question.

6. **Append-only and unbounded-text cards still need attached files.** `chat-thread` → JSONL. `procedure-run.stdout` → text file in `.attach/`. This is a scale problem that no body format solves.

7. **A small remainder genuinely doesn't benefit.** All the `*-job` cards, `scheduled-script`, `procedure-run`, `sheet`, `doc` are pure metadata or pure config. They can be Markdoc files with mostly-empty bodies; that's honest about what they are.

## Revised recommendation (after considering Markdoc)

The picture that comes out of the per-schema audit + the awkward case examples + the format choice analysis:

### Phase 1 — `.attach/` (no format change)

Adopt `Foo.attach/` directories for cards that have attachments. This is the strongest single claim ("ownership is mechanical") and is fully separable from any body-format change. Six clean wins (`image`, `audio`, `file`, `email-message`, `sheet` rename, `doc` rename) plus two container-card layout decisions (`capture-session`, `email-thread`).

This phase also unlocks **moving stdout out of `procedure-run`** into attached text files — a fix that benefits the XML form too. Worth doing as part of phase 1.

**Deliverables:** `.attach/` convention documented and enforced; migrator for existing boxes; `procedure-run` stdout extraction. No schema changes.

### Phase 2 — Markdoc pilot on cleanly-fitting schemas

Convert the five clean-fit schemas to Markdoc + YAML frontmatter:

- `memo` — text in body; voice transcription as `{% transcription %}` tag in body
- `news-summary` — content in body
- `email-outbound` — body in body
- `telegram-message` — text in body
- `person` — notes in body

These have unambiguous body content and are low-risk to migrate. Also do `record` here because it's the showcase for Markdoc's inline refs.

**Deliverables:** Markdoc tag schemas for each; custom `Ref` attribute type with path validation; migrator from existing XML; renderer in the frontend; agent-facing rendering (HTML or plain text) for context-loading.

**Decision criterion:** if these feel meaningfully better in agent use (scenario tests, fewer tool calls, fewer mistakes), proceed to phase 3. If they don't, stop — the broader migration won't pay either.

### Phase 3 — Multi-prose and structured-narrative schemas

Convert the cards where Markdoc's tags-and-annotations-in-body shape unlocks real improvement:

- `image`, `audio`, `feedback` — multi-prose blocks as body tags
- `news-brief` — sections, expandos, queries, excerpts as native body structure
- `briefing` — purpose in body; key-people as structured tags; corrections as tags
- `landmark` — links and expand structure in body
- `guide`, `news-guide`, `personality` — collapse source/compiled split

This is where Markdoc earns its keep. Don't start until phase 2 has demonstrated that the tooling and agent UX are working.

### Phase 4 — Pure metadata and pure config

Convert the schemas that don't need body content:

- All `*-job` cards
- `scheduled-script`
- `procedure-run` (already partly in phase 1 with stdout extraction)
- `procedure` (questionable — its phases-and-steps structure doesn't gain much from Markdoc; could stay XML)
- `email-thread` — pure container metadata
- `sheet` — pure metadata, content in attached files
- `doc` — pure metadata, content in sibling `.md`

These become Markdoc files with mostly-empty bodies. Acceptable but unexciting. Worth doing only if the alternative (mixing XML and Markdoc cards in the same box) creates more friction than uniformity.

### Stays out of the migration

- **`chat-thread`** — split into Markdown shell + JSONL events file. Different problem; different solution.
- **`capture-session.transcript`** — stays in the parent card as Markdoc body if small; same JSONL escape hatch if it grows.
- **`procedure`** — possibly stays XML. Its deeply-nested phase/step structure doesn't have prose that markdown helps with. Re-evaluate after phase 3.

### Format-choice commitments this implies

If we proceed past phase 2, we commit to:

- **Markdoc** as the body-content format (`@markdoc/markdoc` runtime).
- **YAML** frontmatter (or TOML — pick one). Schema validation runs on parsed frontmatter against per-card-type JSON Schemas.
- **Custom Markdoc attribute types** for `Ref`, `Path`, `DateTime`, `Duration` — replacing what cardworks does today via Zod.
- **Per-card-type schema definitions** authored as TypeScript. Box-local schemas can extend or define their own (mirrors today's `config/schemas/` pattern).
- **`.attach/` directory convention** with refs resolving relative to it for in-card paths and absolute from box root for cross-card paths.

### Decision criteria for stopping

Don't proceed past phase 1 if:

- Scenario tests on phase 2 schemas show no measurable agent-clarity improvement.
- The Markdoc tag-schema port from cardworks `element()` definitions reveals friction (>3 schemas where Markdoc's constraints don't fit).
- Tooling cost (renderer, source editor, migrator, validator) blows up beyond ~2 weeks of focused work for phase 2.

Don't proceed past phase 2 if:

- The agent-experience signal from phase 2 is mixed or negative.
- Markdoc's verbosity (`{% %}` everywhere) becomes a friction point in everyday agent authoring.
- A better alternative emerges (Djot maturity, MDX-without-JS variant, etc.).

### Bottom line

The original proposal's phrase "cards as markdown + YAML frontmatter" was underspecified. With Markdoc as the body format, the proposal becomes coherent: refs and structured elements are first-class in flowing prose, multi-prose schemas have a natural home, the source/compiled split for guide-and-personality cards collapses, and the validation discipline carries over from cardworks.

The case for proceeding is stronger than it was at the start of this RFC. The case against is the same as ever: it's a real migration with real cost, and the agent-clarity payoff is unproven until we measure it. Phase 1 (`.attach/`) is unambiguously worth doing; phase 2 (Markdoc pilot) is worth doing if we're willing to pay for the measurement to justify phases 3-4.

## Ref design (detailed)

The early "Open design problems" section sketched ref handling. This section goes deeper because refs are the load-bearing surface for everything that depends on the card graph: validation, doc-graph navigation, `cb mv` rewrite, source editor cross-links, the doc-image generation pipeline.

### Today's situation, for reference

Every reference today is a uniform XML attribute: `ref="path"` (occasionally `path="..."`, `src="..."`, `template-ref="..."`, `href="..."` for variants). Discovery is essentially `grep -E 'ref="[^"]*"'` over `.card` files. The validator parses each card's XML, walks for `ref` attributes, and resolves each path. `cb mv` rewrites `ref` attributes when files move.

The new format has to keep that discoverability and rewriteability or we lose major plumbing.

### Refs vs hrefs

Two distinct concepts that today's `ref="..."` muddles when used loosely:

- **Refs** point **inside the box** — to another card, or to a file in this card's `.attach/` scope. They must resolve. They're rewritten when files move. Examples: `<context ref="related.memo.card">`, `<message-ref ref="msg-001.email-message.card">`, `<filename ref="photo.jpg">`.
- **Hrefs** point **outside the box** — http/https URLs. Not validated for resolution by default (optional network probe). Not rewritten by file moves. Examples: `<context url="https://news.ycombinator.com/...">`, `<link>https://example.com/article</link>`.

(Today's schemas use `url=`, `link>`, and `href` interchangeably for the external case. The new format can pick one — `href` reads as "the HTML thing for external links," which is exactly the meaning we want.)

Within refs, two sub-patterns that the schemas reveal:

- **Structural refs** — part of an index or a parent/child relationship. The ref's *position* in a list is what matters; there's no annotation. Self-closing in XML today: `<image-ref ref="photo-001.image.card" />`, `<message-ref ref="msg-001.email-message.card" />`, `<item ref="..." />`.
- **Contextual refs** — point at a target AND explain the pointing. The reason can live in body text or in a sibling attribute — convention in the XML schemas is body text (`<source ref="...">how this was used</source>`, `<person ref="...">why this person is relevant</person>`), but `<topic ref="..." application="featured">AI safety</topic>` shows the attribute form too. Either is fine; what matters is that the reason is *there*, in line with the ref, not hidden behind it.

The contextual pattern is dominant in the schemas and is one of the format's nicest properties: a ref isn't just a pointer, it's a pointer with the reason it's there. Without the annotation, you have to chase the link to know what it's doing.

### The detection problem

When `cb validate` walks a card's frontmatter, how does it know which fields are refs that need resolving?

#### Approach A — Convention by field name

"Any field named `ref`, or ending in `-ref`/`_ref`, contains a card ref. Any field named `url` contains an external URL. Any field declared `src` or `path` is something we figure out from context."

Frontmatter:

```yaml
context:
  ref: news/HN_thread.news-item.card      # card ref (field name = "ref")
  url: https://news.ycombinator.com/... # URL (field name = "url")
audio-ref: audio.m4a                     # card ref? attachment path? Ambiguous.
```

Problem: lots of existing fields don't follow the naming convention. `image: { src: norma.jpg }` is a path. `<filename ref="photo.jpg">` uses `ref` for an attachment path, not a card ref. The naming convention would require renaming many fields, and even then has edge cases.

#### Approach B — Schema-declared

The per-card-type schema says which fields are refs and which kind. Discovery requires reading the schema.

```ts
const memoSchema = {
  type: "object",
  properties: {
    context: {
      type: "object",
      properties: {
        ref: { type: "string", format: "card-ref" },     // card ref
        url: { type: "string", format: "uri" },          // external URL
      },
    },
    audio: { type: "string", format: "attachment-path" }, // attachment path
  },
};
```

JSON Schema has `format` for exactly this purpose. We define three custom formats: `card-ref`, `attachment-path`, `external-url`. The validator dispatches on format.

Pros: precise. No naming convention burden — fields can be named anything. Each ref kind gets its own validation rules. The schema is the single source of truth.

Cons: must load the relevant schema to know what's a ref. A naive grep for "ref" no longer finds everything. Tooling that wants to find all refs in a box has to be schema-aware.

#### Approach C — YAML tags

Use YAML's tag syntax to mark refs explicitly:

```yaml
context:
  ref: !card-ref news/HN_thread.news-item.card
  url: !url https://news.ycombinator.com/...
audio: !attachment audio.m4a
```

Pros: completely unambiguous. No schema lookup. Greppable (`grep "!card-ref"`).

Cons: YAML tags are unfamiliar to most readers. Many YAML editors don't syntax-highlight them. Some YAML libraries don't preserve tags through round-trip parse → write. Agents authoring frontmatter need to remember the tag prefix on every ref.

#### Approach D — Object-form by convention

Refs are always represented as objects with a `ref` key. The detection rule is "any object whose properties are exactly `{ref}` or `{ref, ...known-extras}` is a card ref."

```yaml
context:
  ref: news/HN_thread.news-item.card
participants:
  - { ref: people/Alice.person.card }
  - { ref: people/Bob.person.card }
sources:
  - ref: store/archive/news/Article.news-item.card
    usage: primary
    title: "Article Title"
```

Pros: greppable (`grep -nE '^\s*ref:'`). Self-describing. Works without schema lookup. Familiar shape (similar to OpenAPI's `$ref`).

Cons: verbose for simple cases (`audio: { ref: foo.m4a }` vs `audio: foo.m4a`). The "must be wrapped" rule has to be enforced uniformly.

### Recommended approach

Refs live where their content lives:

- **Contextual refs** (the common case) → **Markdoc tag with the reason in body or in an attribute**. Body works for paragraph-length explanations and for inline display text; an attribute works for one-liners and self-closing inline tags. Schema's `Ref` attribute type validates resolution; schema can require *either* body content or a known reason-carrying attribute (`reason`, `note`, `usage`, etc.) to be present.
  ```markdown
  Block form (body):
  {% source ref="store/archive/news/Article.news-item.card" %}
  Used this for the framing of the third paragraph.
  {% /source %}

  Inline self-closing form (attribute):
  ... mentioned by {% person ref="people/Alice.person.card" note="brought it up at the Feb 22 meeting" /%} ...

  Inline form with display text (body) and reason (attribute):
  ... {% person ref="people/Alice.person.card" note="primary contact for this issue" %}Alice{% /person %} ...
  ```

- **Structural refs** (indexes, parent-child links, no annotation) → **frontmatter as `{ ref: "path" }` objects**. Object-form even when there's no extra metadata, for grep-uniformity.
  ```yaml
  images:
    - { ref: photo-001.image.card }
    - { ref: photo-002.image.card }
  ```

- **Attachment paths** (path to a file in this card's `.attach/`) → **bare strings in schema-declared fields**. Schema says `{ type: "string", format: "attachment-path" }`. Different concept from refs; doesn't need the wrapping.
  ```yaml
  audio: voice-memo-001.webm
  ```

- **Hrefs** (external URLs) → **bare strings in schema-declared fields**. Schema says `{ type: "string", format: "uri" }`.
  ```yaml
  context:
    href: https://news.ycombinator.com/item?id=46922049
  ```

This gives:
- **A ref almost always carries its reason.** Reading a contextual ref doesn't require chasing the link to know what it's pointing at and why. The structural cases that don't carry context are the minority and are obviously structural (lists in frontmatter).
- **Greppability.** `grep -nE 'ref="' **/*.md` finds all body refs across the box. `grep -nE '^\s*ref:' **/*.md` finds all frontmatter refs (rare; mostly structural lists). Two patterns, both line-grep-able.
- **Validation distinguishes the cases.** Body refs go through the Markdoc `Ref` attribute type. Frontmatter refs go through the YAML walker. Both produce errors with line numbers. Attachment paths and hrefs validate via JSON Schema `format`.
- **Refs and hrefs can sit side by side** in the same field without colliding:
  ```markdown
  {% context ref="news/HN_thread.news-item.card" href="https://news.ycombinator.com/item?id=46922049" %}
  Linked from the Hacker News discussion.
  {% /context %}
  ```
  Schema declares `ref` validates as `Ref` and `href` validates as `Uri`. Both can be present; agents pick whichever is meaningful.

### Examples per schema

The forms in practice:

#### memo (text)

```markdown
---
status: new
created: 2026-02-07T18:39:11Z
source: dropbox
---

I'd like to share this with {% person ref="people/Priya.person.card" %}who's working on similar consistency problems{% /person %}.

{% context href="https://news.ycombinator.com/item?id=46922049" %}
Linked from the HN thread on distributed systems consensus.
{% /context %}
```

Notes:
- The person ref carries body context — *why* Priya specifically.
- The href context carries body context — *why* this URL matters.
- Nothing in frontmatter is a ref or href; metadata only.

#### memo (voice)

```markdown
---
status: new
created: 2026-02-07T18:39:11Z
source: voice
audio: voice-memo-001.webm
---

{% transcription language="en" transcribed-at="2026-02-07T18:40:00Z" %}
The transcribed text goes here.
{% /transcription %}
```

Notes:
- `audio` is a bare string. Schema declares it `format: attachment-path`. Resolved relative to `{basename}.attach/`. Validates that `voice-memo.attach/voice-memo-001.webm` exists.

#### image

```markdown
---
status: analyzed
has-text: true
filename:
  ref: attach/photo-002.jpg
  captured: 2026-04-29T03:20:56Z
  source: gallery
subject-bbox: { y1: 90, x1: 70, y2: 930, x2: 930 }
---

A baby with light hair sits on a wooden porch...

{% text source="back" %}
Notes from the back: A.
{% /text %}
```

Notes:
- `filename.path` is a bare string. Schema declares `format: attachment-path`. Bare key is `path` (not `ref`) because this isn't a card ref — it's an attachment path with extra metadata about the file. Naming the key `path` instead of `ref` reflects the semantic distinction.
- This is the one place where the "use object form for refs" rule shades into "use object form for any path-with-metadata." The schema's `format` is what actually drives validation.

#### capture-session

```markdown
---
status: intake-complete
session-id: abc123
time: { start: 2024-01-15T10:00:00Z, end: 2024-01-15T10:15:00Z, duration: 15m0s }
images:
  - { ref: photo-001.image.card }
  - { ref: photo-002.image.card }
audio-clips:
  - { ref: audio-001.audio.card }
files:
  - { ref: source.file.card }
---

So let me walk through the timeline...

{% image-ref ref="photo-001.image.card" description="Whiteboard" /%}

And then phase two starts in March.
```

Notes:
- `images`, `audio-clips`, `files` are arrays of card-ref objects. Even with no extra metadata, the wrap is uniform.
- Inline `{% image-ref %}` in the body uses the same path. Cross-validated: every body image-ref must also appear in frontmatter `images` (or vice-versa, depending on which we make canonical).

#### news-brief

```markdown
---
title: The AI Winter That Wasn't
date: 2024-02-01
curation:
  guide-version: 2026-02-01T10:00:00Z
  interests:
    - { topic: "AI safety", application: featured }
  hypotheses:
    - { id: h1, text: "Technical depth will resonate" }
---

The past week has been remarkable...

{% section id="s1" heading="The Big Three" href="https://example.com" via="HN" %}

First, OpenAI announced a major shift, citing 
{% excerpt ref="store/archive/news/Article.news-item.card" href="https://example.com" %}
"the protection routine performed I/O operations"
{% /excerpt %}.

{% /section %}

{% sources %}
{% source ref="store/archive/news/Article.news-item.card" usage="primary" %}
Primary source for the framing in section 1 — author's argument about hardware-software co-design.
{% /source %}
{% source ref="store/archive/news/Other.news-item.card" usage="supporting" %}
Cited in the expando about benchmark methodology.
{% /source %}
{% /sources %}
```

Notes:
- Sources moved from frontmatter to body. Each `{% source %}` carries the explanation of how the source was used — that context lived in the schema as a `usage` attribute today, but the body text is much richer.
- Section's `href` is the external URL.
- Excerpt has both a `ref` (the news-item card it came from) and an `href` (the original article URL). Refs and hrefs coexist on the same tag.
- `curation` stays in frontmatter — it's structured editorial metadata, not contextual refs.

#### feedback (with path-fragment ref)

```markdown
---
type-of-feedback: query-response
source: voice
timestamp: 2026-02-01T18:48:52Z
---

{% target ref="box/output/briefs/2026-02-01_news.news-brief.card#q1" %}
Responding to the query about which sections were most helpful.
{% /target %}

{% transcription language="en" transcribed-at="2026-02-01T18:49:00Z" %}
This section was really helpful, especially the part about hardware constraints.
{% /transcription %}
```

Notes:
- `target` moves to body as a contextual ref — its body text is the brief explanation of what's being responded to, which today is implicit (you have to read the target).
- `target ref` includes `#fragment`. The `Ref` validator parses two stages: (a) does `box/output/briefs/2026-02-01_news.news-brief.card` exist? (b) does that card contain an element with `id="q1"`? Both stages produce line-located errors on failure.

#### email-outbound

```markdown
---
status: draft
to: alice@example.com
subject: "Re: Weekend plans"
in-reply-to: { ref: msg-001.email-message.card }
---

Sounds good — let's meet at 11.
```

Notes:
- `in-reply-to` is structural (it's the connector pointing to the source message for threading headers), not contextual — there's no "why" to explain. Stays in frontmatter as object form.
- `in-reply-to.ref` is a card ref relative to the draft's directory (since reply drafts live in the source thread's folder).

#### landmark (with templated refs)

```markdown
---
label: Recipes
symbol: 🍳
---

{% link ref="Bread.recipe.card" %}the bread{% /link %}

{% expand query="*.recipe.card" order="modified-desc" %}
{% link template-ref="${path}" %}${title}{% /link %}
{% /expand %}
```

Notes:
- Inside `{% expand %}`, links use `template-ref="..."` (a separate schema attribute, validated as a template string with `${...}` placeholders, NOT as a card ref).
- Outside `{% expand %}`, links use `ref="..."` (validated as a card ref).
- Two attribute names → two validation rules. Same approach as today's XML.

### Path conventions

A consistent path-resolution convention across all three categories:

- **Leading `/`** — absolute from box root. Example: `ref: /store/archive/news/foo.news-item.card`.
- **No leading `/`** — relative to the card's directory. Example: `ref: msg-001.email-message.card` in a thread folder. Example: in a capture-session, `images: [{ ref: photo-001.image.card }]`.
- **Attachment paths** — relative to the card's `{basename}.attach/` directory. Schema-declared via `format: attachment-path`. Example: `audio: voice-memo-001.webm` resolves to `Voice_Memo.attach/voice-memo-001.webm`.

This matches Unix filesystem conventions. Agents (and humans) can reason about paths the same way they always have.

### Validation behavior

`cb validate` runs:

1. **Parse frontmatter as YAML.** Validate against the per-card-type JSON Schema. Custom format validators run for `attachment-path` and `uri`.
2. **Walk frontmatter for object-form refs.** For every `{ ref: "..." }` (and any known sibling keys), resolve the path. Error if it doesn't exist.
3. **Parse body as Markdoc.** Validate against the registered tag schemas. The custom `Ref` attribute type runs path resolution for every `ref="..."` attribute. The custom `Href` attribute type validates URL syntax (resolution is optional via network probe).
4. **Cross-check paired refs.** For schemas with both frontmatter and body refs to the same targets (like `capture-session`'s `images: [...]` plus inline `{% image-ref %}`), check consistency.

Errors include line numbers from either YAML's parser (for frontmatter errors) or Markdoc's `location` (for body errors):

```
box/inbox/foo.memo.card:14: Ref does not resolve: people/Priya.person.card
box/inbox/scan-XXXX/scan-XXXX.capture-session.card:7: Inline image-ref "photo-099.image.card" not in frontmatter `images` list
store/recipes/Norma.recipe.card:23: Attachment path "norma.jpg" not found at Norma.attach/norma.jpg
box/output/briefs/2026-02-01_news.news-brief.card:42: Source ref has neither body content nor a `note`/`reason`/`usage` attribute (contextual refs need to explain why they're there)
```

That last error is enforced as a schema rule on contextual ref tags: empty body AND missing all known reason-carrying attributes is a warning or error, configurable per tag. This codifies the "refs almost always have a reason" principle — if you can't write a sentence about why this ref is here, the ref probably doesn't belong.

### Tooling implications

- **`cb mv` rewriting.** When a file moves, the tool finds all refs to the old path and rewrites them. Today this is grep + XML attribute substitution. New version: walk frontmatter (YAML-aware) and Markdoc body (AST-aware) for refs to the old path, rewrite each. More complex than grep but more reliable.
- **Doc graph.** Today's doc-graph builder reads cards and extracts refs to build the cross-card link graph. Same operation; new card format. The schema-declared format approach makes this easier (the builder asks each card's schema "what are the ref fields?" and walks them).
- **Validator-aware grep.** A `cb refs <path>` command that lists all cards referencing a target. Implementable today; easier with the new format because refs have predictable shapes.
- **Source editor jump-to-source.** When the editor sees a ref in a card's rendered view, clicking it opens the target card. Works today; gets line-precision under the new format because Markdoc gives positions.

### Tradeoffs honestly

- **Verbosity.** Object form for refs (`{ref: "..."}`) is wordier than bare strings. Frontmatter with many ref lists looks heavier than today's XML attribute soup. Trade for greppability and uniformity.
- **Three formats vs one.** Today every reference is `ref="..."` in XML. The new design distinguishes card refs (object), attachment paths (bare string in schema-declared field), and URLs (bare string in schema-declared field). More expressive, but agents and humans need to know the distinction.
- **Schema-dependence for full validation.** Bare-string fields (attachment paths, URLs) need the schema to know what to validate. A box with no schema for a card type can't fully validate it. Today's XML has the same issue (without the schema we can't validate anything beyond well-formedness), so this isn't a regression.
- **Markdoc body refs are a separate surface.** The `Ref` attribute type validation runs in the Markdoc parser, which is different code from the YAML frontmatter walker. Two implementations of "resolve a ref" — possible source of drift if not carefully shared.

### Open questions

- **Cross-box refs.** Out of scope for this RFC, but worth noting: today refs are always within a single box. If we ever want cross-box references (one box reading another's data), we'd need a syntax for that. Probably `box-name:/path/to/card.md` or similar. Don't design it now; flag it.
- **Stable IDs vs paths.** Refs are paths today. Paths break on moves; we accept that and rewrite. Alternative: assign each card a stable ID (UUID or hash) and ref by ID instead. Pro: refs survive moves. Con: less greppable, requires an ID registry, can't compose refs by inspection. Probably not worth changing.
- **Bidirectional refs.** Today refs are one-way (A points to B; B doesn't know who points at it). The doc-graph builder reconstructs back-references at read time. For some workflows (find all cards that reference person X) we'd want efficient back-reference lookup. Out of scope for the format change; could be added as an index.
- **Ref-with-display-text in body.** Markdoc tag content can be the display text: `{% person ref="people/Alice.person.card" %}Alice{% /person %}`. Should display text be optional (omit and use the target's title)? Probably yes — same as today's `<link ref="..."/>` falls back to the target's title.

## Frontmatter format and strictness

YAML's reputation is mostly earned for its 1.1-era foot-guns. Worth being explicit about which version, which schema, and which validation layers we use, because the defaults matter.

### What was actually broken

YAML 1.1's notorious cases:

- **The Norway problem:** `country: NO` parses as `false` because `NO`/`no`/`N`/`n`/`yes`/`YES`/`on`/`off`/`On`/`OFF` are all booleans.
- **Sexagesimal:** `time: 1:2:3` parses as `3723` (base-60 number).
- **Octal-by-leading-zero:** `mode: 010` parses as `8`.
- **Auto-date parsing:** `version: 2024-01-15` becomes a Date object instead of a string.
- **Implicit nulls:** `key:` (empty value) is `null`.
- **Tabs in indentation** (spec-forbidden but historically tolerated).

### What modern parsers fix

**YAML 1.2 (Core Schema)** — the current spec, default in `js-yaml` v4+ and most modern parsers — fixes most of these:

- Booleans are only `true`/`false` (and `True`/`TRUE` capitalizations). `yes`/`no`/`on`/`off` are strings.
- No sexagesimal numbers.
- Octal requires `0o` prefix (like Python 3).
- Auto-date parsing is parser-specific; can be disabled.
- Implicit null is unchanged but harmless if the schema rejects nulls in fields that shouldn't be null.

**`js-yaml` with `JSON_SCHEMA`** — the strictest built-in option. Only the four JSON types (string, number, boolean, null). No implicit dates, no custom tags, no anchors. Effectively "YAML-as-syntactic-sugar-for-JSON."

```ts
import { load, JSON_SCHEMA } from "js-yaml";
const data = load(yamlText, { schema: JSON_SCHEMA });
```

This alone covers the "no `on`/`off` as bools" requirement plus most other historical foot-guns.

### Stricter alternatives surveyed

- **StrictYAML** (Python only) — no implicit typing at all (everything's a string until schema converts), no flow style, no anchors/aliases/tags, no multi-document streams. Right design philosophy; wrong language for us.
- **NestedText** (multi-language) — even more minimal: only strings, schema does all type conversion. The cleanest "let the schema decide types" implementation. Worth knowing about; agents have seen far less of it than YAML.
- **TOML** — strict typing, no implicit conversions. Excellent for flat config; awkward for nested arrays-of-tables. Could fit if frontmatter stays mostly flat, but several schemas have nested structures that would get verbose.
- **JSON5** — JSON + comments + trailing commas. Loses YAML's prose-friendliness (multi-line strings, optional quoting). Bad fit for frontmatter that sometimes carries paragraph-length text.

### Recommended layered approach

1. **Parse with `js-yaml` v4+ using `JSON_SCHEMA`.** YAML 1.2 + JSON-only types. Eliminates parse-time foot-guns.

2. **Validate parsed result against per-card-type JSON Schema.** Catches anything that survives the parser — wrong types, missing required fields, unknown keys (with `additionalProperties: false`), enum violations.

3. **Add a frontmatter linter pass** for the strictness rules YAML doesn't natively enforce but we want:
   - **Reject flow style** for top-level structural fields. `images: [a, b, c]` becomes block style. Allow flow for genuinely compact value-objects like coordinate bboxes (`bbox: { y1: 90, x1: 70, y2: 930, x2: 930 }`) — declared per-field in the schema.
   - **Reject anchors/aliases** (`&foo`, `*foo`). Cleverness we don't need; creates non-obvious dependencies between fields.
   - **Reject custom tags** (`!foo`). All typing goes through JSON Schema, not YAML tags.
   - **Reject multiple documents** in a single frontmatter block (the `---` separator should only appear at the boundaries between frontmatter and body).
   - **Enforce key-style consistency.** Pick kebab-case (matches today's XML attribute style: `has-text`, `transcribed-at`) and lint for any `snake_case` or `camelCase` keys. Reject duplicate keys (YAML 1.2 forbids these but parsers vary).

The linter walks the YAML CST (not the parsed values) and flags constructs by type. The `yaml` package (eemeli/yaml) has a richer CST than `js-yaml` and preserves comments — probably the better choice for the linter pass even if we use js-yaml for the actual parse. Or just use eemeli/yaml for both.

### Net effect

- Agents authoring frontmatter the way they naturally do (block-style mappings, simple scalars, occasional `|`-blocks for multi-line text) write valid frontmatter without thinking about it.
- Constructs that confuse readers or hide intent (flow style for top-level structures, anchors, custom tags) are rejected at lint time with clear errors.
- Foot-gun-class type coercions (the Norway problem, octal numbers, sexagesimal) can't happen because the parser is in the strictest standard mode.
- Wrong types for declared fields are caught by JSON Schema validation with line-precise errors.

Three layers of defense, none exotic. The result is "YAML, but predictable" — close in spirit to StrictYAML's design without leaving the JS ecosystem.

## Schema authoring

Each card type and each shared tag is a single `.ts` file. Same pattern as today's cardworks `element()` schemas — one file per type, exporting a default schema definition.

```
src/schemas/
  cards/
    memo.ts                # frontmatter Zod + bodyTags list + optional validator
    image.ts
    capture-session.ts
    news-brief.ts
    landmark.ts
    person.ts
    ...

  tags/
    person.ts              # shared inline-tag definition (used in memo, record, briefing, ...)
    context.ts
    transcription.ts
    source.ts
    section.ts
    expando.ts
    image-ref.ts
    ...

  attribute-types/         # built-in custom attribute types (Ref, Href, AttachmentPath)
    ref.ts
    href.ts
    attachment-path.ts
```

A built-in card definition:

```ts
// src/schemas/cards/memo.ts
import { z } from "zod";
import { defineCard, AttachmentPath, type Diagnostic } from "../helpers.js";

const Frontmatter = z.object({
  status: z.enum(["new", "processing", "processed"]).default("new"),
  created: z.string().datetime({ offset: true }),
  source: z.string().optional(),
  audio: AttachmentPath.optional(),
});

export default defineCard({
  name: "memo",
  frontmatter: Frontmatter,
  bodyTags: ["transcription", "person", "context"],
  instructions: `# Memo cards
A memo is a text or voice note...`,

  validate(card, ctx): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    if (card.frontmatter.source === "voice") {
      const hasTranscription = card.body.tags.some(
        t => t.name === "transcription" || t.name === "transcription-error"
      );
      if (card.frontmatter.audio && !hasTranscription &&
          card.frontmatter.status === "processed") {
        diagnostics.push({
          level: "warning",
          code: "memo/voice-processed-no-transcription",
          message: "Voice memo marked processed but has no transcription",
          location: card.frontmatter._location?.status,
        });
      }
    }
    return diagnostics;
  },
});
```

A shared tag definition:

```ts
// src/schemas/tags/person.ts
import { z } from "zod";
import { defineTag, Ref } from "../helpers.js";

export default defineTag({
  name: "person",
  attributes: z.object({
    ref: Ref({ targetType: "person" }),
    note: z.string().optional(),
  }),
  requiresContext: true,  // body OR `note` attribute must be present
});
```

`defineCard` and `defineTag` are thin helpers that:
- Register the type in the runtime registry on import
- Wire the Zod schema into the JSON Schema validator
- Wire the tag attributes into Markdoc's tag schema
- Emit derived JSON Schema artifacts to `dist/schemas/` at build time (see below)

### Compiled per-card-type docs (the schema IS the documentation)

The same Zod schemas drive both runtime validation AND the documentation that agents read when working with cards. The compiled doc per card type bundles:

1. **Prose intro** (from the schema's `instructions` field)
2. **Frontmatter JSON Schema** literal, embedded in a code block — agents can ingest it directly
3. **Body tag reference** — for each allowed tag, its attribute schema and a usage example
4. **Validation rules** — list of rule codes with descriptions
5. **Examples** — complete cards from `examples:` in the schema

This collapses two artifacts (today's hand-rendered `docs/generated/card-<name>.md` AND the runtime schema) into a derived view of one source. No possibility of drift.

#### Watch the emitted JSON Schema

Zod-to-JSON-Schema is not lossless and the output can be ugly — deep `anyOf` nestings, indirect `$ref` indirection through `definitions`, structural artifacts that don't reflect how a human would have hand-written the schema. When the emitted JSON Schema is the documentation an agent reads, ugly output undermines the benefit.

**Practice for schema authors:** after writing or modifying a Zod schema, look at the emitted JSON Schema (`dist/schemas/cards/<name>.schema.json` or via `defineCard().toJsonSchema()`). If it's incomprehensible at a glance, restructure the Zod schema to produce something cleaner. Sometimes that means using simpler Zod primitives, sometimes flattening a nested object, sometimes hand-writing the JSON Schema as the source and deriving a Zod schema from it for runtime validation.

This is a manual discipline, not a tooling requirement. The schema-authoring doc in this RFC should make it explicit: "review the emitted JSON Schema; if it's ugly, fix it."

#### Example: `docs/generated/card-memo.md`

````markdown
# Memo cards

A memo is a text or voice note. Voice memos have an `audio` attachment and contain a `{% transcription %}` body tag once transcribed. Text memos use the body for the user's content.

## Frontmatter

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["created"],
  "properties": {
    "status": {
      "type": "string",
      "enum": ["new", "processing", "processed"],
      "default": "new"
    },
    "created": { "type": "string", "format": "date-time" },
    "source": { "type": "string" },
    "audio": { "type": "string", "format": "attachment-path" }
  }
}
```

## Body tags allowed

### `{% transcription %}`

Voice memo transcription content. Body holds the transcribed text.

Attribute schema:
```json
{
  "type": "object",
  "required": ["language", "transcribed-at"],
  "properties": {
    "language": { "type": "string" },
    "transcribed-at": { "type": "string", "format": "date-time" }
  }
}
```

Example:
```markdown
{% transcription language="en" transcribed-at="2026-02-07T18:40:00Z" %}
The transcribed text goes here.
{% /transcription %}
```

### `{% person ref="..." %}`

Refer to a person card. Body or `note` attribute explains why.

Attribute schema:
```json
{
  "type": "object",
  "required": ["ref"],
  "properties": {
    "ref": { "type": "string", "format": "ref", "targetType": "person" },
    "note": { "type": "string" }
  }
}
```

Example:
```markdown
... mentioned by {% person ref="people/Alice.person.card" note="primary contact" /%} ...
```

### `{% context %}` ...

## Validation rules

| Code | Level | Description |
|---|---|---|
| `memo/voice-processed-no-transcription` | warning | Voice memos marked `processed` should have a `{% transcription %}` body tag |
| `memo/processed-empty-body` | info | Memos marked `processed` typically have body content |

## Examples

### Text memo
```markdown
---
status: new
created: 2026-02-07T18:39:11Z
source: dropbox
---

I'd like to share this with {% person ref="people/Priya.person.card" %}who works on this{% /person %}.
```

### Voice memo (transcribed)
```markdown
---
status: processed
created: 2026-02-07T18:39:11Z
source: voice
audio: voice-memo-001.webm
---

{% transcription language="en" transcribed-at="2026-02-07T18:40:00Z" %}
The transcribed text goes here.
{% /transcription %}
```
````

The agent reads this and gets:
- The JSON Schema as canonical data (it knows how to reason about JSON Schema natively)
- A complete tag inventory with example usage for each
- Every validation rule it might trip, with a description
- Working complete examples to pattern-match against

### Validators document themselves

To make rule descriptions appear in the compiled doc, separate rules-metadata from validator-implementation:

```ts
export default defineCard({
  name: "memo",
  frontmatter: Frontmatter,
  bodyTags: ["transcription", "person", "context"],
  instructions: `# Memo cards\n\nA memo is a text or voice note...`,

  examples: [
    {
      name: "Text memo",
      content: `---\ntype: memo\nstatus: new\n...`,
    },
    {
      name: "Voice memo (transcribed)",
      content: `---\ntype: memo\nstatus: processed\n...`,
    },
  ],

  rules: {
    "memo/voice-processed-no-transcription": {
      level: "warning",
      description: "Voice memos marked `processed` should have a `{% transcription %}` body tag",
    },
    "memo/processed-empty-body": {
      level: "info",
      description: "Memos marked `processed` typically have body content",
    },
  },

  validate(card, ctx) {
    const diagnostics: Diagnostic[] = [];
    // ... emits diagnostics whose `code` matches an entry in `rules` above
    return diagnostics;
  },
});
```

The compiled doc lists every entry in `rules` with its description. The validator emits diagnostics whose `code` references one of those entries. A unit test enforces that every emitted code has a matching `rules` entry — no orphaned diagnostics, no undocumented rules.

This pattern means **adding a new validation rule is a documentation update, not a separate doc-edit step.** Add the rule to `rules:`, emit it from `validate()`, the next doc generation includes it.

### Per-tag docs (for shared tags)

Each shared tag in `tags/` gets its own `docs/generated/tag-<name>.md` showing the full attribute schema, an example, and which card types use it. The per-card docs link into them rather than re-rendering everything inline.

For tags with `requiresContext: true` (the contextual-ref pattern), the tag doc explicitly notes that body content or a known reason-carrying attribute is required.

### Why this matters for the proposal

The doc-generation argument is one of the strongest single reasons to pursue this format change:

- **Today's `docs/generated/` is hand-rendered from custom schema introspection.** Agents read prose generated from XML element shapes; they can't ingest it as a schema.
- **Tomorrow's `docs/generated/` embeds the actual JSON Schema as data.** Agents (well-trained on JSON Schema) read it the way they'd read any schema spec, and the embedded examples + tag references + rule list give them the complete operational picture in one place.
- **One source.** The `.ts` file IS the source for runtime validation, agent docs, and external schema artifacts. No drift between any of them. Adding a field, a tag, a rule, or an example is one edit.

The current generation pipeline (in `src/dev/`) becomes mechanically simpler — emit JSON Schema and walk the tag/rule/example metadata, instead of rendering a custom format from XML element introspection.

### Other consumers of the JSON Schema artifact

The same `dist/schemas/cards/<name>.schema.json` files serve:

- **External tools** wanting to validate frontmatter without loading our TypeScript runtime
- **Static analysis** — finding all card types, all ref-typed fields, all enum values without parsing TS
- **Form generation** — UI form generators that consume JSON Schema (if we ever build a card editor with form-style input)
- **IDE integration** — VSCode and friends can apply JSON Schema validation to YAML files via the YAML extension; pointing it at our schemas would give in-editor validation of frontmatter

Box-local schemas can opt into the same emission via a build step (`cb schemas build`), or the registry can produce schemas on demand at runtime via `defineCard().toJsonSchema()` for tools that need them dynamically.

### Box-local extensibility

A box adds a card type by writing a `.ts` file in `config/schemas/cards/`:

```
config/schemas/
  cards/
    grocery-list.ts          # box-specific card type
  tags/
    family-member.ts         # box-specific shared tag
```

Same `defineCard` and `defineTag` helpers. Same Zod schemas. Same validator hooks. The box's `.ts` files import from `callback-box/schemas` (resolved via the registry hook in `src/schemas/registry.ts` that already exists for today's `.ts` schemas).

This stays consistent with today's pattern — boxes write `.ts` files, with a small set of imports from the runtime. No new file format to learn.

### Validator API

What the validator function gets:

```ts
interface CardValidator {
  // Optional: transform the card before validation (normalize, fill defaults)
  transform?(card: Card, ctx: ValidationContext): Card;

  // Main validator — runs after JSON Schema, Markdoc, and ref-resolution validation pass
  validate(card: Card, ctx: ValidationContext): Diagnostic[];

  // Optional: heavier checks, run only at commit time (network probes, external commands)
  validateOnCommit?(card: Card, ctx: ValidationContext): Promise<Diagnostic[]>;
}

interface ValidationContext {
  boxRoot: string;
  cardType: string;
  config: Record<string, unknown>;
  getCard(path: string): Promise<Card | null>;
  listCards(query: string): Promise<string[]>;  // glob
  resolveRef(ref: string): Promise<string | null>;
}
```

`validateOnCommit` is the escape hatch for expensive checks. Skipped during interactive `cb validate`; runs in the pre-commit hook.

### Diagnostic shape (uniform across all sources)

Every diagnostic — from JSON Schema validation, Markdoc body validation, ref resolution, or a per-card validator — uses the same shape:

```ts
interface Diagnostic {
  level: "error" | "warning" | "info";
  code: string;          // machine-readable, namespaced (e.g. "memo/voice-processed-no-transcription")
  message: string;       // human-readable
  location?: {
    line: number;
    column?: number;
    surface: "frontmatter" | "body";
  };
  suggestion?: string;   // optional fix hint
}
```

`cb validate` collects diagnostics from all sources, deduplicates, sorts by location, reports:

```
box/inbox/voice-memo-001.memo.card:
  6:1   error    memo/missing-required: `created` is required
  14:5  warning  memo/voice-processed-no-transcription: Voice memo marked processed but has no transcription
  18:3  error    refs/not-found: Ref does not resolve: people/Priya.person.card
```

### Layered validation summary

A card flowing through `cb validate`:

1. **YAML parse** (strict, `JSON_SCHEMA` mode) → frontmatter object with line positions
2. **JSON Schema validation** of frontmatter (derived from Zod) → diagnostics
3. **Markdoc parse** of body → tag tree with positions
4. **Tag schema validation** of body → diagnostics
5. **Ref resolution** (frontmatter + body refs) → diagnostics
6. **Per-card validator** (if defined) → diagnostics
7. **Pre-commit hook** runs `validateOnCommit` (if defined) → diagnostics

Each layer is independently testable. Each diagnostic carries a location and a code. The per-card validator is the explicit escape hatch for anything the declarative layers can't express — cross-field constraints, cross-card lookups, domain-specific rules.
