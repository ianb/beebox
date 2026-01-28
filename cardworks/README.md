# Cardworks

A TypeScript library for managing structured XML content with cards, references, versioning, and schema validation.

## Overview

Cardworks provides a complete toolkit for working with XML-based card documents:

- **Parse** XML into a typed object model with source location tracking
- **Validate** content structure using Zod schemas
- **Reference** other cards with versioned links and fragment selectors
- **Serialize** back to XML while preserving formatting and comments
- **Load** cards through a caching loader with cross-reference resolution

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
console.log(card.tagName);        // "recipe"
console.log(card.attrs.version);  // "1.0.0"

// Access children
for (const child of card.children) {
  console.log(child.tagName, child.text);
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

### ElementNode

The `ElementNode` is the core data structure representing a parsed XML element:

```typescript
interface ElementNode {
  tagName: string;                    // Element tag name
  attrs: Record<string, string>;      // Attributes
  text?: string;                      // Text content (dedented)
  textSegments?: TextSegment[];       // For mixed content
  children: ElementNode[];            // Child elements
  comments: {
    start?: string;                   // Comment at start of element
    end?: string;                     // Comment at end of element
  };
  location: Location;                 // Source location
  dirty: boolean;                     // Modified since parse?
}
```

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
    console.log(e.message);              // "Opening and ending tag mismatch: \"unclosed\" != \"broken\""
    console.log(e.location.source);      // "test.card"
    console.log(e.location.startLine);   // 1
    console.log(e.location.startColumn); // 9
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
  attrs: {
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
  },
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

### Validating Cards

```typescript
const card = await parseXml(recipeXml, "Recipe.card");

const result = RecipeSchema.safeParse(card);

if (result.success) {
  // TypeScript knows the shape of result.data
  const recipe = result.data;
  console.log(recipe.attrs.version);
} else {
  console.error("Validation failed:", result.error);
}
```

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
- **fragment** - Optional fragment (`#section` or `#query(//xpath)`)

### Examples

```
./Pasta.ingredient.card              # Relative path
./Pasta.ingredient.card@1.0.0        # With version
./Pasta.ingredient.card#nutrition    # With fragment (by id)
/cards/Butter.ingredient.card        # Absolute (from project root)
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
import { parseXml, serialize } from "cardworks";

const card = await parseXml(xml, "test.card");

// Modify the card
card.children[0].text = "Updated Title";
card.dirty = true;

// Serialize back to XML
const output = serialize(card);
console.log(output);
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

The `CardLoader` provides high-level card management with caching.

### Creating a Loader

```typescript
import { CardLoader } from "cardworks";

const loader = new CardLoader("/path/to/project");
```

### Loading Cards

```typescript
// Cards are cached automatically
const recipe = await loader.load("/project/cards/Recipe.card");

// Second load returns cached version
const same = await loader.load("/project/cards/Recipe.card");
```

### Saving Cards

```typescript
// Modify a card
recipe.children[0].text = "New Title";

// Save it back
await loader.save("/project/cards/Recipe.card", recipe);
```

### Cache Management

```typescript
// Clear entire cache
loader.clearCache();

// Invalidate specific file
loader.invalidate("/project/cards/Recipe.card");
```

### Checking Existence

```typescript
if (await loader.exists("/project/cards/Recipe.card")) {
  const card = await loader.load("/project/cards/Recipe.card");
}
```

---

## Testing with MemoryCardLoader

For testing, use `MemoryCardLoader` which stores files in memory:

```typescript
import { MemoryCardLoader } from "cardworks";

const loader = new MemoryCardLoader("/project", {
  "/project/cards/Recipe.card": `<recipe version="1.0.0">
    <title>Test Recipe</title>
  </recipe>`,
  "/project/cards/Ingredient.card": `<ingredient version="1.0.0">
    <name>Butter</name>
  </ingredient>`,
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
| `resolveRef(ref, resolver)` | Resolve reference to target |

### CardLoader

| Method | Description |
|--------|-------------|
| `load(path)` | Load and cache a card |
| `save(path, card)` | Save card to file |
| `resolveRef(ref, fromPath)` | Resolve reference from context |
| `exists(path)` | Check if card file exists |
| `clearCache()` | Clear all cached cards |
| `invalidate(path)` | Remove specific card from cache |

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
