/**
 * Generate the views reference documentation for agents.
 *
 * Called by generate-docs.ts to produce docs/generated/views.md.
 */

export function generateViewsDoc(): string {
  return `# Views: Agent-Generated React Components

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
- Something that requires server-side processing (use a job instead)

## File Format

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
\`\`\`

## Metadata Exports

| Export | Type | Required | Description |
|--------|------|----------|-------------|
| \`name\` | string | Yes | Human-readable name shown in UI |
| \`description\` | string | Yes | What this view shows |
| \`dependencies\` | string[] | Yes | Glob patterns for files that affect rendering |
| \`modes\` | string[] | Yes | Where the view can appear: \`"page"\`, \`"chat"\`, or both |

## Component Props

The default export receives a \`ViewProps\` object:

| Prop | Type | Description |
|------|------|-------------|
| \`cards\` | ViewCard[] | All cards matching the dependency globs |
| \`navigate\` | (path: string) => void | Navigate within the box (e.g., \`navigate("chat")\`) |
| \`boxSlug\` | string | The current box slug |
| \`params\` | Record<string, string> | Query parameters from the URL (e.g., \`params.path\`) |

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
}
\`\`\`

Child elements have the same shape: \`{ tagName, attrs, text?, children? }\`.

## Dependencies

The \`dependencies\` array controls two things:
1. **Which cards are loaded** — only \`.card\` files matching these globs are passed as \`cards\`
2. **When to re-render** — the view refreshes automatically when matching files change

Use glob patterns relative to the box root:
- \`"box/inbox/**/*.card"\` — all cards in the inbox
- \`"store/archive/**/*.record.card"\` — all record cards in the archive
- \`"store/todos/**/*.card"\` — all todo cards
- \`"box/**/*.card"\` — everything in box/

## Query Parameters (path and others)

Views receive query parameters via \`params\`. The most important parameter is \`path\`, which scopes what the view shows.

**Always provide a \`path\` parameter** when linking to or embedding a view:
- \`path=/\` — the entire box
- \`path=store/archive/bills/\` — a specific directory
- \`path=store/archive/bills/Electric.record.card\` — a specific card

The view component reads it from \`params.path\`:

\`\`\`tsx
export default function MyView({ cards, params }) {
  const viewPath = params.path || "/";
  // Filter cards by path, or use it as context
  const filtered = viewPath === "/"
    ? cards
    : cards.filter(c => c.path.startsWith(viewPath));
  // ...
}
\`\`\`

You can also use custom query parameters for filtering, sorting, etc. — they all arrive in \`params\`.

## React

React is provided automatically. **Do NOT import React** — the build system handles it. If you do write \`import React from "react"\`, it will still work (the compiler intercepts it), but it's unnecessary.

You can use all standard React hooks: \`useState\`, \`useEffect\`, \`useMemo\`, \`useCallback\`, \`useRef\`, etc.

## Embedding in Chat

To embed a view in a chat message, use markdown link syntax with a \`view:\` URL:

\`\`\`
[View: Ledger Overview](view:ledger-overview?path=/)
\`\`\`

The slug is the filename without \`.tsx\`. Always include \`?path=\` — use \`path=/\` for the whole box. The view renders inline in the chat with a link to the full page.

Only views with \`"chat"\` in their \`modes\` array should be embedded in chat. Chat mode renders with a maximum height and scroll.

## Examples

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
\`\`\`

## Styling

Views render inside the app's existing layout. You can use:
- Inline styles (as shown in examples)
- Standard HTML/CSS
- The app uses Tailwind CSS classes — these are available if you know them, but inline styles are fine

## Error Handling

If your view has a syntax error, the browser shows the compile error instead of crashing. If your view throws at runtime, an error boundary catches it and shows the error with a retry button.
`;
}
