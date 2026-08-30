/**
 * Landmarks page — page chrome around the LandmarksList surface, which
 * also serves `view: landmarks` cards. See docs/landmarks.md.
 */

import { Column } from "../../components/ui/Column";
import { Stack } from "../../components/ui/Stack";
import { Text } from "../../components/ui/Text";
import { LandmarksList } from "../../components/landmarks/LandmarksList";

export function LandmarksPage() {
  return (
    <Column overflow="auto" focusable className="h-full">
      <Stack gap="lg" className="max-w-6xl mx-auto py-8 px-4 w-full">
        <Text as="h1" size="2xl" weight="bold">Landmarks</Text>
        <LandmarksList />
      </Stack>
    </Column>
  );
}
