/**
 * Worked view examples for the generated views doc. Split out of views-doc.ts
 * to keep that file under the max-lines budget.
 */

export const examplesSection = `## Examples

### Simple Card List

\`\`\`tsx
export const name = "Recent Memos";
export const description = "Every processed memo, newest first";
export const dependencies = ["_content/**/*.memo.card"];
export const modes = ["page", "chat"];

export default function RecentMemos({ cards }) {
  const memos = cards.filter(c => c.type === "memo");
  return (
    <div>
      <h2>Memos</h2>
      {memos.map(card => (
        <div key={card.path} style={{ marginBottom: "1rem" }}>
          <h3>{String(card.frontmatter?.title ?? card.path)}</h3>
          <p>{card.body}</p>
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
export const dependencies = ["_content/inbox/**/*.card"];
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
