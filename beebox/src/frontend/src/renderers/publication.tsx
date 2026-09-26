/** Trusted renderer for a publication reference card and its member review controls. */

import { MarkdownCardView } from "../components/MarkdownCardView";
import { PublicationApprovalView } from "../components/publications/PublicationApprovalView";
import { Stack } from "../components/ui/Stack";
import { StatusMessage } from "../components/ui/StatusMessage";
import { registerFileType, type RendererProps } from "./index";

function PublicationCardView(props: RendererProps) {
  const pubId = props.data.frontmatter?.pubId;
  if (typeof pubId !== "string" || pubId.trim() === "") {
    return <StatusMessage>This publication card has no publication identifier.</StatusMessage>;
  }
  const frontmatter = Object.fromEntries(Object.entries(props.data.frontmatter ?? {}).filter(([key]) => key !== "pubId"));
  const notes = { ...props.data, frontmatter };
  return <Stack gap="md">
    <MarkdownCardView {...props} data={notes} />
    <PublicationApprovalView pubId={pubId} />
  </Stack>;
}

registerFileType({ type: "publication" }, {
  renderer: { name: "Publication approval", Component: PublicationCardView, priority: 100 },
});
