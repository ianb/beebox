/**
 * The chats-picker surface: fresh chats (last 7 days) grouped by landmark,
 * with a New-chat button per landmark. Self-sufficient (fetches its own
 * data), so it serves both the /chats page and `view: chat-picker` cards
 * (docs/plans/interface-as-cards.md).
 */

import { useParams } from "@tanstack/react-router";
import { trpc } from "../../lib/trpc";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { ChatsLandmarkCard } from "./ChatsLandmarkCard";

export function ChatsPicker() {
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
    <Stack gap="lg">
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
  );
}
