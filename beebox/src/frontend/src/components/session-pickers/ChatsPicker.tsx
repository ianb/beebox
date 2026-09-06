/**
 * The chats-picker surface: fresh chats (last 7 days) grouped by landmark,
 * with a New-chat button per landmark, and a trailing "Other chats" card for
 * chats bound to a directory with no landmark. Self-sufficient (fetches its
 * own data). Card-embedded only now — it serves `view: chat-picker` cards
 * (docs/plans/interface-as-cards.md); the /chats page redirects to the
 * merged Landmarks surface (docs/plans/top-nav-ia.md Track D).
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
  const unassigned = data ? data.unassigned : null;
  const hasUnassigned =
    unassigned !== null && (unassigned.sessions.length > 0 || unassigned.olderSessions.length > 0 || unassigned.dead.length > 0);

  return (
    <Stack gap="lg">
      <Text as="p" tone="subtle">
        Fresh chats (last 7 days), grouped by landmark. Picking one resumes
        it; the &ldquo;New&rdquo; button on each landmark starts a fresh
        chat bound to that directory.
      </Text>

      {landmarks.length === 0 && !hasUnassigned ? (
        <Text as="p" tone="subtle">No landmarks yet.</Text>
      ) : (
        <Stack gap="md">
          {/* Keyed by the landmark card's path: `byLandmark` emits one bucket
              per card, so a directory holding two would collide on `dir`. */}
          {landmarks.map((lm) => (
            <ChatsLandmarkCard key={lm.path} landmark={lm} boxSlug={slug} />
          ))}
          {/*
           * Chats whose directory has no landmark card — the box root before
           * anyone made a root landmark, or a dir whose landmark was deleted.
           * "New" here binds to the root, the one directory that always exists.
           */}
          {hasUnassigned ? (
            <ChatsLandmarkCard
              landmark={{
                dir: "",
                label: "Other chats",
                symbol: { glyph: "💬" },
                sessions: unassigned.sessions,
                olderSessions: unassigned.olderSessions,
                dead: unassigned.dead,
              }}
              boxSlug={slug}
            />
          ) : null}
        </Stack>
      )}
    </Stack>
  );
}
