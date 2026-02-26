# Card View Plugin System

Design for a generic card rendering system in `cb serve`, replacing the current one-off news brief pages with a pluggable architecture.

## Goals

1. Any file can have multiple renderers; the system selects the best default and lets the user toggle between them
2. Directory browsing groups cards by type, showing each group with its type-specific list renderer
3. A generic validated-patch endpoint handles card mutations without per-type API routes
4. The news brief view migrates into this system rather than living as a special case

## Current State

- `CardView` renders all cards with either a tree view (`CardTreeView`) or raw XML
- News briefs have a completely separate path: dedicated `/news/*` route, custom API endpoints (`/api/briefs`, `/api/brief/:path`, `/api/brief/mark-read`, `/api/brief/feedback`, `/api/brief/complete-reading`), and a custom `NewsBriefView` component
- No directory browsing exists — the dashboard shows hardcoded sections (inbox, questions, commands)
- No generic card mutation endpoint — each mutation is a bespoke route

## Architecture

### Renderer Stack

Every file has a stack of applicable renderers, from most generic to most specific. The system picks the best one by default but lets the user toggle between them.

**Built-in renderers** (always available, based on file type):

| File pattern | Renderer | Description |
|---|---|---|
| `*` | Source | Syntax-highlighted text view |
| `*.card` | Card Tree | Structured element tree with Markdown text (current `CardTreeView`) |
| `*.card` | XML | Raw XML with syntax highlighting (current XML mode) |

**Plugin renderers** (registered per card `tagName`):

| tagName | Renderer | Description |
|---|---|---|
| `recipe` | Recipe View | Formatted recipe with scaling controls |
| `news-brief` | Brief View | Interactive reading experience with feedback |
| `bookmark` | _(none — tree view is sufficient)_ | |

The renderer stack for a file is assembled by checking what applies:

```
Pasta_Norma.recipe.card → [Recipe View, Card Tree, XML, Source]
today.news-brief.card   → [Brief View, Card Tree, XML, Source]
notes.memo.card         → [Card Tree, XML, Source]
README.md               → [Source]
recording.webm          → [Audio Player, Source]
```

The first renderer in the list is the default. The user sees toggle buttons to switch.

### Frontend: Renderer Registry

```tsx
// src/frontend/src/renderers/index.ts

/** A renderer that can display a file */
export interface FileRenderer {
  /** Display name shown in the view toggle */
  name: string;
  /** The React component */
  Component: React.ComponentType<RendererProps>;
  /** Priority — higher number = more specific = shown first. Built-ins: source=0, xml=10, tree=20 */
  priority: number;
}

export interface RendererProps {
  /** Full card/file data */
  data: FileData;
  /** Mutate the card (only for .card files with schemas) */
  onPatch?: (ops: PatchOp[]) => Promise<void>;
  /** Navigate to another file */
  onNavigate: (path: string) => void;
}

/** Data returned from the API for any file */
export interface FileData {
  path: string;
  /** For .card files */
  tagName?: string;
  attrs?: Record<string, string>;
  element?: ElementNode;
  xml?: string;
  version?: string;
  /** For non-card files */
  content?: string;
  mimetype?: string;
}
```

Registration:

```tsx
// src/frontend/src/renderers/registry.ts

type RendererMatch = {
  /** Matches file extension or pattern */
  fileMatch?: (path: string, data: FileData) => boolean;
  /** Matches card tagName */
  tagName?: string;
  /** The renderer */
  renderer: FileRenderer;
};

const renderers: RendererMatch[] = [];

/** Register a renderer for a specific card type */
export function registerCardRenderer(tagName: string, renderer: FileRenderer) {
  renderers.push({ tagName, renderer });
}

/** Register a renderer for files matching a predicate */
export function registerFileRenderer(
  match: (path: string, data: FileData) => boolean,
  renderer: FileRenderer,
) {
  renderers.push({ fileMatch: match, renderer });
}

/** Get all applicable renderers for a file, sorted by priority (highest first) */
export function getRenderers(path: string, data: FileData): FileRenderer[] {
  return renderers
    .filter(r => {
      if (r.tagName) return data.tagName === r.tagName;
      if (r.fileMatch) return r.fileMatch(path, data);
      return false;
    })
    .map(r => r.renderer)
    .sort((a, b) => b.priority - a.priority);
}
```

Built-in registrations:

```tsx
// src/frontend/src/renderers/builtins.ts

registerFileRenderer(
  () => true,  // matches everything
  { name: "Source", Component: SourceView, priority: 0 },
);

registerFileRenderer(
  (path) => path.endsWith(".card"),
  { name: "XML", Component: XmlView, priority: 10 },
);

registerFileRenderer(
  (path, data) => path.endsWith(".card") && !!data.element,
  { name: "Card Tree", Component: CardTreeView, priority: 20 },
);

registerFileRenderer(
  (path, data) => /\.(webm|mp3|ogg|wav|m4a|flac)$/.test(path),
  { name: "Audio", Component: AudioPlayer, priority: 30 },
);

// Card-type-specific renderers
registerCardRenderer("recipe",
  { name: "Recipe", Component: RecipeDetailView, priority: 100 },
);

registerCardRenderer("news-brief",
  { name: "Brief", Component: NewsBriefDetailView, priority: 100 },
);
```

### Frontend: FileView Component

Replaces the current `CardView`. Handles any file, assembles the renderer stack, manages view switching:

```tsx
// src/frontend/src/components/FileView.tsx

function FileView({ path }: { path: string }) {
  const { data, loading, error } = useFileData(path);
  const [activeRenderer, setActiveRenderer] = useState<string | null>(null);

  if (loading || error || !data) return <LoadingOrError />;

  const renderers = getRenderers(path, data);
  const current = renderers.find(r => r.name === activeRenderer) ?? renderers[0];

  if (!current) return <div>No renderer available for this file.</div>;

  return (
    <div>
      {/* View toggle — only show if multiple renderers */}
      {renderers.length > 1 && (
        <div className="flex gap-1 mb-4">
          {renderers.map(r => (
            <button
              key={r.name}
              className={`btn btn-sm ${r === current ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setActiveRenderer(r.name)}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}

      <current.Component
        data={data}
        onPatch={data.tagName ? ops => patchCard(path, ops) : undefined}
        onNavigate={p => navigate(`/view/${p}`)}
      />
    </div>
  );
}
```

### Frontend: List Plugins

Separate from renderers. A list plugin controls how a group of cards appears in a directory listing — it receives the full array and returns what to display:

```tsx
// src/frontend/src/card-views/index.ts

export interface CardListPlugin {
  /** Label for the accordion section (e.g., "Recipes", "News Briefs") */
  label: string;
  /** Prepare items for display: sort, filter, truncate, group — whatever is appropriate */
  prepareList: (cards: CardInfo[]) => CardInfo[];
  /** How each card renders in the list */
  ListItem: React.ComponentType<CardListItemProps>;
}

export interface CardListItemProps {
  card: CardInfo;
  onNavigate: (path: string) => void;
  onPatch?: (ops: PatchOp[]) => Promise<void>;
}

export interface CardInfo {
  path: string;
  tagName: string;
  attrs: Record<string, string>;
  summary: Record<string, string>;
}
```

Examples:

```tsx
// Recipe list plugin
export const recipeListPlugin: CardListPlugin = {
  label: "Recipes",
  prepareList: (cards) =>
    [...cards].sort((a, b) =>
      (a.summary.title ?? a.path).localeCompare(b.summary.title ?? b.path)
    ),
  ListItem: RecipeListItem,
};

// News brief list plugin
export const newsBriefListPlugin: CardListPlugin = {
  label: "News Briefs",
  prepareList: (cards) => {
    // Newest first, unread before read
    return [...cards].sort((a, b) => {
      const aRead = !!a.attrs["read-at"];
      const bRead = !!b.attrs["read-at"];
      if (aRead !== bRead) return aRead ? 1 : -1;
      return (b.summary.date ?? "").localeCompare(a.summary.date ?? "");
    });
  },
  ListItem: NewsBriefListItem,
};
```

Registration:

```tsx
const listPlugins = new Map<string, CardListPlugin>();

export function registerListPlugin(tagName: string, plugin: CardListPlugin) {
  listPlugins.set(tagName, plugin);
}

export function getListPlugin(tagName: string): CardListPlugin | undefined {
  return listPlugins.get(tagName);
}
```

### Frontend: Directory Browser

A new route `/browse/*` that lists cards in any directory:

```
/browse/store/recipes/
/browse/box/output/briefs/
/browse/box/inbox/
```

The directory browser:

1. Fetches cards via `GET /api/cards?dir=store/recipes` (new endpoint)
2. Groups cards by `tagName`
3. For each group with a list plugin, renders a collapsible section using the plugin's `ListItem` and `prepareList`
4. Groups without a plugin get a "Files" section with a generic list item
5. Always includes a generic "All Files" section at the bottom
6. Only one section is expanded at a time (accordion)

```tsx
// src/frontend/src/components/DirectoryBrowser.tsx

function DirectoryBrowser({ dir }: { dir: string }) {
  const { cards, subdirs, loading } = useCards(dir);

  // Group by tagName
  const groups = groupBy(cards, c => c.tagName);

  // Separate groups with plugins from those without
  const pluginGroups: [string, CardInfo[], CardListPlugin][] = [];
  const genericCards: CardInfo[] = [];

  for (const [tagName, tagCards] of Object.entries(groups)) {
    const plugin = getListPlugin(tagName);
    if (plugin) {
      pluginGroups.push([tagName, tagCards, plugin]);
    } else {
      genericCards.push(...tagCards);
    }
  }

  return (
    <div>
      {/* Subdirectory links */}
      {subdirs.length > 0 && (
        <div className="flex gap-2 mb-4">
          {subdirs.map(d => (
            <Link key={d} to={`/browse/${d}`} className="btn btn-secondary btn-sm">
              {path.basename(d)}/
            </Link>
          ))}
        </div>
      )}

      <Accordion>
        {/* Plugin-rendered sections */}
        {pluginGroups.map(([tagName, tagCards, plugin]) => {
          const prepared = plugin.prepareList(tagCards);
          return (
            <AccordionSection
              key={tagName}
              title={`${plugin.label} (${tagCards.length})`}
            >
              {prepared.map(card => (
                <plugin.ListItem
                  key={card.path}
                  card={card}
                  onNavigate={navigate}
                  onPatch={ops => patchCard(card.path, ops)}
                />
              ))}
            </AccordionSection>
          );
        })}

        {/* Generic cards without a plugin */}
        {genericCards.length > 0 && (
          <AccordionSection title={`Other Files (${genericCards.length})`}>
            {genericCards.map(card => (
              <GenericListItem key={card.path} card={card} onNavigate={navigate} />
            ))}
          </AccordionSection>
        )}

        {/* Always show all files */}
        <AccordionSection title={`All Files (${cards.length})`}>
          {cards.map(card => (
            <GenericListItem key={card.path} card={card} onNavigate={navigate} />
          ))}
        </AccordionSection>
      </Accordion>
    </div>
  );
}
```

### Backend: Directory Listing Endpoint

```
GET /api/cards?dir=store/recipes&recursive=false
```

Returns:

```json
{
  "dir": "store/recipes",
  "cards": [
    {
      "path": "store/recipes/Pasta_Norma.recipe.card",
      "tagName": "recipe",
      "attrs": {},
      "summary": { "title": "Pasta alla Norma", "yield": "4 servings" }
    }
  ],
  "subdirs": ["store/recipes/italian", "store/recipes/desserts"]
}
```

The `summary` field extracts immediate child element text for listing display without sending the full tree. For a recipe: `{ title: "Pasta alla Norma", yield: "4 servings" }`. For a news brief: `{ title: "...", date: "...", read-at: "..." }`.

Implementation:

```ts
// src/webapp/routes/api.ts

server.get<{ Querystring: { dir: string; recursive?: string } }>(
  "/api/cards",
  async (request) => {
    const dir = request.query.dir;
    const recursive = request.query.recursive === "true";
    const fullDir = path.join(boxRoot, dir);

    const entries = await readdir(fullDir, { withFileTypes: true });
    const cardFiles = entries.filter(e => e.isFile() && e.name.endsWith(".card"));
    const subdirs = entries.filter(e => e.isDirectory()).map(e => path.join(dir, e.name));

    const loader = createLoader(boxRoot);
    const cards = await Promise.all(
      cardFiles.map(async (entry) => {
        const cardPath = path.join(dir, entry.name);
        const card = await loader.load(path.join(boxRoot, cardPath));
        return {
          path: cardPath,
          tagName: card.element.tagName,
          attrs: sanitizeAttrs(card.element.attrs),
          summary: extractSummary(card.element),
        };
      })
    );

    return { dir, cards, subdirs };
  }
);

function extractSummary(element: ElementNode): Record<string, string> {
  const summary: Record<string, string> = {};
  for (const child of element.children ?? []) {
    if (child.text) {
      summary[child.tagName] = child.text.trim();
    }
  }
  return summary;
}
```

### Backend: Generic Card Patch Endpoint

```
PATCH /api/card/store/recipes/Pasta_Norma.recipe.card
Content-Type: application/json

{
  "ops": [
    { "op": "set-attr", "attr": "status", "value": "reviewed" },
    { "op": "set-text", "path": "notes", "value": "Updated notes here" },
    { "op": "set-attr", "path": "yield", "attr": "amount", "value": "8" }
  ],
  "commit": true,
  "commitMessage": "Update recipe notes"
}
```

Patch operations:

```ts
type PatchOp =
  | { op: "set-attr"; path?: string; attr: string; value: string }
  | { op: "remove-attr"; path?: string; attr: string }
  | { op: "set-text"; path: string; value: string }
  | { op: "append-child"; path?: string; xml: string }
  | { op: "remove-child"; path: string; index: number };
```

The `path` field is a simple slash-separated tag path from the root element, e.g., `"section/ingredients"` or just `"notes"` for a direct child. For the root element, `path` is omitted or empty. When multiple children share a tag name, use `tag[index]` syntax: `"section[1]/ingredients"`.

Implementation:

```ts
// src/webapp/routes/api.ts

server.patch<{ Params: { "*": string } }>(
  "/api/card/*",
  async (request, reply) => {
    const cardPath = request.params["*"];
    const fullPath = path.join(boxRoot, cardPath);
    const { ops, commit: shouldCommit, commitMessage } = request.body as PatchRequest;

    const loader = createLoader(boxRoot);
    const card = await loader.load(fullPath);

    // Apply operations
    for (const op of ops) {
      applyOp(card.element, op);
    }

    // Validate against schema
    const registry = createSchemaRegistry();
    const schema = registry.getSchema(card.element.tagName);
    if (schema) {
      const result = schema.safeParse(card.element);
      if (!result.success) {
        return reply.status(400).send({
          error: "Validation failed after applying patch",
          issues: result.error.issues,
        });
      }
    }

    // Save
    const xml = loader.serialize(card.element);
    await writeFile(fullPath, xml);

    // Optionally commit
    if (shouldCommit) {
      await stageFiles(boxRoot, [cardPath]);
      await commit(boxRoot, {
        message: commitMessage ?? `Update ${path.basename(cardPath)}`,
      });
    }

    return {
      path: cardPath,
      tagName: card.element.tagName,
      element: sanitizeElement(card.element),
      xml,
    };
  }
);
```

The key safety mechanism: **validate after patching, reject if invalid**. The schema is the gatekeeper. Malformed patches get a 400 with Zod validation errors.

### Path Resolution for Patch Ops

```ts
function resolvePath(root: ElementNode, pathStr?: string): ElementNode {
  if (!pathStr) return root;

  let current = root;
  for (const segment of pathStr.split("/")) {
    const match = segment.match(/^(\w[\w-]*)(?:\[(\d+)\])?$/);
    if (!match) throw new Error(`Invalid path segment: ${segment}`);

    const [, tagName, indexStr] = match;
    const index = indexStr ? parseInt(indexStr) : 0;

    const children = (current.children ?? []).filter(c => c.tagName === tagName);
    if (index >= children.length) {
      throw new Error(`No child ${tagName}[${index}] found`);
    }
    current = children[index];
  }
  return current;
}
```

## Example Plugins

### Recipe Plugin

```tsx
// src/frontend/src/renderers/recipe.tsx

// --- List plugin ---

export const recipeListPlugin: CardListPlugin = {
  label: "Recipes",
  prepareList: (cards) =>
    [...cards].sort((a, b) =>
      (a.summary.title ?? a.path).localeCompare(b.summary.title ?? b.path)
    ),
  ListItem: RecipeListItem,
};

function RecipeListItem({ card, onNavigate }: CardListItemProps) {
  const { title, yield: yieldText } = card.summary ?? {};

  return (
    <div className="card cursor-pointer" onClick={() => onNavigate(`/view/${card.path}`)}>
      <div className="flex justify-between items-center">
        <h3 className="font-medium">{title ?? card.path}</h3>
        {yieldText && (
          <span className="status-badge bg-blue-100 text-blue-800">{yieldText}</span>
        )}
      </div>
    </div>
  );
}

// --- Detail renderer (priority 100, above Card Tree at 20) ---

function RecipeDetailView({ data }: RendererProps) {
  const [scale, setScale] = useState(1);
  const recipe = parseRecipeElement(data.element!);

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-2">{recipe.title}</h1>
      {recipe.description && (
        <p className="text-gray-600 mb-4">{recipe.description}</p>
      )}

      {recipe.source && (
        <p className="text-sm text-gray-400 mb-4">Source: {recipe.source}</p>
      )}

      {/* Scaling controls */}
      <div className="flex items-center gap-2 mb-6">
        <span className="text-sm text-gray-500">Scale:</span>
        {[0.5, 1, 2, 3].map(s => (
          <button
            key={s}
            className={`btn btn-sm ${scale === s ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setScale(s)}
          >
            {s}x
          </button>
        ))}
        <span className="text-sm text-gray-500 ml-2">
          ({recipe.yieldText} → {scaleYield(recipe.yieldAmount, scale)})
        </span>
      </div>

      {/* Sections */}
      {recipe.sections.map((section, i) => (
        <RecipeSectionView key={i} section={section} scale={scale} />
      ))}

      {recipe.notes && (
        <div className="mt-6 p-4 bg-amber-50 rounded-lg">
          <h3 className="font-medium text-amber-800 mb-1">Notes</h3>
          <ReactMarkdown>{recipe.notes}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

function RecipeSectionView({ section, scale }: { section: RecipeSection; scale: number }) {
  return (
    <div className="mb-6">
      {section.name && <h2 className="text-lg font-semibold mb-3">{section.name}</h2>}

      {/* Ingredients */}
      <div className="mb-4">
        <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">
          Ingredients
        </h3>
        <ul className="space-y-1">
          {section.ingredients.map((ing, i) => (
            <li key={i} className="flex gap-2">
              {ing.amount != null && (
                <span className="font-medium w-20 text-right">
                  {formatAmount(ing.amount * scale)} {ing.unit}
                </span>
              )}
              <span>{ing.name}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Steps */}
      <div>
        <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">
          Steps
        </h3>
        <ol className="list-decimal list-inside space-y-2">
          {section.steps.map((step, i) => (
            <li key={i} className="leading-relaxed">
              <ReactMarkdown className="inline">
                {renderIngredientRefs(step)}
              </ReactMarkdown>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** Parse @{ingredient}{quantity} references into markdown bold */
function renderIngredientRefs(text: string): string {
  return text
    .replace(/@\{([^}]+)\}\{([^}]+)\}/g, "**$1** ($2)")
    .replace(/@\{([^}]+)\}/g, "**$1**")
    .replace(/@(\w+)/g, "**$1**");
}

/** Format scaled amounts nicely (avoid "1.9999999" etc) */
function formatAmount(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const quarters = Math.round(n * 4) / 4;
  const frac = quarters % 1;
  const whole = Math.floor(quarters);
  const fractions: Record<number, string> = { 0.25: "¼", 0.5: "½", 0.75: "¾" };
  if (frac in fractions) {
    return whole > 0 ? `${whole} ${fractions[frac]}` : fractions[frac]!;
  }
  return quarters.toFixed(1);
}

// --- Element parser ---

interface ParsedRecipe {
  title: string;
  description?: string;
  source?: string;
  yieldAmount: number;
  yieldText: string;
  notes?: string;
  tags: string[];
  sections: RecipeSection[];
}

interface RecipeSection {
  name?: string;
  notes?: string;
  ingredients: ParsedIngredient[];
  steps: string[];
}

interface ParsedIngredient {
  name: string;
  amount?: number;
  unit?: string;
}

function parseRecipeElement(el: ElementNode): ParsedRecipe {
  const children = el.children ?? [];
  const text = (tag: string) => children.find(c => c.tagName === tag)?.text?.trim();
  const yieldEl = children.find(c => c.tagName === "yield");
  const tagsEl = children.find(c => c.tagName === "tags");
  const sectionEls = children.filter(c => c.tagName === "section");

  return {
    title: text("title") ?? "Untitled",
    description: text("description"),
    source: text("source"),
    yieldAmount: yieldEl ? parseFloat(yieldEl.attrs.amount ?? "1") : 1,
    yieldText: yieldEl?.text?.trim() ?? "",
    notes: text("notes"),
    tags: (tagsEl?.children ?? []).map(c => c.text?.trim() ?? "").filter(Boolean),
    sections: sectionEls.map(parseSection),
  };
}

function parseSection(el: ElementNode): RecipeSection {
  const children = el.children ?? [];
  const ingsEl = children.find(c => c.tagName === "ingredients");
  const stepsEl = children.find(c => c.tagName === "steps");
  const notesEl = children.find(c => c.tagName === "notes");

  return {
    name: el.attrs.name,
    notes: notesEl?.text?.trim(),
    ingredients: (ingsEl?.children ?? []).map(ing => ({
      name: ing.text?.trim() ?? "",
      amount: ing.attrs.amount ? parseFloat(ing.attrs.amount) : undefined,
      unit: ing.attrs.unit,
    })),
    steps: (stepsEl?.children ?? []).map(s => s.text?.trim() ?? ""),
  };
}

function scaleYield(base: number, scale: number): string {
  const scaled = base * scale;
  return `${formatAmount(scaled)} servings`;
}
```

### News Brief Plugin (migration sketch)

```tsx
// src/frontend/src/renderers/news-brief.tsx

// --- List plugin ---

export const newsBriefListPlugin: CardListPlugin = {
  label: "News Briefs",
  prepareList: (cards) => {
    // Unread first, then newest first within each group
    return [...cards].sort((a, b) => {
      const aRead = !!a.attrs["read-at"];
      const bRead = !!b.attrs["read-at"];
      if (aRead !== bRead) return aRead ? 1 : -1;
      return (b.summary.date ?? "").localeCompare(a.summary.date ?? "");
    });
  },
  ListItem: NewsBriefListItem,
};

function NewsBriefListItem({ card, onNavigate, onPatch }: CardListItemProps) {
  const isRead = !!card.attrs?.["read-at"];
  return (
    <div
      className={`card cursor-pointer ${isRead ? "opacity-60" : ""}`}
      onClick={() => onNavigate(`/view/${card.path}`)}
    >
      <div className="flex justify-between items-center">
        <h3 className={`font-medium ${isRead ? "text-gray-500" : ""}`}>
          {card.summary?.title ?? card.path}
        </h3>
        <div className="flex gap-2">
          {card.summary?.date && (
            <span className="text-sm text-gray-400">{card.summary.date}</span>
          )}
          {isRead && <span className="status-badge bg-gray-100 text-gray-500">Read</span>}
        </div>
      </div>
    </div>
  );
}

// --- Detail renderer ---

function NewsBriefDetailView({ data, onPatch, onNavigate }: RendererProps) {
  // Parse into the existing NewsBriefData structure
  const briefData = parseNewsBrief(data.element!);

  // The existing NewsBriefView component handles all the rendering,
  // but its callbacks need to be rewired to use onPatch instead of
  // bespoke API endpoints.
  return (
    <NewsBriefView
      brief={briefData}
      onCompleteReading={async (readingData) => {
        await onPatch?.([
          { op: "set-attr", attr: "read-at", value: new Date().toISOString() },
          { op: "set-attr", attr: "read-reason", value: "user" },
          { op: "set-attr", attr: "overall-rating", value: readingData.overallRating },
          // ... map reactions and item feedback to patch ops
        ]);
        // Card move is separate — see Card Move Endpoint below
      }}
      onSourceClick={(sourcePath) => onNavigate(sourcePath)}
      // ... other callbacks similarly adapted
    />
  );
}
```

The news brief migration is the biggest test of the system. If the generic patch endpoint can handle the `complete-reading` flow (which sets attrs on nested elements, moves the card, and commits), then it validates the architecture. The card move needs a separate `POST /api/card/*/move` endpoint since that's not a patch — it's a lifecycle transition.

### Bookmark Plugin (simple example)

```tsx
export const bookmarkListPlugin: CardListPlugin = {
  label: "Bookmarks",
  prepareList: (cards) =>
    [...cards].sort((a, b) =>
      (b.summary.updated ?? b.summary.created ?? "").localeCompare(
        a.summary.updated ?? a.summary.created ?? ""
      )
    ),
  ListItem: BookmarkListItem,
};

function BookmarkListItem({ card, onNavigate }: CardListItemProps) {
  const { title, link } = card.summary ?? {};
  return (
    <div className="card flex justify-between items-center">
      <div>
        <h3 className="font-medium">{title ?? card.path}</h3>
        {link && (
          <a href={link} target="_blank" className="text-sm text-blue-500 hover:underline">
            {new URL(link).hostname}
          </a>
        )}
      </div>
      <button
        className="btn btn-secondary btn-sm"
        onClick={() => onNavigate(`/view/${card.path}`)}
      >
        View
      </button>
    </div>
  );
}

// No detail renderer registered — Card Tree view is fine for bookmarks.
// The user can still toggle to XML or Source if they want.
```

## Sidebar Navigation

The current dashboard has hardcoded sections. With directory browsing, the sidebar becomes a tree of directories with card counts:

```
Dashboard
box/
  inbox/ (3)
  questions/ (1)
  commands/ (0)
  output/
    briefs/ (5)
store/
  recipes/ (12)
    italian/ (4)
    desserts/ (3)
  archive/ (47)
```

Clicking a directory shows the directory browser. Clicking a card navigates to the detail view. This naturally replaces the current `/news/*` route — it's just `/browse/box/output/briefs/`.

## Card Move Endpoint

Separate from patch, since moving a card is a lifecycle action (changes directory, updates references, commits):

```
POST /api/card/box/output/briefs/today.news-brief.card/move
{ "destination": "store/archive/briefs/today.news-brief.card", "commit": true }
```

This wraps the existing `cb mv` logic (loader.move + reference updates + git commit).

## Implementation Order

1. **Renderer registry + FileView component** — The core abstraction. Register built-in renderers (Source, XML, Card Tree). Wire into the existing `/card/*` route.
2. **Recipe detail renderer** — First plugin. Read-only display with scaling. Good test that the renderer stack and priority system work.
3. **Generic card patch endpoint** — `PATCH /api/card/*` with schema validation. Unblocks renderers that need to mutate cards.
4. **Directory listing endpoint** — `GET /api/cards?dir=...`. Returns card summaries.
5. **List plugin registry + Directory browser** — The accordion-style grouped listing with `prepareList` and plugin list items.
6. **Sidebar navigation** — Replace hardcoded dashboard sections with directory tree.
7. **News brief migration** — Move NewsBriefView into the plugin system. Biggest test: mutations, card moves, feedback creation.
8. **Card move endpoint** — Needed for news brief's "mark as read and archive" flow.

Steps 1-2 can land immediately with no backend changes. Steps 3-4 are backend additions. Steps 5-6 restructure the app navigation. Steps 7-8 are the migration that proves the system works.
