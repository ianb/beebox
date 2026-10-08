/** Trusted renderer for a publication card: its request fields plus member review controls. */

import { Stack } from "../components/ui/Stack";
import { StatusMessage } from "../components/ui/StatusMessage";
import type { RendererEntry, RendererProps } from "../file-type-registry";
import { lazyComponent } from "../lib/lazy-component";

const MarkdownCardView = lazyComponent(() => import("../components/MarkdownCardView/view"), (m) => m.MarkdownCardView);
const PublicationApprovalView = lazyComponent(() => import("../components/publications/PublicationApprovalView"), (m) => m.PublicationApprovalView);

function PublicationCardView(props: RendererProps) {
  const pubId = props.data.frontmatter?.pubId;
  return <Stack gap="md">
    <MarkdownCardView {...props} hideEmptyBody />
    {typeof pubId === "string" && pubId.trim() !== ""
      ? <PublicationApprovalView pubId={pubId} cardPath={props.data.path} />
      : <StatusMessage>This publication card has no publication identifier.</StatusMessage>}
  </Stack>;
}

export const publicationRenderer: RendererEntry = {
  selector: { type: "publication" },
  renderer: { name: "Publication approval", Component: PublicationCardView, priority: 100 },
};
