# Cardworks

A TypeScript library for managing structured XML content with cards, references, versioning, and schema validation.

## Overview

Cardworks provides a complete toolkit for working with XML-based card documents:

- **Parse** XML into a typed object model with source location tracking
- **Validate** content structure using Zod schemas
- **Reference** other cards with versioned links and fragment selectors
- **Serialize** back to XML while preserving formatting and comments
- **Load** cards through a loader with cross-reference resolution

## Installation

```bash
npm install cardworks
```

## Quick Start

```typescript
import { CardLoader, element } from "cardworks";
import { z } from "zod";

// Create a loader for your project
const loader = new CardLoader("/path/to/project");

// Load a card
const card = await loader.load("/path/to/project/cards/Recipe.card");
console.log(card.path);              // "/path/to/project/cards/Recipe.card"
console.log(card.version);           // "1.0.0"
console.log(card.element.tagName);   // "recipe"

// Access children through the element property
for (const child of card.element.children) {
  console.log(child.tagName, child.text);
}

// Check if the card has been modified
if (card.isDirty()) {
  await loader.save(card);
}
```

## Running Example: A Recipe Book

Throughout this documentation, we'll build a recipe management system. Our cards will include:

- **Recipe cards** - cooking instructions with ingredients and steps
- **Ingredient cards** - detailed information about ingredients
- **Technique cards** - reusable cooking techniques

Here's our first recipe card (`cards/recipes/PastaAlfredo.recipe.card`):

```xml
<recipe version="1.0.0">
  <title>Pasta Alfredo</title>
  <description>A creamy Italian pasta dish</description>

  <ingredients>
    <ingredient ref="./ingredients/Pasta.ingredient.card" amount="400g"/>
    <ingredient ref="./ingredients/Butter.ingredient.card" amount="100g"/>
    <ingredient ref="./ingredients/Parmesan.ingredient.card" amount="150g"/>
  </ingredients>

  <steps>
    <step>Cook pasta according to package directions</step>
    <step technique="./techniques/Melt.technique.card">
      Melt butter in a large pan
    </step>
    <step>Toss pasta with butter and cheese</step>
  </steps>
</recipe>
```

---

## Core Concepts

### Card

The `Card` is the top-level abstraction representing a loaded `.card` file:

```typescript
interface Card {
  path: string;                       // File path this card was loaded from
  element: ElementNode;               // The root XML element
  version: string;                    // Version from root element
  loadedAt: Date;                     // When the card was loaded
  getMedia(): Promise<Record<string, string>>;  // Accompanying media files
  isDirty(): boolean;                 // In-memory state differs from disk?
  isStale(): Promise<boolean>;        // Disk file changed since load?
}
```

### ElementNode

The `ElementNode` is the core data structure representing a parsed XML element:

```typescript
interface ElementNode {
  tagName: string;                    // Element tag name
  attrs: Record<string, string>;      // Attributes
  text?: string;                      // Text content (dedented)
  mixed?: MixedContent[];             // Mixed content (raw text, elements, comments)
  children: ElementNode[];            // Child elements
  comments: {
    start?: string;                   // Comment at start of element
    end?: string;                     // Comment at end of element
  };
  location: Location;                 // Source location
  dirty: boolean;                     // Modified since parse?
}

// MixedContent is: string | ElementNode | { comment: string }
```

Each ElementNode has a non-enumerable `card` property that references back to its containing Card.

### Location

Every node tracks its source location for error reporting:

```typescript
interface Location {
  source: string;      // File path or identifier
  startLine: number;   // 1-based line number
  startColumn: number; // 1-based column
  endLine: number;
  endColumn: number;
}
```

---

## Parsing XML

### Basic Parsing

```typescript
import { parseXml } from "cardworks";

const xml = `<recipe version="1.0.0">
  <title>Pasta Alfredo</title>
  <description>A creamy Italian pasta dish</description>
</recipe>`;

const card = await parseXml(xml, "PastaAlfredo.recipe.card");

console.log(card.tagName);           // "recipe"
console.log(card.attrs.version);     // "1.0.0"
console.log(card.children[0].text);  // "Pasta Alfredo"
```

### Version Requirement

Every card's root element must have a `version` attribute in semantic version format (X.Y.Z):

```xml
<recipe version="1.0.0">  <!-- Valid -->
<recipe version="2.1.0">  <!-- Valid -->
<recipe version="1.0">    <!-- Error: must be X.Y.Z -->
<recipe>                  <!-- Error: version required -->
```

The version enables staleness detection when cards reference each other.

### Text Dedenting

Cardworks automatically dedents text content, removing common leading whitespace:

```typescript
const xml = `<step>
    First, bring water to a boil.
    Then add salt generously.
    Finally, add the pasta.
  </step>`;

const node = await parseXml(xml, "test");
console.log(node.text);
// Output:
// First, bring water to a boil.
// Then add salt generously.
// Finally, add the pasta.
```

### Mixed Content

When an element contains interleaved text, child elements, or comments, the `mixed` property contains the raw sequence:

```typescript
const xml = `<p version="1.0.0">Some text <b>bold</b> more <!-- note --> text</p>`;

const node = await parseXml(xml, "test");

console.log(node.mixed);
// [
//   "Some text ",
//   { tagName: "b", text: "bold", ... },
//   " more ",
//   { comment: "note" },
//   " text"
// ]

// Children are also available separately
console.log(node.children[0].tagName);  // "b"
```

Mixed content preserves raw whitespace (no dedenting) to maintain exact formatting. Comments appear as `{ comment: string }` objects.

### Comment Preservation

XML comments are captured and associated with adjacent elements:

```typescript
const xml = `<recipe version="1.0.0">
  <!-- This is the main title -->
  <title>Pasta Alfredo</title>
  <!-- Author's note: adjust salt to taste -->
</recipe>`;

const card = await parseXml(xml, "test");
const title = card.children[0];

console.log(title.comments.start);  // "This is the main title"
console.log(title.comments.end);    // "Author's note: adjust salt to taste"
```

### Error Handling

Parse errors include source information:

```typescript
import { parseXml, ParseError } from "cardworks";

try {
  await parseXml("<broken><unclosed></broken>", "test.card");
} catch (e) {
  if (e instanceof ParseError) {
    console.log(e.message);
    // "test.card:1:9: Opening and ending tag mismatch: \"unclosed\" != \"broken\""
  }
}
```

---

## Schema Validation

Use Zod schemas to validate card structure with the `element()` helper.

### Defining Schemas

```typescript
import { element } from "cardworks";
import { z } from "zod";

// Define an ingredient reference schema
const IngredientRefSchema = element("ingredient", {
  attrs: {
    ref: z.string(),
    amount: z.string(),
  },
});

// Define a step schema
const StepSchema = element("step", {
  attrs: {
    technique: z.string().optional(),
  },
  text: z.string().min(1),
});

// Define the full recipe schema
const RecipeSchema = element("recipe", {
  children: z.array(
    z.union([
      element("title", { text: z.string() }),
      element("description", { text: z.string() }),
      element("ingredients", {
        children: z.array(IngredientRefSchema),
      }),
      element("steps", {
        children: z.array(StepSchema),
      }),
    ])
  ),
});
```

### Validating Cards on Load

When you pass schemas to a `CardLoader`, cards are validated automatically on load:

```typescript
import { CardLoader, ValidationError } from "cardworks";

// Create loader with schemas
const loader = new CardLoader("/project", {
  schemas: [RecipeSchema, IngredientRefSchema, StepSchema],
});

try {
  // Cards are validated against matching schemas automatically
  const recipe = await loader.load("/project/cards/Recipe.card");
} catch (e) {
  if (e instanceof ValidationError) {
    console.error(`Validation failed for <${e.tagName}>:`, e.zodError);
  }
}
```

Cards are matched to schemas by tag name - a `<recipe>` element is validated against `RecipeSchema` (which was defined with `element("recipe", ...)`). Cards with no matching schema are loaded without validation.

### Type Inference

The `element()` helper provides full TypeScript type inference:

```typescript
// Type is inferred from the schema
type Recipe = z.infer<typeof RecipeSchema>;

// recipe.attrs.version is typed as string
// recipe.children is typed as the union array
```

---

## Reference System

Cards can reference other cards using a structured reference syntax.

### Reference Format

```
path[@version][#fragment]
```

- **path** - Relative (`./Other.card`) or absolute (`/cards/Other.card`)
- **version** - Optional version specifier (`@1.0.0`)
- **fragment** - Optional fragment selector:
  - `#id` - Select element by ID attribute
  - `#query(xpath)` - Select single element via XPath (warns if multiple match)
  - `#query-all(xpath)` - Select multiple elements via XPath

### Examples

```
./Pasta.ingredient.card                  # Relative path
./Pasta.ingredient.card@1.0.0            # With version
./Pasta.ingredient.card#nutrition        # By id attribute
./Recipe.card#query(//step[@id='first']) # XPath for single element
./Recipe.card#query-all(//step)          # XPath for multiple elements
/cards/Butter.ingredient.card            # Absolute (from project root)
```

### Parsing References

```typescript
import { parseRef } from "cardworks";

const ref = parseRef("./Pasta.ingredient.card@1.0.0#nutrition");

console.log(ref.path);           // "./Pasta.ingredient.card"
console.log(ref.version);        // "1.0.0"
console.log(ref.fragment?.type); // "id"
console.log(ref.fragment?.value);// "nutrition"
console.log(ref.isAbsolute);     // false
```

### Resolving References

```typescript
import { CardLoader } from "cardworks";

const loader = new CardLoader("/project");

// From within PastaAlfredo.recipe.card, resolve a reference
const result = await loader.resolveRef(
  "./ingredients/Pasta.ingredient.card@1.0.0",
  "/project/cards/recipes/PastaAlfredo.recipe.card"
);

if (result.exists) {
  console.log(result.resolvedPath);  // Full path to the card
  console.log(result.actualVersion); // Version in the target file

  if (result.versionMismatch) {
    console.warn(
      `Version mismatch: wanted ${result.requestedVersion}, ` +
      `got ${result.actualVersion}`
    );
  }

  if (result.fragment) {
    // Fragment was resolved to an element
    console.log(result.fragment.tagName);
  }
}
```

### XPath Queries

Use `#query(xpath)` to select a single element or `#query-all(xpath)` to select multiple:

```typescript
// Select a single element - warns if multiple match
const result = await loader.resolveRef(
  "./Recipe.card#query(//step[@type='prep'])",
  currentPath
);

if (result.fragment) {
  console.log(result.fragment.text);  // The matched element
}

if (result.fragmentWarning) {
  // e.g., "XPath query matched 3 elements, expected 1"
  console.warn(result.fragmentWarning);
}

// Select multiple elements
const allSteps = await loader.resolveRef(
  "./Recipe.card#query-all(//step)",
  currentPath
);

if (allSteps.fragments) {
  for (const step of allSteps.fragments) {
    console.log(step.text);
  }
}

if (allSteps.fragmentWarning) {
  // Warns if no elements matched
  console.warn(allSteps.fragmentWarning);
}
```

XPath queries use the full XPath 1.0 syntax. Common patterns:
- `//element` - All elements with tag name
- `//element[@attr='value']` - Elements with specific attribute
- `/root/child/grandchild` - Absolute path from root
- `//parent/child` - Child elements of matching parents

### Multiple References

Use the `refs` attribute (with an 's') for multiple whitespace-separated references:

```xml
<card version="1.0.0">
  <derived refs="./SourceA.card@1.0.0 ./SourceB.card ./SourceC.card#section"/>
</card>
```

```typescript
// Resolve all refs at once
const results = await loader.resolveRefs(
  "./SourceA.card@1.0.0 ./SourceB.card",
  currentPath
);

for (const result of results) {
  console.log(result.resolvedPath, result.exists);
}
```

### Bidirectional Link Tracking

Find what cards reference a given card ("what links here?"):

```typescript
// Find all cards that reference Recipe.card
const incomingRefs = await loader.findIncomingRefs("/project/cards/Recipe.card");

for (const ref of incomingRefs) {
  console.log(`${ref.fromPath} references via <${ref.elementTagName}>`);
  console.log(`  ref string: ${ref.refString}`);
  console.log(`  attribute: ${ref.attributeName}`);  // "ref" or "refs"
}

// Find all references from a card
const outgoingRefs = await loader.findOutgoingRefs("/project/cards/Recipe.card");

for (const ref of outgoingRefs) {
  console.log(`References ${ref.toPath}`);
}
```

### Recipe Example: Resolving Ingredient References

```typescript
async function loadRecipeWithIngredients(loader: CardLoader, path: string) {
  const recipe = await loader.load(path);

  // Find the ingredients element
  const ingredientsEl = recipe.children.find(c => c.tagName === "ingredients");

  const ingredients = [];
  for (const ing of ingredientsEl?.children ?? []) {
    const ref = ing.attrs.ref;
    if (ref) {
      const resolved = await loader.resolveRef(ref, path);
      if (resolved.exists) {
        const ingredientCard = await loader.load(resolved.resolvedPath);
        ingredients.push({
          amount: ing.attrs.amount,
          name: ingredientCard.children.find(c => c.tagName === "name")?.text,
          card: ingredientCard,
        });
      }
    }
  }

  return { recipe, ingredients };
}
```

---

## Serialization

Convert `ElementNode` trees back to XML strings.

### Basic Serialization

```typescript
import { CardLoader, serialize } from "cardworks";

const loader = new CardLoader("/project");
const card = await loader.load("/project/Recipe.card");

// Modify the card
card.element.children[0].text = "Updated Title";
card.element.dirty = true;

// Check if modified
if (card.isDirty()) {
  // Serialize back to XML
  const output = serialize(card.element);
  console.log(output);

  // Or save directly
  await loader.save(card);
}
```

### Serialization Options

```typescript
const output = serialize(card, {
  indent: "    ",        // 4 spaces (default is 2)
  xmlDeclaration: true,  // Add <?xml version="1.0"?>
});
```

### Round-Trip Preservation

Cardworks preserves structure through parse-serialize cycles:

```typescript
const original = `<recipe version="1.0.0">
  <!-- Main dish -->
  <title>Pasta Alfredo</title>
  <steps>
    <step>Cook pasta</step>
    <step>Add sauce</step>
  </steps>
</recipe>`;

const card = await parseXml(original, "test.card");
const output = serialize(card);

// Comments, nesting, and structure are preserved
// Whitespace is normalized but content is intact
```

---

## CardLoader

The `CardLoader` provides high-level card management.

### Creating a Loader

```typescript
import { CardLoader } from "cardworks";

// Basic loader (no validation)
const loader = new CardLoader("/path/to/project");

// Loader with schema validation
const validatingLoader = new CardLoader("/path/to/project", {
  schemas: [RecipeSchema, IngredientSchema, TechniqueSchema],
});
```

### Loading Cards

```typescript
const card = await loader.load("/project/cards/Recipe.card");
console.log(card.path);     // "/project/cards/Recipe.card"
console.log(card.version);  // "1.0.0"
console.log(card.element.tagName);  // "recipe"
```

### Saving Cards

```typescript
// Modify a card
card.element.children[0].text = "New Title";

// Save to its original path
await loader.save(card);

// Or save to a different path (creates a copy)
const newCard = await loader.saveAs(card, "/project/cards/RecipeCopy.card");
```

### Checking for Changes

```typescript
// Check if in-memory content differs from what was loaded
if (card.isDirty()) {
  await loader.save(card);
}

// Check if file on disk changed since we loaded it
if (await card.isStale()) {
  // Reload to get fresh content
  const fresh = await loader.load(card.path);
}
```

### Accessing Media Files

Cards can have associated media files (same basename, different extensions):

```typescript
const card = await loader.load("/project/cards/Recipe.card");
const media = await card.getMedia();
// media = { png: "/project/cards/Recipe.png", m4a: "/project/cards/Recipe.m4a" }

if (media.png) {
  console.log("Has image:", media.png);
}
```

### Checking Existence

```typescript
if (await loader.exists("/project/cards/Recipe.card")) {
  const card = await loader.load("/project/cards/Recipe.card");
}
```

### Iterating Over All Cards

```typescript
// List all card files in the project
const cardPaths = await loader.listCards();

for (const path of cardPaths) {
  const card = await loader.load(path);
  console.log(card.tagName, path);
}
```

### Moving/Renaming Cards

```typescript
// Load the card to move
const card = await loader.load("/project/cards/OldName.card");

// Move and update all references to it
const { card: movedCard, result } = await loader.move(
  card,
  "/project/cards/NewName.card"
);

console.log("New path:", movedCard.path);  // "/project/cards/NewName.card"
console.log("Moved files:", result.movedFiles);
console.log("Updated references in:", result.updatedCards);
```

The move function:
- Moves the card file and any related files with the same basename (e.g., `Recipe.card`, `Recipe.png`)
- Updates all `ref` and `refs` attributes in other cards that pointed to the old path
- Preserves version and fragment in references
- Returns a new Card with the updated path and a summary of what was changed

---

## Linting

Cardworks provides lint functions to check your cards for errors. This is useful for CI/CD pipelines or editor integrations.

### Creating a Lint Script

```typescript
import { CardLoader, lintAll, formatLintResults } from "cardworks";
import { RecipeSchema, IngredientSchema } from "./schemas.js";

const loader = new CardLoader("/path/to/project", {
  schemas: [RecipeSchema, IngredientSchema],
});

const summary = await lintAll(loader);
console.log(formatLintResults(summary, { basePath: "/path/to/project/" }));

process.exit(summary.totalErrors > 0 ? 1 : 0);
```

### What Gets Checked

- **Parse errors** - Malformed XML syntax
- **Validation errors** - Schema mismatches (for cards with registered schemas)
- **Reference errors** - Broken `ref`/`refs` attributes pointing to non-existent files
- **Fragment errors** - Broken `#id` or `#query()` fragments that don't match any element
- **Reference warnings** - Version mismatches in refs (requested vs actual)
- **Fragment warnings** - Multiple matches for `#query()`, no matches for `#query-all()`
- **ID warnings** - Duplicate `id` attributes within a card

### Lint Functions

```typescript
import { lintCard, lintCards, lintAll } from "cardworks";

// Lint a single card
const result = await lintCard(loader, "/project/Recipe.card");
// Returns: { path, errors: LintIssue[], warnings: LintIssue[] }

// Lint specific cards
const summary = await lintCards(loader, [path1, path2]);

// Lint all cards in the project
const summary = await lintAll(loader);
// Returns: { results, totalErrors, totalWarnings, filesChecked, filesWithErrors }
```

### Formatting Results

```typescript
import { formatLintResults, formatLintResultsJson } from "cardworks";

// Human-readable output with colors
console.log(formatLintResults(summary));

// Customize formatting
console.log(formatLintResults(summary, {
  colors: false,           // Disable ANSI colors
  onlyIssues: true,        // Only show files with problems
  basePath: "/project/",   // Strip prefix from paths
}));

// JSON output (for tooling integration)
console.log(formatLintResultsJson(summary));
```

### Disabling Reference Checks

If you only want to check parsing and validation:

```typescript
const summary = await lintAll(loader, { checkRefs: false });
```

---

## Testing with MemoryCardLoader

For testing, use `MemoryCardLoader` which stores files in memory:

```typescript
import { MemoryCardLoader } from "cardworks";

const loader = new MemoryCardLoader("/project", {
  files: {
    "/project/cards/Recipe.card": `<recipe version="1.0.0">
      <title>Test Recipe</title>
    </recipe>`,
    "/project/cards/Ingredient.card": `<ingredient version="1.0.0">
      <name>Butter</name>
    </ingredient>`,
  },
  // Optional: provide schemas for validation
  schemas: [RecipeSchema],
});

// Use it just like CardLoader
const card = await loader.load("/project/cards/Recipe.card");

// You can also modify files dynamically
loader.setFile("/project/cards/Recipe.card", `<recipe version="1.0.0">
  <title>Updated Recipe</title>
</recipe>`);
```

## Filesystem Abstraction

Cardworks uses a filesystem interface internally. The `CardLoader` and `MemoryCardLoader` handle this automatically, but you can access the underlying filesystem classes directly if needed.

### NodeFileSystem

For direct filesystem access:

```typescript
import { NodeFileSystem } from "cardworks";

const fs = new NodeFileSystem();
const content = await fs.read("/path/to/file.card");
```

### MemoryFileSystem

For in-memory operations:

```typescript
import { MemoryFileSystem } from "cardworks";

const fs = new MemoryFileSystem({
  "/project/cards/Recipe.card": `<recipe version="1.0.0">
    <title>Test Recipe</title>
  </recipe>`,
});

const content = await fs.read("/project/cards/Recipe.card");
```

### Finding Files with Glob

The filesystem provides a `glob` method for finding files:

```typescript
import { NodeFileSystem } from "cardworks";

const fs = new NodeFileSystem();

// Find all card files
const cards = await fs.glob("/project", "**/*.card");

// Find cards in a specific directory
const recipes = await fs.glob("/project", "recipes/*.card");

// Find all files
const allFiles = await fs.glob("/project", "**/*");
```

Glob patterns:
- `*` - matches any characters except `/`
- `**` - matches any characters including `/`
- `**/` - matches zero or more directories
- `?` - matches a single character

### FileSystem Interface

Implement your own filesystem:

```typescript
import type { FileSystem } from "cardworks";

class MyFileSystem implements FileSystem {
  async read(path: string): Promise<string> { /* ... */ }
  async readBinary(path: string): Promise<Uint8Array> { /* ... */ }
  async write(path: string, content: string): Promise<void> { /* ... */ }
  async exists(path: string): Promise<boolean> { /* ... */ }
  async list(path: string): Promise<string[]> { /* ... */ }
  async glob(basePath: string, pattern: string): Promise<string[]> { /* ... */ }
  async move(from: string, to: string): Promise<void> { /* ... */ }
  resolve(base: string, relative: string): string { /* ... */ }
}
```

---

## Complete Example: Recipe Book Application

Here's a complete example putting it all together:

### Card Files

**`cards/ingredients/Pasta.ingredient.card`**
```xml
<ingredient version="1.0.0">
  <name>Fettuccine Pasta</name>
  <category>pasta</category>
  <nutrition id="nutrition">
    <calories>350</calories>
    <protein>12g</protein>
  </nutrition>
</ingredient>
```

**`cards/techniques/Melt.technique.card`**
```xml
<technique version="1.0.0">
  <name>Melting</name>
  <description>Gently heat until liquified</description>
  <tips>
    <tip>Use low heat to prevent burning</tip>
    <tip>Stir occasionally</tip>
  </tips>
</technique>
```

**`cards/recipes/PastaAlfredo.recipe.card`**
```xml
<recipe version="1.0.0">
  <title>Pasta Alfredo</title>
  <servings>4</servings>

  <ingredients>
    <ingredient ref="./ingredients/Pasta.ingredient.card" amount="400g"/>
    <ingredient ref="./ingredients/Butter.ingredient.card" amount="100g"/>
    <ingredient ref="./ingredients/Parmesan.ingredient.card" amount="150g"/>
  </ingredients>

  <steps>
    <step>Bring a large pot of salted water to boil</step>
    <step technique="../techniques/Melt.technique.card">
      Melt butter in a large pan over low heat
    </step>
    <step>Cook pasta until al dente, reserve 1 cup pasta water</step>
    <step>Toss hot pasta with butter, add cheese gradually</step>
    <step>Add pasta water as needed for silky sauce</step>
  </steps>
</recipe>
```

### Application Code

```typescript
import { CardLoader } from "cardworks";

// Initialize loader
const loader = new CardLoader("/project");

// Load and process a recipe
async function displayRecipe(recipePath: string) {
  const recipe = await loader.load(recipePath);

  // Get basic info
  const title = recipe.children.find(c => c.tagName === "title")?.text;
  const servings = recipe.children.find(c => c.tagName === "servings")?.text;

  console.log(`\n=== ${title} ===`);
  console.log(`Servings: ${servings}\n`);

  // Process ingredients with references
  console.log("Ingredients:");
  const ingredientsEl = recipe.children.find(c => c.tagName === "ingredients");

  for (const ing of ingredientsEl?.children ?? []) {
    const refStr = ing.attrs.ref;
    const amount = ing.attrs.amount;

    if (refStr) {
      const resolved = await loader.resolveRef(refStr, recipePath);

      if (resolved.exists) {
        const ingredientCard = await loader.load(resolved.resolvedPath);
        const name = ingredientCard.children.find(c => c.tagName === "name")?.text;

        // Check for version drift
        if (resolved.versionMismatch) {
          console.log(`  - ${amount} ${name} (WARNING: version mismatch)`);
        } else {
          console.log(`  - ${amount} ${name}`);
        }
      } else {
        console.log(`  - ${amount} [MISSING: ${refStr}]`);
      }
    }
  }

  // Process steps, loading technique references
  console.log("\nSteps:");
  const stepsEl = recipe.children.find(c => c.tagName === "steps");
  let stepNum = 1;

  for (const step of stepsEl?.children ?? []) {
    const techRef = step.attrs.technique;

    if (techRef) {
      const resolved = await loader.resolveRef(techRef, recipePath);
      if (resolved.exists) {
        const technique = await loader.load(resolved.resolvedPath);
        const techName = technique.children.find(c => c.tagName === "name")?.text;
        console.log(`  ${stepNum}. [${techName}] ${step.text}`);
      }
    } else {
      console.log(`  ${stepNum}. ${step.text}`);
    }
    stepNum++;
  }
}

// Run it
displayRecipe("/project/cards/recipes/PastaAlfredo.recipe.card");
```

### Output

```
=== Pasta Alfredo ===
Servings: 4

Ingredients:
  - 400g Fettuccine Pasta
  - 100g Butter
  - 150g Parmesan Cheese

Steps:
  1. Bring a large pot of salted water to boil
  2. [Melting] Melt butter in a large pan over low heat
  3. Cook pasta until al dente, reserve 1 cup pasta water
  4. Toss hot pasta with butter, add cheese gradually
  5. Add pasta water as needed for silky sauce
```

---

## API Reference

### Parsing

| Function | Description |
|----------|-------------|
| `parseXml(xml, source)` | Parse XML string to ElementNode |
| `parseXmlFile(fs, path)` | Parse XML file using filesystem |
| `dedent(text)` | Remove common leading whitespace |

### Schema

| Function | Description |
|----------|-------------|
| `element(tagName, config)` | Create Zod schema for XML element |
| `ElementNodeSchema` | Base schema for any ElementNode |

### Serialization

| Function | Description |
|----------|-------------|
| `serialize(node, options?)` | Convert ElementNode to XML string |

### References

| Function | Description |
|----------|-------------|
| `parseRef(ref)` | Parse reference string to ParsedRef |
| `parseRefs(refs)` | Parse whitespace-separated refs (for `refs` attribute) |
| `resolveRef(ref, resolver)` | Resolve reference to target |
| `resolveRefs(refs, resolver)` | Resolve multiple whitespace-separated refs |

### Card

| Property/Method | Description |
|-----------------|-------------|
| `path` | File path this card was loaded from |
| `element` | Root ElementNode |
| `version` | Version from root element |
| `loadedAt` | When the card was loaded |
| `getMedia()` | Get accompanying media files as `{ ext: path }` |
| `isDirty()` | Check if in-memory content differs from disk |
| `isStale()` | Check if disk file changed since load |

### CardLoader

| Method | Description |
|--------|-------------|
| `load(path)` | Load a card, returns Card |
| `save(card)` | Save card to its file path |
| `saveAs(card, path)` | Save card to new path, returns new Card |
| `resolveRef(ref, fromPath)` | Resolve reference from context |
| `resolveRefs(refs, fromPath)` | Resolve multiple whitespace-separated refs |
| `exists(path)` | Check if card file exists |
| `move(card, toPath)` | Move/rename card and update refs, returns new Card |
| `listCards()` | List all card files in project |
| `findIncomingRefs(path)` | Find all cards that reference this card |
| `findOutgoingRefs(path)` | Find all references from this card |

### Linting

| Function | Description |
|----------|-------------|
| `lintCard(loader, path, options?)` | Lint a single card |
| `lintCards(loader, paths, options?)` | Lint specific cards |
| `lintAll(loader, options?)` | Lint all cards in project |
| `formatLintResults(summary, options?)` | Format results for display |
| `formatLintResultsJson(summary)` | Format results as JSON |

### Loaders

| Class | Description |
|-------|-------------|
| `CardLoader` | File-based card loader for production use |
| `MemoryCardLoader` | In-memory card loader for testing |

### Filesystem

| Class | Description |
|-------|-------------|
| `NodeFileSystem` | Node.js filesystem implementation |
| `MemoryFileSystem` | In-memory filesystem for testing |

---

## License

MIT
