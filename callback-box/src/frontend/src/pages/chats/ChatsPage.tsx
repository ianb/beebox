/**
 * Chats page — picker grouping fresh chats by landmark. Sibling to the
 * "Recent" nav entry (which jumps to the most-active chat directly);
 * use this page to pick a chat by landmark or start a new one in a
 * specific binding. Only chats touched in the last 7 days appear.
 */

import { useParams } from "@tanstack/react-router";
import { trpc } from "../../lib/trpc";
import { Column } from "../../components/ui/Column";
import { Stack } from "../../components/ui/Stack";
import { Text } from "../../components/ui/Text";
import { ChatsLandmarkCard } from "./components/ChatsLandmarkCard";

export function ChatsPage() {
  const { boxSlug } = useParams({ strict: false });
  const slug = boxSlug ?? "";
  const { data, isLoading, error } = trpc.chat.byLandmark.useQuery();

  if (isLoading) {
    return <Text as="div" tone="subtle" className="p-8">Loading…</Text>;
  }
  if (error) {
    return (
      <Text as="div" tone="subtle" className="p-8">
        Failed to load chats: {error.message}
      </Text>
    );
  }

  const landmarks = data ? data.landmarks : [];

  return (
    <Column overflow="auto" className="h-full">
      <Stack gap="lg" className="max-w-4xl mx-auto py-8 px-4 w-full">
        <Text as="h1" size="2xl" weight="bold">Chats</Text>
        <Text as="p" tone="subtle">
          Fresh chats (last 7 days), grouped by landmark. Picking one resumes
          it; the &ldquo;New&rdquo; button on each landmark starts a fresh
          chat bound to that directory.
        </Text>

        {landmarks.length === 0 ? (
          <Text as="p" tone="subtle">No landmarks yet.</Text>
        ) : (
          <Stack gap="md">
            {landmarks.map((lm) => (
              <ChatsLandmarkCard key={lm.dir || "__root__"} landmark={lm} boxSlug={slug} />
            ))}
          </Stack>
        )}
      </Stack>
    </Column>
  );
}
