/**
 * Worked view examples for the generated views doc. Split out of views-doc.ts
 * to keep that file under the max-lines budget.
 */

export const examplesSection = `## Examples

### Simple Card List

\`\`\`tsx
export const name = "Todo List";
export const description = "Active todos";
export const dependencies = ["store/todos/**/*.card"];
export const modes = ["page", "chat"];

export default function TodoList({ cards }) {
  const todos = cards.filter(c => c.type === "todo-list");
  return (
    <div>
      <h2>Todos</h2>
      {todos.map(card => {
        // List fields live in frontmatter (typed unknown — narrow before use).
        const items = Array.isArray(card.frontmatter?.items) ? card.frontmatter.items : [];
        return (
          <div key={card.path} style={{ marginBottom: "1rem" }}>
            <h3>{String(card.frontmatter?.title ?? card.path)}</h3>
            {items.map((item, i) => (
              <div key={i} style={{ padding: "0.25rem 0", color: item.status === "done" ? "#999" : "#000" }}>
                {item.status === "done" ? "\\u2713" : "\\u25cb"} {item.text}
              </div>
            ))}
          </div>
        );
      })}
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
    !filter || c.type.includes(filter) || c.path.includes(filter)
  );

  const byType = {};
  for (const card of filtered) {
    byType[card.type] = (byType[card.type] || 0) + 1;
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
          <li key={card.path}>{card.path} ({card.type})</li>
        ))}
      </ul>
    </div>
  );
}
\`\`\``;
