/**
 * The landmarks surface: every `*.landmark.card` in the box, each rendered
 * as a section of resolved links. Self-sufficient (fetches its own data),
 * so it serves both the /landmarks page and `view: landmarks` cards
 * (docs/plans/interface-as-cards.md). See docs/landmarks.md.
 */

import { useParams } from "@tanstack/react-router";
import { trpc } from "../../lib/trpc";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { LandmarkSection } from "./LandmarkSection";

export function LandmarksList() {
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

  if (landmarks.length === 0) {
    return (
      <Text as="p" tone="subtle">
        No landmarks yet. Add a *.landmark.card to any directory you
        want to surface here.
      </Text>
    );
  }

  return (
    <Stack gap="md">
      {landmarks.map((lm) => (
        <LandmarkSection key={lm.path} landmark={lm} boxSlug={boxSlug ?? ""} />
      ))}
    </Stack>
  );
}
