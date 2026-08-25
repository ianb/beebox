/**
 * AttachedComments — inline, collapsible "Comments (N)" section for a drive
 * card (gdoc / sheet). Finds the card's `comments: { ref }` frontmatter field,
 * loads the referenced `<basename>.comments.json` sidecar, and renders the
 * threaded view via `CommentsThread`.
 *
 * Container half of the data/presentation split: it owns the fetch and the
 * loading / empty / error states; `CommentsThread` is the pure renderer. Returns
 * null when the card has no comments ref, so callers can drop it in
 * unconditionally.
 */

import { useQuery } from "@tanstack/react-query";
import { apiRawFileUrl, getApiBase } from "../api";
import { resolveRelativePath } from "../lib/view-url";
import { cbSource } from "../lib/source-tag";
import { RequestError } from "../lib/errors";
import { invariant } from "@shared/invariant";
import { isRecord } from "@shared/is-record";
import { Accordion } from "./ui/Accordion";
import { Text } from "./ui/Text";
import { CommentsThread, parseComments } from "./CommentsThread";

/** Pull a `comments: { ref }` ref string out of card frontmatter, if present. */
function commentsRefOf(frontmatter: Record<string, unknown> | undefined): string | null {
  const comments = frontmatter?.comments;
  if (!isRecord(comments)) return null;
  const { ref } = comments;
  return typeof ref === "string" && ref !== "" ? ref : null;
}

export function AttachedComments({
  cardPath,
  frontmatter,
}: {
  cardPath: string;
  frontmatter: Record<string, unknown> | undefined;
}) {
  const ref = commentsRefOf(frontmatter);
  // A comments ref that escapes the box root resolves to null, which disables
  // the query exactly like an absent ref — the section doesn't render, instead
  // of loading a clamped-to-root sidecar. The broken ref is reported where refs
  // are checked (`cb validate`), not on every render here.
  const filePath = ref === null ? null : resolveRelativePath(cardPath, ref);

  const { data: comments, isLoading, error } = useQuery({
    queryKey: ["comments-sidecar", filePath],
    enabled: filePath !== null,
    queryFn: async ({ signal }) => {
      // `enabled: filePath !== null` gates the query itself; TS can't see
      // that gate narrow this closure's capture, so assert it explicitly.
      invariant(filePath !== null, "queryFn only runs when enabled, i.e. filePath !== null");
      const resp = await fetch(apiRawFileUrl(getApiBase(), filePath), { signal });
      if (!resp.ok) {
        const message = `Failed to load comments: ${resp.status} ${resp.statusText}`;
        throw new RequestError(message);
      }
      return parseComments(await resp.json());
    },
  });

  if (ref === null) return null;

  const count = comments?.length ?? 0;
  const title = isLoading ? "Comments" : `Comments (${count})`;

  return (
    <div className="mb-4" {...cbSource("card", cardPath)}>
      <Accordion title={title}>
        {isLoading ? (
          <Text as="div" size="sm" tone="subtle" italic aria-busy>Loading comments…</Text>
        ) : error !== null ? (
          <Text as="div" size="sm" tone="danger">Couldn’t load comments.</Text>
        ) : (
          <CommentsThread comments={comments ?? []} />
        )}
      </Accordion>
    </div>
  );
}
