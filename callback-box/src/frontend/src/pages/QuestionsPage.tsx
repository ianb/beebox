/**
 * Questions page — page chrome around the QuestionsList surface, which
 * also serves `view: questions` cards.
 */

import { Column } from "../components/ui/Column";
import { Stack } from "../components/ui/Stack";
import { Text } from "../components/ui/Text";
import { QuestionsList } from "../components/questions/QuestionsList";

export function QuestionsPage() {
  return (
    <Column overflow="auto" className="h-full">
      <Stack gap="lg" className="max-w-2xl mx-auto py-8 px-4">
        <Text as="h1" size="2xl" weight="bold">Questions</Text>
        <QuestionsList />
      </Stack>
    </Column>
  );
}
