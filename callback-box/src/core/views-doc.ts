/**
 * Generate the views reference documentation for agents.
 *
 * Called by generate-docs.ts to produce docs/generated/views.md.
 */

import { dependenciesAndParamsSection } from "./views-doc-files.js";
import { examplesSection } from "./views-doc-examples.js";

const introSection = `# Views: Agent-Generated React Components

Views are \`.tsx\` files in the \`views/\` directory at the box root. They get compiled server-side and rendered in the browser. **A view is always attached to a card type** — it exports \`rendersCardTypes\` and becomes that type's interface on card pages, in chat embeds, and in the companion pane. There is no card-less "standalone" view.

## When to Create a View

Create a view to give a **card type** a richer interface than the default markdown rendering — an interactive layout, a chart, a structured summary of the card's data, editable controls. A dashboard over many cards is itself a card type (e.g. a \`.dashboard.card\` whose view reads a collection).

Don't create a view for:
- Simple one-off answers (just reply in chat)
- Static text that doesn't change (use a card or document)
- Something that requires server-side processing (use a job instead)`;

const fileFormatSection = `## File Format

Each view is a \`.tsx\` file with named exports for metadata and a default export for the component:

\`\`\`tsx
export const name = "Ledger Overview";
export const description = "Interface for an ledger-overview card";
export const dependencies = ["store/**/*.ledger-overview.card", "store/archive/**/*.record.card"];
export const modes = ["page", "chat"];
export const rendersCardTypes = ["ledger-overview"];

export default function EstateOverview({ cards, navigate, boxSlug, params }) {
  // params.path is the card being displayed; dependencies must cover it.
  const card = cards.find(c => c.path === params.path);
  const records = cards.filter(c => c.type === "record");

  return (
    <div>
      <h2>{card?.frontmatter?.title ?? "Ledger Overview"}</h2>
      <p>{records.length} records</p>
      <ul>
        {records.map(card => (
          <li key={card.path}>
            <strong>{card.frontmatter?.title || card.path}</strong>
            {card.frontmatter?.status && <span> — {String(card.frontmatter.status)}</span>}
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

The built-in renderers (Card, Source) stay available through the
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
| \`reportActivity\` | (kind, detail?) => void | When open in the chat companion pane, tell the agent the user touched this card. Writes auto-report \`"modified"\`; call \`reportActivity("explored", detail)\` when the user changes the view's *parameters* (filters, ranges, a selected tab) without changing data. The optional \`detail\` is a short free-text string surfaced to the agent as the \`<card-activity>\` element's text (e.g. the query the user typed and its top result) — it overwrites any prior detail for the same kind, so calling it on every keystroke is fine. A no-op for inline/page renders, so always safe to call. |

### ViewCard Structure

Cards are YAML frontmatter + a markdown body. Each card in the \`cards\` array has:

\`\`\`typescript
{
  path: string;        // Box-relative path (e.g., "store/archive/Foo.record.card")
  type: string;        // Card type, from the filename Foo.<type>.card (e.g., "record", "memo")
  frontmatter?: Record<string, unknown>;  // Parsed YAML frontmatter (body and type excluded)
  body?: string;       // Markdown body
  attachments?: ViewFile[];       // Deep listing of the card's attach scope
}
\`\`\`

Read a card's fields from \`frontmatter\` (e.g. \`card.frontmatter?.title\`, the
status from \`card.frontmatter?.status\`) and its prose from \`body\`. \`type\` is
the card type — filter a mixed \`cards\` array with
\`cards.filter(c => c.type === "memo")\`. \`frontmatter\` values are whatever the
card's schema declares (strings, numbers, arrays, nested objects), so they are
typed \`unknown\` — narrow before use.

\`attachments\` is how a view discovers what lives next to a card — every file
in the card's attach scope, recursively, as \`{path, size, mtimeMs}\` with
box-relative paths (e.g.
\`store/playground/Playground.attach/sessions/history.jsonl\`). Content is
never inlined — attachments can be huge or binary — fetch it with
\`readFile(path)\` or point an \`<img>\`/\`<audio>\` at \`fileUrl(path)\`.`;

const showingFilesSection = `## Showing Files in Chat

To show a file to the user, reference it by its plain box path — like a normal
markdown link or image:

\`\`\`
[Meeting Notes](/store/notes/meeting.md)
[Recipe](/store/archive/Pasta.recipe.card)
\`\`\`

Clicking a link opens the file in the companion pane. The system picks the
viewer by file type:
- \`.md\` files render as formatted Markdown
- \`.card\` files use the card viewer (a card-type-specific renderer if one is registered, otherwise the markdown card view)
- Directories show a listing of subdirectories and cards
- Other files show as raw text

To force a specific viewer, add \`?view=\` with the renderer name (e.g. \`Source\` for the raw card text, \`Card\` for the markdown view):
\`\`\`
[Raw source](/store/archive/Pasta.recipe.card?view=Source)
\`\`\`

Directory paths work too:
\`\`\`
[Catalog](/store/catalogs/My_Catalog)
\`\`\`

Write box-root-absolute paths (a leading \`/\`); a bare path resolves against the chat's working directory.`;

const companionViewsSection = `### Link vs Embed

There are two ways to surface a file in chat — the difference is the \`!\`:

**Link \`[label](path)\`** — clicking it opens the file in the **companion pane**, a persistent side panel beside the chat:
\`\`\`
[Meeting Notes](/store/notes/meeting.md)
\`\`\`

**Embed \`![label](path)\`** — renders the file **inline** in the chat message, scrolling with the conversation (the same syntax as an image):
\`\`\`
![Meeting Notes](/store/notes/meeting.md)
\`\`\`

The companion pane:
- Stays visible while the user continues chatting (sticky — doesn't scroll away)
- Shows side-by-side with chat on desktop, stacked on mobile
- Has a close button — the user dismisses it when done
- Updates live when underlying files change (same SSE mechanism as inline embeds)
- If the agent writes another link and the user clicks it, it replaces the current companion

Use an embed for a quick, one-off display within a turn. Use a link when the user needs to reference the file while continuing to talk — collaborative editing, storybuilding, reviewing a document, exploring data.

### How the Agent Knows a Companion View is Open

When a companion view is open, every user message includes a \`zoomed-view\` attribute naming the open file (a box path):
\`\`\`xml
<typed zoomed-view="store/notes/meeting.md">What about the furniture?</typed>
\`\`\`

This tells the agent what the user is looking at, so it can tailor its responses.

The per-turn \`<chat-app>\` snapshot also carries this as the read-only \`open-card\` attribute (box-relative path), plus a \`<card-activity kind="…">\` child element per kind of activity since the agent's last reply (\`scrolled\`/\`navigated\`/\`explored\`/\`modified\`), the element text being the optional free-text detail a view attaches via \`reportActivity(kind, detail)\` (e.g. the query typed). A view contributes the \`explored\` signal by calling \`reportActivity("explored", detail)\` when the user changes its parameters; writes contribute \`modified\` automatically. For the precise change set, the agent runs \`cb chat whats-changed --card <path>\`.

**Note:** The companion pane is a chat-only feature. The \`zoomed-view\` attribute is only meaningful in the chat frontend — other agent contexts (jobs, wakeup) don't surface it.`;

const reportingActivitySection = `## Reporting Card Activity (\`reportActivity\`)

If your view is meant to be opened beside the chat — a companion view the user pokes at while talking — report what they do, so the chat agent has context. Otherwise the agent sees only the card's *config file*, never the live state the user is looking at. For a static, read-only display there's nothing to report; skip this.

The signal reaches the agent as read-only \`<card-activity kind="…">\` child elements of the per-turn snapshot — one per kind (\`scrolled\`/\`navigated\`/\`explored\`/\`modified\`), with the element text being your optional free-text **detail** for that kind. \`reportActivity\` is a no-op outside the companion pane, so it's always safe to call.

**What's automatic vs. what you wire:**
- \`modified\` — automatic. A successful \`writeFile\`/\`appendFile\`/\`commitFile\` reports it with the path; don't call it yourself.
- \`scrolled\` — automatic (the pane watches its own scroll).
- \`explored\` — **you call it.** This is the important one: fire it when the user changes what the view is *showing* without changing data — the query they typed, a filter, a selected tab, a slider — and pass a detail describing the new state.
- \`navigated\` — automatic when a link inside the view opens another card.

**How to write the detail.** Report \`explored\` from your *primary* inputs, not every control. The detail is a short, human-legible line of what the user is now looking at — the input plus the salient result — because that exact string is what the agent reads (the \`<card-activity>\` element text). Keep it terse (a hint, not a dump): \`boat-water+road -> boats (0.568)\`, not the whole result list.

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

For a tab or filter, call it in the handler instead: \`onClick={() => { setTab(t); reportActivity("explored", "tab: " + t); }}\`. The agent can always run \`cb chat whats-changed --card <path>\` for the exact, git-grounded change set — \`<card-activity> detail\` is the cheap live hint, not the source of truth.`;

const testingSection = `## Testing a View

After writing or changing a view, render-test it from the command line instead
of only checking it in the browser:

\`\`\`
cb view test <slug>
\`\`\`

This compiles the view in Node, loads the **real cards** your \`dependencies\`
globs select (the same data the running app passes), renders the component once,
and prints the resulting HTML. On success it exits 0 and prints the output — so
you can confirm the view shows the right thing, not just that it didn't crash.
On failure it exits non-zero and prints the error with a stack mapped back to
your \`.tsx\` source lines.

- \`--path <card-path>\` sets \`params.path\` for a card-bound view (e.g. one with
  \`rendersCardTypes\`), exactly as the card page would. It does not filter
  \`cards\` — your view still receives every card the globs select and filters
  itself. If the path isn't among them, the command warns (your globs don't
  cover that card).
- \`--raw\` keeps \`<script>\`/\`<style>\` in the output (stripped by default).
- If a dependency glob selects a card that fails to validate, the command
  reports it and exits non-zero (pass \`--allow-invalid-cards\` to ignore).

**What it covers (and doesn't).** This is a *synchronous* render: it runs the
component body once. It catches the common bugs — syntax/JSX errors,
\`undefined.map()\`, bad prop access, type mistakes. It does **not** run
\`useEffect\`, post-mount state, or the async helpers (\`readFile\`, \`writeFile\`,
\`adapterFetch\`, …) — those run only in effects/handlers in the real app. Calling
an async helper directly in the render body is a bug, and the test throws to tell
you so (\`fileUrl\` is synchronous and fine to call in render). Editing a view also
triggers a quick compile-check automatically, the same way cards are validated on
save.`;

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
      testingSection,
      stylingAndErrorsSection,
    ].join("\n\n") + "\n"
  );
}
