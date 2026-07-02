/**
 * View card renderer — renders the named builtin view a `view` card points
 * at (docs/plans/interface-as-cards.md, "instrument cards"). The component
 * registry here must cover every name in src/shared/named-views.ts; an
 * unknown name (schema/registry drift, or a card edited past validation)
 * renders an explicit error naming the card and the valid set — never a
 * blank surface.
 */

import { NAMED_VIEW_NAMES } from "@shared/named-views";
import { isRecord } from "../lib/is-record";
import { LandmarksList } from "../components/landmarks/LandmarksList";
import { ChatsPicker } from "../components/chats/ChatsPicker";
import { HistoryViewCard } from "../components/history/HistoryViewCard";
import { Card } from "../components/ui/Card";
import { Text } from "../components/ui/Text";
import { registerCardRenderer, type RendererProps } from "./index";

/** Frontmatter `params` (already schema-validated by cb validate; each view re-parses defensively). */
const VIEW_COMPONENTS: Record<string, React.ComponentType<{ params?: Record<string, unknown> }>> = {
  landmarks: LandmarksList,
  "chat-picker": ChatsPicker,
  history: HistoryViewCard,
};

function readParams(frontmatter: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const params = frontmatter?.["params"];
  return isRecord(params) ? params : undefined;
}

function ViewCard({ data }: RendererProps) {
  const name = typeof data.frontmatter?.["view"] === "string" ? data.frontmatter["view"] : "";
  const Component = VIEW_COMPONENTS[name];
  if (!Component) {
    return (
      <Card padding="md" border="subtle" muted>
        <Text as="div" size="sm" weight="medium" tone="emphasis">
          {data.path} names an unknown view {name === "" ? "(none)" : `"${name}"`}
        </Text>
        <Text as="div" size="sm" tone="muted">
          Valid views: {NAMED_VIEW_NAMES.join(", ")}
        </Text>
      </Card>
    );
  }
  return <Component params={readParams(data.frontmatter)} />;
}

registerCardRenderer("view", {
  name: "View",
  Component: ViewCard,
  priority: 100,
});
