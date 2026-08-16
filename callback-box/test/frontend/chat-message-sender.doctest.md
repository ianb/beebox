# Chat message sender identity

Message ownership compares like identity fields. A stale entry without the
normalized email may fall back to its display name, but never compares that
name to the signed-in user's email.

```ts setup
import { isOtherChatUser } from "../../src/frontend/src/components/chat/chat-message-sender.js";
```

```ts
isOtherChatUser({ senderEmail: "ian@example.com", senderName: "Ian", currentUserEmail: "ian@example.com", currentUserName: "Ian" })
=> false

isOtherChatUser({ senderEmail: undefined, senderName: "Ian", currentUserEmail: "ian@example.com", currentUserName: "Ian" })
=> false

isOtherChatUser({ senderEmail: undefined, senderName: "Other", currentUserEmail: "ian@example.com", currentUserName: "Ian" })
=> true

isOtherChatUser({ senderEmail: "other@example.com", senderName: "Ian", currentUserEmail: "ian@example.com", currentUserName: "Ian" })
=> true

isOtherChatUser({ locallyAuthored: true, senderEmail: undefined, senderName: "Ian", currentUserEmail: "ian@example.com", currentUserName: "Ian Bicking" })
=> false

isOtherChatUser({ senderEmail: undefined, senderName: null, currentUserEmail: "ian@example.com", currentUserName: "Ian" })
=> false
```
