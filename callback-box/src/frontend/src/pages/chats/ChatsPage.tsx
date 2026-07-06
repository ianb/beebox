/**
 * Chats page — page chrome around the ChatsPicker surface, which also
 * serves `view: chat-picker` cards. Sibling to the "Recent" nav entry
 * (which jumps to the most-active chat directly); use this page to pick
 * a chat by landmark or start a new one in a specific binding.
 */

import { Column } from "../../components/ui/Column";
import { Stack } from "../../components/ui/Stack";
import { Text } from "../../components/ui/Text";
import { ChatsPicker } from "../../components/session-pickers/ChatsPicker";

export function ChatsPage() {
  return (
    <Column overflow="auto" className="h-full">
      <Stack gap="lg" className="max-w-6xl mx-auto py-8 px-4 w-full">
        <Text as="h1" size="2xl" weight="bold">Chats</Text>
        <ChatsPicker />
      </Stack>
    </Column>
  );
}
