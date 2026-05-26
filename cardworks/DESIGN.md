# Cardworks Design Document

A TypeScript library for managing structured XML content with first-class support for content blocks ("cards"), references, and versioning.

## Overview

Cardworks provides a simplified, opinionated model for working with XML documents. Rather than exposing the full complexity of XML (mixed content, arbitrary nesting, processing instructions), it presents a cleaner abstraction suited for structured content management.

## Core Concepts

### Cards

A **card** is a self-contained content unit stored as an XML file. Cards are the primary unit of content in Cardworks. What constitutes a card depends on your application - examples might include:

- A chapter or article
- A tutorial or guide
- A reference entry
- A recipe, character profile, or other domain object

The library is schema-agnostic: it parses, validates, and serializes XML but doesn't prescribe what elements your cards should contain. You define your own schemas using Zod.

### XML Structure

Cardworks works with XML documents. Text content within elements is typically treated as opaque - you might use Markdown, plain text, or any other format. The library doesn't parse or interpret text content beyond basic whitespace handling (dedenting).

**What Cardworks handles:**
- Card boundaries and identity (one card per file)
- Element structure and attributes
- References and links between cards
- Version information
- Comments (preserved through round-trips)

**What's left to your application:**
- Text content format (Markdown, plain text, etc.)
- Schema design and validation rules
- Semantic meaning of elements

### XML Parsing Philosophy

**Strict parsing, early errors.** We use standard XML with standard escaping rules. When malformed XML is encountered, we fail immediately with clear error messages (including line/column). The expectation is that agents will fix errors when they occur.

**Escaping rules (standard XML):**
- `<` → `&lt;`
- `>` → `&gt;`
- `&` → `&amp;`
- Quotes in attributes must be escaped or use alternate quote style

**No leniency needed:**
- Standard XML parsers work fine
- Errors surface early with good provenance info
- Agents can fix malformed output quickly

### Content Models

Cardworks supports two content models:

**1. Text + Sibling Tags (Default)**

Text content with accompanying metadata elements that don't mix into the text:

```xml
<content>
  A bunch of markdown text here.

  More paragraphs...
  <source ref="./references/smith2024" />
  <note>Editorial note about this content</note>
</content>
```

The text is extracted separately from the sibling elements. The `<source>` and `<note>` are metadata *about* the content, not *within* it. This is the common case and simpler to process.

**2. Mixed Inline Markup (When Needed)**

Sometimes true mixed content is necessary, where inline elements appear within text:

```xml
<span>Hello <ins>you!</ins></span>
<span>This word is <mark>highlighted</mark> for emphasis.</span>
<span>See <ref target="./other">this card</ref> for details.</span>
```

Use cases for mixed content:
- Inline insertions/deletions (`<ins>`, `<del>`)
- Highlighting or annotations (`<mark>`, `<annotation>`)
- Inline references that need custom link text
- Rich text spans that can't be expressed in Markdown

**Design principle**: Prefer the text + sibling model. Use mixed content only when inline markup is truly needed. Most content should be Markdown with metadata as siblings.

### Whitespace Handling

Content elements use **dedent** semantics:

1. Leading/trailing whitespace on the whole content is trimmed
2. Common leading indentation is stripped from all lines

This allows clean XML formatting without affecting content:

```xml
<card id="example">
  <content>
    # Hello!

    This is the first paragraph.

    - Item one
    - Item two
  </content>
</card>
```

The content value is:
```
# Hello!

This is the first paragraph.

- Item one
- Item two
```

**Not** indented with 4 spaces. The XML indentation is for readability, not part of the content.

### Example

```xml
<card id="escaping-example">
  <content>
    This needs escaping: Tom &amp; Jerry, and 2 &gt; 1.

    Quotes are fine in content: "no escaping needed" here.

    Use &lt;card&gt; when referring to card elements.
  </content>
</card>
```

### Provenance Tracking

Every node carries its provenance:

```typescript
interface Provenance {
  source: string;      // File path or URI
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  parent?: Node;       // Link to parent (for reaching version info)
}

interface Node {
  provenance: Provenance;
  dirty: boolean;      // Has this node been modified since load?
  // ...
}
```

This enables:
- Meaningful error messages ("Error at cards/intro.xml:15:3")
- Source maps for tooling
- Debugging and inspection
- Change tracking (clean/dirty)
- Traversing to parent for version context

### References and Links

References are path-based and first-class, using the `ref` attribute.

#### Reference Syntax

A reference has three optional parts:

```
path@version#fragment
```

- **path**: Absolute or relative path to a card
- **@version**: Semantic version pin (optional)
- **#fragment**: ID or query within the card (optional)

#### Path Resolution

Paths resolve against a **project root**:

```
/foo/bar.card        # Absolute - from project root
./sibling.card       # Relative - same directory
../other/card.card   # Relative - parent directory
```

If project root is `~/src/my-project/cards/`, then `/intro/welcome.card` resolves to `~/src/my-project/cards/intro/welcome.card`.

#### Version Syntax

Use `@` to record the version that was current when the reference was made:

```
./card@1.2.0         # Referenced when card was at 1.2.0
./card               # No version recorded
```

The version is **not a pin** - it doesn't mean "I want version 1.2.0." It means "I wrote this reference when version 1.2.0 was current." This enables staleness detection: if the target is now at 1.3.0, the reference may need review.

A bare reference (no `@`) has no version tracking.

Versions follow semver: `@1.0.0`, `@2.1.3`, etc.

#### Attribute Syntax

References always use attributes, so they can attach to any element:

```xml
<source ref="./primary.card" />
<note ref="./context.card@1.0.0#section" />
```

For multiple references, use `refs` with whitespace separation (like HTML's `<a ping>`):

```xml
<derived refs="./source-a.card@1.0.0 ./source-b.card@2.1.0" />
```

This keeps reference handling uniform - routines that process refs can find them anywhere via attribute inspection.

#### Reference Annotations

The general pattern includes explanatory content describing why the reference exists or what aspect was used:

```xml
<source ref="./Algorithms.reference.card@1.2.0#sorting">
  Used the quicksort implementation described here
</source>

<derived ref="./Original.tutorial.card@2.0.0">
  Simplified version for beginners
</derived>

<seealso ref="./Advanced.tutorial.card">
  For more complex use cases
</seealso>
```

The annotation is not always required, but usually preferred - it helps readers (and agents) understand the relationship, not just that one exists.

#### Fragment Syntax

Use `#` for within-card references:

```
./card#section-id           # By element ID (expects exactly one)
./card#query(expr)          # By query expression (expects one)
./card#query-all(expr)      # By query expression (expects multiple)
```

**ID references** (`#id`): Target elements with matching `id` attribute. Simple, common, and always expects exactly one match.

**Query references**: Use XPath subset for the expression language.
- `#query(expr)` - expects exactly one result; warns/errors if multiple match
- `#query-all(expr)` - expects multiple results; returns all matches

Examples:
```
./card#query(//section[@type='intro'])     # One section
./card#query-all(//example)                # All examples
./card#query(/card/meta/title)             # The title element
```

#### ID Uniqueness

The `id` attribute is special:
- IDs must be unique within a card
- Tooling should warn on duplicate IDs
- Enables the simple `#id` fragment syntax

```xml
<card id="example">
  <section id="intro">...</section>
  <section id="details">...</section>
  <section id="intro">...</section>  <!-- WARNING: duplicate id -->
</card>
```

#### Combined Examples

```
./Getting_Started.tutorial.card                     # Card, current version
./Getting_Started.tutorial.card@1.0.0               # Card, versioned
./Getting_Started.tutorial.card#prerequisites       # Section by ID
./Getting_Started.tutorial.card@1.0.0#prerequisites # Version + fragment
./api/Card.reference.card#query(//method[@name])    # Query
/Glossary.reference.card#term-widget                # Absolute path
```

#### Version References for Staleness Detection

The version in a reference records what was current when the reference was written:

```xml
<tutorial version="2.0.0">
  <content>
    See the installation guide for setup.
  </content>
  <source ref="./Install.guide.card@1.0.0#steps">Installation steps</source>
</tutorial>
```

If `./Install.guide.card` is now at version `1.1.0`, tooling flags this reference as potentially stale - the tutorial was written against 1.0.0 and may need updating to reflect changes in the installation guide.

This is dependency tracking: content that references other content knows when its dependencies have changed.

### Content Versioning

Cards support semantic versioning of their content:

```xml
<card id="intro" version="2.1.0">
  ...
</card>
```

Versioning semantics (TBD):
- **Patch**: Typo fixes, formatting changes
- **Minor**: Additional content, clarifications
- **Major**: Structural changes, meaning changes

Questions to resolve:
- How is version history stored?
- Is version comparison automatic or manual?
- Integration with git or standalone?

### Media Support (Future)

> **Not yet implemented.** This section describes potential future functionality.

Cards could reference accompanying media files that share the card's basename (e.g., `Pronunciation_Guide.audio.card` + `Pronunciation_Guide.m4a`). Design considerations for future implementation:

- Media files live alongside their card (same basename, media extension)
- Validation that referenced media exists
- File group operations (rename/move/delete affects all related files)

This needs further design work before implementation.

## Architecture

### Filesystem Abstraction

```typescript
interface FileSystem {
  read(path: string): Promise<string>;
  readBinary(path: string): Promise<Uint8Array>;
  write(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<string[]>;
  resolve(base: string, relative: string): string;
}
```

Implementations:
- `NodeFileSystem` - Node.js fs module
- `MemoryFileSystem` - In-memory for testing
- `BrowserFileSystem` - Origin Private File System or similar
- `VirtualFileSystem` - Composite/overlay filesystems

### Parsing Pipeline

```
XML Text
    ↓
@xmldom/xmldom Parse → DOM (kept for XPath queries)
    ↓
Transform to Zod objects (with provenance)
    ↓
Validation
    ↓
Typed Card Model
```

We keep both representations:
- **DOM** - for XPath queries (`#query(...)` references), provenance
- **Zod objects** - for typed access, validation, application logic

### Schema and Validation

We use **Zod** for schemas with convention-based XML mapping. No custom metadata needed for basic cases.

#### Core Conventions

| Field | Meaning | XML Mapping |
|-------|---------|-------------|
| `tagName` | Element name | `z.literal("element-name")` |
| `attrs` | Attributes | Object with primitive fields |
| `comments` | Before/after comments | Preserved through round-trips |
| `text` | Text content | Text inside element |
| `children` | Ordered child elements | Elements after text (if both present) |
| `mixed` | Interleaved text/elements | True mixed content |

#### Content Models

```typescript
// Text only
{ tagName: "title", text: "Hello" }
// <title>Hello</title>

// Text + children (text first, then elements)
{ tagName: "guidance", text: "Some advice...", children: [sourceRef] }
// <guidance>Some advice...<source ref="..." /></guidance>

// Children only (ordered, interleaved types)
{ tagName: "technique", children: [guidance1, prompts1, guidance2] }
// <technique><guidance>...</guidance><prompts>...</prompts><guidance>...</guidance></technique>

// Mixed (text and elements interleaved)
{ tagName: "span", mixed: ["Hello ", { tagName: "ins", text: "world" }, "!"] }
// <span>Hello <ins>world</ins>!</span>
```

#### The `element()` Helper

Factory function that adds standard fields with proper generic types:

```typescript
const Comments = z.object({
  before: z.string().optional(),
  after: z.string().optional(),
});

function element<
  TagName extends string,
  Attrs extends z.ZodRawShape = {},
  Children extends z.ZodTypeAny = z.ZodNever,
>(
  tag: TagName,
  config: {
    attrs?: z.ZodObject<Attrs>;
    text?: z.ZodString;
    children?: z.ZodArray<Children>;
    mixed?: z.ZodArray<z.ZodTypeAny>;
  } = {}
) {
  return z.object({
    tagName: z.literal(tag),
    attrs: (config.attrs ?? z.object({})) as z.ZodObject<Attrs>,
    comments: Comments.default({}),
    ...(config.text && { text: config.text }),
    children: (config.children ?? z.array(z.never())).default([]),
    ...(config.mixed && { mixed: config.mixed }),
  });
}
```

#### Example Schemas

```typescript
// Simple text element
const Title = element("title", {
  text: z.string(),
});

// Element with attributes and text
const Guidance = element("guidance", {
  attrs: z.object({ match: z.string().optional() }),
  text: z.string(),
});

// Reference element (attribute + text content)
const ResearchRef = element("research", {
  attrs: z.object({ ref: z.string() }),
  text: z.string(),  // explanation of the reference
});

// Element with text + child elements
const Content = element("content", {
  text: z.string(),  // markdown content
  children: z.array(z.union([ResearchRef, Note])),
});

// Element with ordered interleaved children
const Technique = element("technique", {
  attrs: z.object({
    version: z.string(),
    match: z.string().optional(),
  }),
  children: z.array(z.discriminatedUnion("tagName", [
    Guidance,
    Prompts,
    Examples,
  ])),
});

// Full card schema
const AudienceCard = element("audience", {
  attrs: z.object({ version: z.string() }),
  children: z.array(z.union([
    element("selection-text", { text: z.string() }),
    element("short-description", { text: z.string() }),
    element("traits", { text: z.string() }),
    element("guidance", { text: z.string() }),
    element("sources", {
      children: z.array(ResearchRef),
    }),
  ])),
});

// Type inference works:
type AudienceCardType = z.infer<typeof AudienceCard>;
// {
//   tagName: "audience",
//   attrs: { version: string },
//   comments: { before?: string, after?: string },
//   children: [...],
// }
```

#### Using Zod v4 Metadata (Optional)

For agent documentation and instructions, extend `GlobalMeta`:

```typescript
// cardworks.d.ts
declare module "zod" {
  interface GlobalMeta {
    instructions?: string;
    examples?: unknown[];
  }
}
export {};

// Usage
const Guidance = element("guidance", {
  attrs: z.object({ match: z.string().optional() }),
  text: z.string(),
}).meta({
  description: "Advice for the writer",
  instructions: "Write in second person. Be specific and actionable.",
});
```

### Querying

Potential approaches:
- XPath subset (familiar to XML users)
- Custom query language optimized for cards
- TypeScript predicate functions
- CSS-selector-like syntax

### Indexing

For large card collections:
- Build indexes for fast lookup by ID, tags, references
- Incremental index updates
- Persistence (optional)
- Full-text search integration (out of scope for core?)

## Module Structure

```
cardworks/
├── core/           # Core types and interfaces (Card, Provenance, etc.)
├── parser/         # Lenient XML parsing with position tracking
├── markdown/       # Markdown parsing and reference extraction
├── schema/         # TypeScript-based validation
├── refs/           # Reference resolution and link tracking
├── version/        # Content versioning support
├── fs/             # Filesystem abstractions
├── query/          # Querying support (future)
└── index/          # Indexing support (future)
```

## XML Format Examples

Examples aligned with the Zod schema conventions.

### Simple Card (audience)

File: `Faith_Community.audience.card`

```xml
<!-- Guidance for faith community audiences -->
<audience version="1.0.0">
  <selection-text>Faith community</selection-text>
  <short-description>People from your church, mosque, synagogue, or spiritual community</short-description>
  <traits>members of their faith community who share spiritual values</traits>
  <guidance>
    You share a moral foundation - that's a bridge. Frame your experience
    in terms of values your faith teaches: loving your neighbor, protecting
    the vulnerable, welcoming the stranger.
  </guidance>
  <sources>
    <research ref="./Moral_Reframing.research.card@1.0.0#sanctity-study">
      Sanctity and sacred duty framing
    </research>
  </sources>
</audience>
```

### Card with Interleaved Children (technique)

File: `Lead_With_Values.technique.card`

```xml
<technique version="1.0.0" match="some-disagree">
  <purpose>
    This is about moral reframing - presenting your story in terms of
    values your reader shares, not just values you hold.
  </purpose>
  <sources>
    <research ref="./Moral_Reframing.research.card@1.0.0#moral-empathy-gap">
      The "moral empathy gap" explains why arguments fail.
    </research>
  </sources>
  <!-- Guidance and prompts can be interleaved -->
  <guidance>
    Start by naming a value you share with your reader - family, safety,
    freedom, faith, community, fairness.
  </guidance>
  <guidance match="some-disagree">
    When your reader may not share your politics, leading with values is
    essential. Find the overlap.
  </guidance>
  <prompts title="Find your shared values">
    <prompt>What values drove your actions? Loyalty? Faith? Family?</prompt>
    <prompt>What values does your reader care about? Where do you overlap?</prompt>
  </prompts>
  <examples>
    <example label="Opening with shared values">
      "I know we see some things differently, but I think we both care
      about family. That's what this story is really about for me."
    </example>
  </examples>
</technique>
```

### Mixed Content (when needed)

For inline markup within text:

```xml
<annotation version="1.0.0">
  <span>The original text said <del>this</del> but was changed to <ins>that</ins>.</span>
</annotation>
```

## DITA Inspiration

DITA (Darwin Information Typing Architecture) has several ideas worth adopting:

### Topics → Cards
DITA's self-contained "topics" map directly to our cards. Topics are meant to be reusable and standalone.

### Maps (Future Consideration)
DITA "maps" define how topics relate and sequence. We may add something similar later, but for now organization comes from the filesystem hierarchy.

### Specialization
DITA lets you create specialized topic types (concept, task, reference). We can do this with TypeScript:

```typescript
interface ConceptCard extends Card {
  type: 'concept';
  definition: string;
}

interface TaskCard extends Card {
  type: 'task';
  steps: string[];  // Markdown for each step
  prerequisites?: Ref[];
}
```

### Content References (conref)
DITA's `conref` allows reusing content fragments. We might support something similar:

```xml
<card id="warning-backup">
  <content id="backup-warning">
**Warning**: Always back up your data before proceeding.
  </content>
</card>

<!-- In another card -->
<card id="upgrade-guide">
  <content>
<include src="./warning-backup#backup-warning" />

Now proceed with the upgrade...
  </content>
</card>
```

### What We're NOT Taking from DITA

- Complex DTD-based validation (using TypeScript instead)
- Verbose element names (`<cmd>`, `<stepresult>`, etc.)
- Processing instructions and specialization machinery
- Heavy toolchain requirements

## Design Decisions

- **Content format**: Markdown inside XML structure
- **Schema approach**: Zod with convention-based XML mapping
  - `element()` helper provides `tagName`, `attrs`, `comments`, `children` defaults
  - Generics preserve types for `z.infer<>`
  - Zod v4 `.meta()` for optional agent documentation
- **Content models**: Four patterns via field names
  - `text` only, `text` + `children`, `children` only, `mixed`
- **References**: Path-based `path@version#fragment` syntax
  - `ref` attribute for single, `refs` for multiple (whitespace-separated)
- **Inspiration**: DITA's topic model, but much simpler
- **Organization**: Filesystem hierarchy, one card per file
- **XML style**: Standard escaping, strict parsing, early errors
- **Editability**: Designed for hand-editing and agent-editing
- **File naming**: `name.tagname.card`
  - Proper nouns / specific names: `Title_Case` (e.g., `Faith_Community.audience.card`)
  - Generic / descriptive names: `kebab-case` (e.g., `lead-with-values.technique.card`)
  - Tag/type is always lowercase
  - Directories free for other organization (topic, project, etc.)
- **Supplementary files**: Media and derivative files alongside cards
  - Same basename, appropriate extension: `Original.m4a` with `Original.audio.card`
  - Media files (`.m4a`, `.png`, `.mp3`, etc.) - not read directly by AI
  - Derivative files (`.json`) - lifecycle/build artifacts, not for AI consumption

## Outstanding Design Issues

### High Priority

1. **Content model distinction** - ✓ Designed
   - `text` only: text-only element
   - `text` + `children`: text first, then child elements
   - `children` only: ordered element children
   - `mixed`: true interleaved text and elements

2. **Reference system** - ✓ Designed
   - `path@version#fragment` syntax
   - Absolute (from project root) and relative paths
   - `ref=""` for single, `refs=""` (whitespace-separated) for multiple
   - Always attributes, so refs can attach anywhere

3. **Subsection references** - ✓ Designed
   - `#id` for ID references (expects exactly one)
   - `#query(expr)` for single result, `#query-all(expr)` for multiple
   - Full XPath 1.0 via xpath-ts (queries run against DOM)
   - IDs must be unique within card (warn on duplicates)

4. **Version references** - ✓ Designed
   - `@version` syntax (follows npm convention)
   - Records "version when reference was made" (not a pin)
   - Bare = no version recorded
   - Enables staleness detection: flag when target has changed

5. **TypeScript ↔ XML mapping** - ✓ Designed
   - Zod schemas with convention-based mapping
   - `element()` helper with generics for type inference
   - `tagName`, `attrs`, `comments`, `text`, `children`, `mixed` conventions
   - Zod v4 `.meta()` for optional agent instructions

### Decided

6. **Provenance** - Every node carries provenance
   - File and line numbers on every node
   - Parent link to reach version info
   - Track clean/dirty state for change detection

7. **Serialization** - Normalizing on round-trip is expected
   - Config option for formatting preferences (e.g., indentation or not)
   - "Card loader" concept that holds format preferences
   - Maybe simpler to not indent at all - TBD, make configurable

8. **File organization** - One card per file

9. **Comments** - Preserved through round-trips
   - Allowed at top or bottom of a tag
   - Multiple adjacent comments folded into one

10. **Namespaces** - No XML namespaces. No namespace support at all.

11. **Markdown** - Built with Markdown in mind but not deeply integrated
    - Line number passthrough would be nice but not essential
    - `ref:` syntax for references in Markdown content

12. **Errors** - Iterate on format
    - Designed for agents, actionable
    - Contextual - what's useful may vary by situation

### Lower Priority (For Later)

13. **Extensibility** - User-defined elements/attributes
14. **Index persistence** - File-based, database, or memory-only?
15. **Media processing scope** - Just references, or thumbnails/metadata extraction?

## Dependency Decisions

- **XML parser**: `@xmldom/xmldom` - DOM implementation for Node.js
- **XPath**: `xpath-ts` - Full XPath 1.0, TypeScript, works with xmldom
- **Markdown**: `remark` - good line number tracking via unist positions
- **Schema/validation**: Zod v4
- **Version control**: Git (version history lives in git)
- **Testing**: `tap` - TAP-based test framework

## Code Standards

**TypeScript**: Strict settings, no escape hatches
- `strict: true`
- `noImplicitAny: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- No `any` - use `unknown` and narrow

**Linting**: Start strict, relax only with justification
- ESLint with strict TypeScript rules
- Prefer errors over warnings (warnings get ignored)

## Testing Approach

Using `tap` for tests.

### Test Categories

1. **Parser tests** - XML parsing, provenance/line numbers
2. **Schema tests** - Zod validation, element() helper, type inference
3. **Reference tests** - Path resolution, version parsing, fragment queries
4. **Round-trip tests** - Parse → serialize → parse produces same result
5. **Integration tests** - Full card loading, cross-card references

### Testing Patterns

**String comparison for state:**
Serialize state to a string and compare to expected. Easy to debug - you see the full output.

```typescript
const result = serializeForTest(parsed)
t.equal(result, `
  tagName: "audience"
  attrs.version: "1.0.0"
  children[0].tagName: "selection-text"
  children[0].text: "Faith community"
  children[0].provenance: 2:3-2:45
`)
```

**Mock filesystem:**
Use the filesystem API abstraction with a memory implementation for tests.

```typescript
const fs = new MemoryFileSystem({
  '/cards/Foo.audience.card': '<audience>...</audience>',
  '/cards/Bar.technique.card': '<technique>...</technique>',
})
const loader = new CardLoader(fs)
```

**Errors:**
Errors should be visible and refinable during development, but don't test exact format. Log/print errors to see them, but assertions focus on error *type* or *presence*, not exact wording.

```typescript
const result = parse(badXml)
t.ok(result.error, 'should have error')
t.match(result.error.type, 'malformed-xml')
// Don't assert exact message text
```

### Fixtures

- `.card` fixture files in `test/fixtures/`
- Both valid cards and intentionally malformed cards
- Real-world examples from actual use cases

## Next Steps

1. Set up project structure (package.json, tsconfig, tap config)
2. Implement basic XML parser with provenance
3. Implement `element()` helper and base schemas
4. Add reference parsing and resolution
5. Build serializer with round-trip tests
