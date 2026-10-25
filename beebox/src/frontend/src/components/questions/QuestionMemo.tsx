import { useCallback } from "react";
import type { NavigateHint, ViewTarget } from "../../lib/view-url";
import { useWorkspace } from "../chat/workspace/WorkspaceProvider/provider";
import { Markdown } from "../Markdown/body";

/**
 * A question card's memo, rendered as the card body is: the agent writes it
 * with markup such as `{% quote %}`. Links open in the workspace; outside one
 * (the theme studio) they do nothing.
 */
export function QuestionMemo({ memo, path }: { memo: string; path: string }) {
  const workspace = useWorkspace();
  const onNavigate = useCallback((target: ViewTarget, hint?: NavigateHint) => { workspace?.open(target, hint); }, [workspace]);
  return <Markdown onNavigate={onNavigate} basePath={path}>{memo}</Markdown>;
}
