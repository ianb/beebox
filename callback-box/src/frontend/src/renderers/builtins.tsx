/**
 * Built-in file renderers: raw source view for frontmatter cards.
 */

import { Pre } from "../components/ui/Pre";
import { Text } from "../components/ui/Text";
import type { RendererProps } from "./index";
import { registerFileRenderer } from "./index";

/** Raw source view for frontmatter cards. */
function SourceRenderer({ data }: RendererProps) {
  if (!data.raw) {
    return <Text as="div" tone="subtle" className="p-4">No content</Text>;
  }
  return (
    <div className="p-4">
      <Pre boxed>{data.raw}</Pre>
    </div>
  );
}

registerFileRenderer(
  (_path, data) => data.kind === "frontmatter",
  { name: "Source", Component: SourceRenderer, priority: 10 },
);
