/**
 * Landmarks page — flat list of all `**\/*.landmark.card` in the box,
 * each rendered with its symbol + label and a tiled list of resolved
 * links. See docs/landmarks.md.
 */

import { useParams } from "@tanstack/react-router";
import { trpc } from "../../lib/trpc";
import { Column } from "../../components/ui/Column";
import { Stack } from "../../components/ui/Stack";
import { Text } from "../../components/ui/Text";
import { LandmarkSection } from "./components/LandmarkSection";
import { LandmarksGrid } from "./components/LandmarksGrid";

export function LandmarksPage() {
  const { boxSlug } = useParams({ strict: false });
  const { data, isLoading, error } = trpc.landmarks.list.useQuery();

  if (isLoading) {
    return <Text as="div" tone="subtle" className="p-8">Loading…</Text>;
  }
  if (error) {
    return (
      <Text as="div" tone="subtle" className="p-8">
        Failed to load landmarks: {error.message}
      </Text>
    );
  }

  const landmarks = data ? data.landmarks : [];

  return (
    <Column overflow="auto" className="h-full">
      <Stack gap="lg" className="max-w-6xl mx-auto py-8 px-4 w-full">
        <Text as="h1" size="2xl" weight="bold">Landmarks</Text>

        {landmarks.length === 0 ? (
          <Text as="p" tone="subtle">
            No landmarks yet. Add a *.landmark.card to any directory you
            want to surface here.
          </Text>
        ) : (
          <LandmarksGrid>
            {landmarks.map((lm) => (
              <LandmarkSection key={lm.path} landmark={lm} boxSlug={boxSlug ?? ""} />
            ))}
          </LandmarksGrid>
        )}
      </Stack>
    </Column>
  );
}
