/**
 * Generate the views reference documentation for agents.
 *
 * Called by generate-docs.ts to produce docs/generated/views.md.
 */

import { dependenciesAndParamsSection } from "./views-doc-files.js";

const introSection = `# Views: Agent-Generated React Components

Views are \`.tsx\` files in the \`views/\` directory at the box root. They get compiled server-side and rendered in the browser — either as standalone pages or embedded in chat messages.

## When to Create a View

Create a view when:
- The user asks to **see** data in a specific way (dashboard, summary, chart, timeline)
- A collection of cards would benefit from a structured visual layout
- You want to present data interactively (filtering, sorting, expanding details)
- The user asks for a "page" or "dashboard" for something

Don't create a view for:
- Simple one-off answers (just reply in chat)
- Static text that doesn't change (use a card or document)
- Something that requires server-side processing (use a job instead)`;

const fileFormatSection = `## File Format

Each view is a \`.tsx\` file with named exports for metadata and a default export for the component:

\`\`\`tsx
export const name = "Ledger Overview";
export const description = "Summary of ledger assets and their status";
export const dependencies = ["store/archive/**/*.record.card", "store/archive/**/*.memo.card"];
export const modes = ["page", "chat"];

export default function EstateOverview({ cards, navigate, boxSlug, params }) {
  const viewPath = params.path || "/";
  // Use viewPath to scope what the view shows
  const records = cards.filter(c => c.tagName === "record");
  const memos = cards.filter(c => c.tagName === "memo");

  return (
    <div>
      <h2>Ledger Overview</h2>
      <p>{records.length} records, {memos.length} memos</p>
      <ul>
        {records.map(card => (
          <li key={card.path}>
            <strong>{card.attrs.title || card.path}</strong>
            {card.status && <span> — {card.status}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
\`\`\``;

const metadataAndPropsSection = `## Metadata Exports

| Export | Type | Required | Description |
|--------|------|----------|-------------|
| \`name\` | string | Yes | Human-readable name shown in UI |
| \`description\` | string | Yes | What this view shows |
| \`dependencies\` | string[] | Yes | Glob patterns for files that affect rendering |
| \`modes\` | string[] | Yes | Where the view can appear: \`"page"\`, \`"chat"\`, or both |
| \`rendersCardTypes\` | string[] | No | Card types this view renders — see below |

### Rendering a card type

A view that exports \`rendersCardTypes\` becomes the **default renderer for
those card types everywhere cards display** — the card page
(\`/card/<path>\`), chat embeds, and peeks. This is how a custom card type
(e.g. a box-local schema) gets a custom UI without touching the app:

\`\`\`tsx
export const name = "Sandbox";
export const description = "Interactive sandbox card UI";
export const dependencies = ["**/*.sandbox.card"];
export const modes = ["page", "chat"];
export const rendersCardTypes = ["sandbox"];

export default function Sandbox({ cards, params }) {
  const card = cards.find((c) => c.path === params.path);
  // params.path is the card being displayed; dependencies must cover the
  // type so the card arrives in \`cards\`.
  ...
}
\`\`\`

The built-in renderers (Source, Card Tree, ...) stay available through the
renderer toggle. One view per type: if several views claim the same card
type, the first by slug order wins. Without \`rendersCardTypes\`, custom
types fall back to the generic built-ins.

## Component Props

The default export receives a \`ViewProps\` object:

| Prop | Type | Description |
|------|------|-------------|
| \`cards\` | ViewCard[] | All cards matching the dependency globs |
| \`files\` | ViewFile[] | Metadata for non-card files matching the globs: \`{path, size, mtimeMs}\` |
| \`readFile\` | (path, opts?) => Promise<string> | Fetch a file's text; \`{start, end}\` byte range, negative start = tail |
| \`fileUrl\` | (path) => string | URL for a box file — \`<img src>\`, \`<audio src>\`, download links |
| \`writeFile\` | (path, {content, expect?}) => Promise<ViewFile> | Create/overwrite (parents made); returns the new ViewFile; never commits |
| \`appendFile\` | (path, {content, expect?}) => Promise<ViewFile> | Append (creates when missing); same semantics |
| \`commitFile\` | (path, message) => Promise<{committed, hash?}> | Commit the file + its attachments, nothing else |
| \`adapterFetch\` | (adapter, {path, ...init}) => Promise<Response> | Call an external API with the box's key injected server-side |
| \`navigate\` | (path: string) => void | Navigate within the box (e.g., \`navigate("chat")\`) |
| \`boxSlug\` | string | The current box slug |
| \`params\` | Record<string, string> | Query parameters from the URL (e.g., \`params.path\`) |
| \`reportActivity\` | (kind, detail?) => void | When open in the chat companion pane, tell the agent the user touched this card. Writes auto-report \`"modified"\`; call \`reportActivity("explored", detail)\` when the user changes the view's *parameters* (filters, ranges, a selected tab) without changing data. The optional \`detail\` is a short free-text string surfaced to the agent as \`card-state\` (e.g. the query the user typed and its top result) — it overwrites any prior detail for the same kind, so calling it on every keystroke is fine. A no-op for inline/page renders, so always safe to call. |

### ViewCard Structure

Each card in the \`cards\` array has:

\`\`\`typescript
{
  path: string;        // Relative path (e.g., "store/archive/Foo.record.card")
  tagName: string;     // Root element name (e.g., "record", "memo")
  attrs: Record<string, string>;  // All attributes on the root element
  text?: string;       // Text content of the root element (if leaf node)
  status?: string;     // Shortcut for attrs.status
  children?: ViewCardChild[];     // Child elements (recursive)
  attachments?: ViewFile[];       // Deep listing of the card's attach scope
}
\`\`\`

Child elements have the same shape: \`{ tagName, attrs, text?, children? }\`.

\`attachments\` is how a view discovers what lives next to a card — every file
in the card's attach scope, recursively, as \`{path, size, mtimeMs}\` with
box-relative paths (e.g.
\`store/playground/Playground.attach/sessions/history.jsonl\`). Content is
never inlined — attachments can be huge or binary — fetch it with
\`readFile(path)\` or point an \`<img>\`/\`<audio>\` at \`fileUrl(path)\`.`;

const showingFilesSection = `## Showing Files in Chat

To show a file to the user, use a \`view:\` link with the file path:

\`\`\`
[Meeting Notes](view:store/notes/meeting.md)
[Recipe](view:store/archive/Pasta.recipe.card)
\`\`\`

The system automatically picks the right viewer based on file type:
- \`.md\` files render as formatted Markdown
- \`.card\` files use the card viewer (card-type-specific renderers if available, generic tree view otherwise)
- Directories show a listing of subdirectories and cards
- Other files show as raw text

To open as a companion panel alongside chat, add \`?zoom\`:
\`\`\`
[Meeting Notes](view:store/notes/meeting.md?zoom)
\`\`\`

To force a specific viewer, use \`?view=\`:
\`\`\`
[Raw XML](view:store/archive/Pasta.recipe.card?view=raw)
\`\`\`

Directory paths work too:
\`\`\`
[Catalog](view:store/catalogs/My_Catalog)
\`\`\`

**Note:** \`view:\` links are for file and directory paths only. Do not use them for custom view slugs.`;

const companionViewsSection = `### Inline vs Companion Views

There are two ways views appear in chat:

**Inline (default)** — the view renders inside the chat message, scrolls with the conversation:
\`\`\`
[Meeting Notes](view:store/notes/meeting.md)
\`\`\`

**Companion panel** — adding \`?zoom\` opens the view as a persistent side panel alongside the chat:
\`\`\`
[Meeting Notes](view:store/notes/meeting.md?zoom)
\`\`\`

The companion panel:
- Stays visible while the user continues chatting (sticky — doesn't scroll away)
- Shows side-by-side with chat on desktop, stacked on mobile
- Has a close button — the user dismisses it when done
- Updates live when underlying files change (same SSE mechanism as inline views)
- If the agent writes another zoom link and the user clicks it, it replaces the current companion

Use inline views for quick, one-off data displays within a conversation turn. Use companion views when the user needs to reference the view while continuing to talk — collaborative editing, storybuilding, reviewing a document, exploring data.

### How the Agent Knows a Companion View is Open

When a companion view is open, every user message includes a \`zoomed-view\` attribute:
\`\`\`xml
<typed zoomed-view="view:ledger-overview?path=/">What about the furniture?</typed>
\`\`\`

This tells the agent what the user is looking at, so it can tailor its responses. The attribute value is the full view URI (without \`&zoom\`).

The per-turn \`<chat-app>\` snapshot also carries this as the read-only \`open-card\` attribute (box-relative path) alongside \`card-activity\` — a low-confidence hint of what the user did to the card since the agent's last reply (\`scrolled\`/\`navigated\`/\`explored\`/\`modified\`) — and \`card-state\`, the optional free-text detail a view attaches via \`reportActivity(kind, detail)\` (e.g. the query typed). A view contributes the \`explored\` signal by calling \`reportActivity("explored", detail)\` when the user changes its parameters; writes contribute \`modified\` automatically. For the precise change set, the agent runs \`cb chat whats-changed --card <path>\`.

**Note:** Companion views are a chat-only feature. The \`&zoom\` parameter and \`zoomed-view\` attribute are only meaningful in the chat frontend — other agent contexts (jobs, wakeup) don't support them.`;

const reportingActivitySection = `## Reporting Card Activity (\`reportActivity\`)

If your view is meant to be opened beside the chat — a companion view the user pokes at while talking — report what they do, so the chat agent has context. Otherwise the agent sees only the card's *config file*, never the live state the user is looking at. For a static, read-only display there's nothing to report; skip this.

The signal reaches the agent as two read-only snapshot attributes: \`card-activity\` (which of \`scrolled\`/\`navigated\`/\`explored\`/\`modified\` happened) and \`card-state\` (your optional free-text **detail** per kind). \`reportActivity\` is a no-op outside the companion pane, so it's always safe to call.

**What's automatic vs. what you wire:**
- \`modified\` — automatic. A successful \`writeFile\`/\`appendFile\`/\`commitFile\` reports it with the path; don't call it yourself.
- \`scrolled\` — automatic (the pane watches its own scroll).
- \`explored\` — **you call it.** This is the important one: fire it when the user changes what the view is *showing* without changing data — the query they typed, a filter, a selected tab, a slider — and pass a detail describing the new state.
- \`navigated\` — automatic when a link inside the view opens another card.

**How to write the detail.** Report \`explored\` from your *primary* inputs, not every control. The detail is a short, human-legible line of what the user is now looking at — the input plus the salient result — because that exact string is what the agent reads as \`card-state\`. Keep it terse (a hint, not a dump): \`boat-water+road → boats (0.568)\`, not the whole result list.

**Pattern: report from a text input as the user types.** Reporting on every keystroke is fine — details overwrite per kind, so \`b\`,\`bo\`,\`boat\` collapse to the final state; no debounce needed.

\`\`\`tsx
function NearestNeighbors({ reportActivity }) {
  const [query, setQuery] = useState("king");
  const results = useNearest(query); // your computation

  // Tell the chat agent what the user is exploring + the top hit.
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const top = results[0];
    const detail = top ? q + " -> " + top.word + " (" + top.sim.toFixed(3) + ")" : q;
    reportActivity("explored", detail);
  }, [query, results, reportActivity]);

  return <input value={query} onChange={(e) => setQuery(e.target.value)} />;
}
\`\`\`

For a tab or filter, call it in the handler instead: \`onClick={() => { setTab(t); reportActivity("explored", "tab: " + t); }}\`. The agent can always run \`cb chat whats-changed --card <path>\` for the exact, git-grounded change set — \`card-state\` is the cheap live hint, not the source of truth.`;

const examplesSection = `## Examples

### Simple Card List

\`\`\`tsx
export const name = "Todo List";
export const description = "Active todos";
export const dependencies = ["store/todos/**/*.card"];
export const modes = ["page", "chat"];

export default function TodoList({ cards }) {
  const todos = cards.filter(c => c.tagName === "todo-list");
  return (
    <div>
      <h2>Todos</h2>
      {todos.map(card => (
        <div key={card.path} style={{ marginBottom: "1rem" }}>
          <h3>{card.attrs.title}</h3>
          {card.children?.filter(c => c.tagName === "item").map((item, i) => (
            <div key={i} style={{ padding: "0.25rem 0", color: item.attrs.status === "done" ? "#999" : "#000" }}>
              {item.attrs.status === "done" ? "\\u2713" : "\\u25cb"} {item.text}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
\`\`\`

### Filtered Dashboard

\`\`\`tsx
export const name = "Inbox Dashboard";
export const description = "Overview of pending inbox items";
export const dependencies = ["box/inbox/**/*.card"];
export const modes = ["page"];

export default function InboxDashboard({ cards }) {
  const [filter, setFilter] = useState("");

  const filtered = cards.filter(c =>
    !filter || c.tagName.includes(filter) || c.path.includes(filter)
  );

  const byType = {};
  for (const card of filtered) {
    byType[card.tagName] = (byType[card.tagName] || 0) + 1;
  }

  return (
    <div>
      <h2>Inbox ({filtered.length} items)</h2>
      <input
        placeholder="Filter..."
        value={filter}
        onChange={e => setFilter(e.target.value)}
        style={{ padding: "0.5rem", marginBottom: "1rem", width: "100%" }}
      />
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
        {Object.entries(byType).map(([type, count]) => (
          <div key={type} style={{ padding: "0.5rem 1rem", background: "#f0f0f0", borderRadius: "0.5rem" }}>
            <strong>{type}</strong>: {count}
          </div>
        ))}
      </div>
      <ul>
        {filtered.map(card => (
          <li key={card.path}>{card.path} ({card.tagName})</li>
        ))}
      </ul>
    </div>
  );
}
\`\`\``;

const stylingAndErrorsSection = `## Styling

Views render inside the app's existing layout. You can use:
- Inline styles (as shown in examples)
- Standard HTML/CSS
- The app uses Tailwind CSS classes — these are available if you know them, but inline styles are fine

## Error Handling

If your view has a syntax error, the browser shows the compile error instead of crashing. If your view throws at runtime, an error boundary catches it and shows the error with a retry button.`;

export function generateViewsDoc(): string {
  return (
    [
      introSection,
      fileFormatSection,
      metadataAndPropsSection,
      dependenciesAndParamsSection,
      showingFilesSection,
      companionViewsSection,
      reportingActivitySection,
      examplesSection,
      stylingAndErrorsSection,
    ].join("\n\n") + "\n"
  );
}
