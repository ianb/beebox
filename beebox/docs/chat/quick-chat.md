# Quick chat

Quick chat takes one thought and puts it in a conversation. The person types
or says the thought on the box screen. The server stores it, asks Jev where it
belongs, and posts it there when the answer is clear. When the answer is not
clear, the thought waits on the box screen until the person picks a
conversation or discards it.

## The box screen

The box screen is the screen for the box as a whole. It is not a chat, and it
does not load one. From top to bottom it shows:

- **Needs you**: thoughts that are stored and not sent. Absent when empty.
- Sent rows. The web page shows thoughts sent in the last 24 hours, at most
  five. The iOS app shows the thoughts sent from it since it started.
- **Pick up where you left off**: recent chats. The first one is the primary
  action.
- **In this box**: Dashboard, Browse, History, Storage summary, then the
  shortcut links from the box's `nav.card`.
- **Boxes**: the other boxes. Absent when there is only one box.
- The input, pinned at the bottom, with the line "New thought. The box picks
  the conversation."

On the web the box screen is `/<box>/box`, behind the normal worktree or
server prefix. The route renders without the conversation shell, so it runs
no chat queries. `/<box>/quick-chat` redirects to it. The box selector's
**New thought** link opens it. In the app bar, the box row of the landmark
menu opens it with a full page load.

On iOS the box screen is native. A cold launch shows it, and no web view is
created until the person opens a chat or a box-wide page. On return to the
foreground the app shows the box screen when it was in the background for 30
minutes or more, or when the web content process ended in the background.
Otherwise it stays where it was. A notification tap opens its target. When
chat messages from the chat composer are still waiting for delivery, the app
opens on the web chat so that it can deliver them. The web landmark menu's box
row returns to the native box screen; the web view stays loaded behind it.
The **Boxes** section appears with two or more paired boxes.

The new-thought draft is separate from the chat composer's draft on both
platforms. Text in one never replaces text in the other.

## Submit, choose, discard

**Send** gives the thought a new UUID and calls `quickChat.submit`. The UUID
identifies the thought from the first attempt. A repeat call with the same
UUID returns the stored record and does not route again. A repeat with
different text is refused.

The web page keeps the unsent thought and its UUID in browser storage until
the server answers. After a reload it submits again with the same UUID. The
iOS app keeps the thought in an outbox on the phone. It retries with backoff
while the app is in the foreground, and once on each launch. The row reads
"Waiting to send". After 7 days without an answer it reads "Not sent", with
Retry and Discard. An outbox entry has no server record, so nothing was
delivered.

`quickChat.choose` fixes the person's chosen destination and delivers. It
accepts only a choice that the record offers. `quickChat.discard` ends a
thought that was not sent. A sent thought cannot be discarded.
`quickChat.home` returns what the box screen shows: the open thoughts, the
recently sent thoughts, the recent chats, and the shortcuts.

All four procedures take a paired device's token. The phone sends
`channel: "ios-native"`. The wire shapes are in
[mobile contract §5.11](../mobile-contract.md).

## States and reasons

A thought is in one of four states:

- `needs-choice`: stored, with no destination. The row shows the reason, up
  to four choices, and Discard.
- `sending`: the destination is fixed and delivery is not acknowledged. After
  a failed attempt the row shows "Not delivered", the error, Retry, and
  Discard.
- `sent`: delivery is acknowledged. The row shows "Sent to <chat>" or
  "Queued in <chat>" when the chat was busy, and **Open chat**. A new chat on
  an engine that assigns its own session id has no id yet; its row offers
  **All chats**.
- `discarded`: the person removed it. This state is final.

A `needs-choice` thought has one of three reasons:

- `uncertain`: "Not sure where this goes". Jev did not place it clearly. The
  choices are the three most likely destinations, plus a new general chat
  when it is not among them.
- `routing-unavailable`: "Could not sort this". Routing could not run. The
  choices are the three most recent chats and a new general chat.
- `destination-gone`: "That chat is gone". The chosen chat was deleted before
  delivery. The choices leave out that chat.

**Open chat** only navigates. It does not copy the thought into the chat's
composer. A send acknowledgment does not mean that the agent finished its
work.

## Post or ask

Jev returns a probability for each candidate. The application then applies
two rules.

First, it selects a destination. If a new conversation wins by no more than
0.1 over the strongest existing chat, the existing chat is selected. Exact
ties favor existing chats.

Second, it decides to post or ask. It adds the probabilities of every
candidate in the same place as the selected one: the same landmark, or the
box root when neither has a landmark. When that sum is 0.9 or more, the
thought is posted. Otherwise it waits as `uncertain`. A split between a
landmark's chat and a new chat in that landmark is therefore not doubt.

Both numbers are provisional. They come from a small set of samples and are
not calibrated. A confident post to the wrong chat cannot be undone; the row
names the chat, and the person corrects it there.

## When routing is unavailable

These failures store the thought as `routing-unavailable`:

- The box has no `openrouter` key granted.
- The Jev request fails, times out, or returns a malformed answer.
- The rules and destination details exceed the request budget below.
- The candidate list cannot be built: the rubric is invalid, a rubric target
  is missing, a landmark cannot be read, or there are more than 255
  candidates. In this case the only choice is a new general chat.

The box screen shows only the reason. The server log has the specific error,
for example an invalid `_config/chat-routing.yaml`.

When the chat runtime is not running, or delivery fails for another reason,
the thought stays `sending` with the error. Retry delivers it.

## Delivery

Delivery goes through the same sender as `POST /api/chat/send`. The record's
UUID is the chat message id. The send route's duplicate check therefore posts
one message per thought, even when delivery is repeated. The thought arrives
in the chat as typed text from the person who sent it.

The record names its destination before delivery starts. If the server stops
after delivery and before it records `sent`, the next attempt is answered as a
duplicate. The record then becomes `sent` with the stored destination. Whether
the message was queued is not recovered.

Duplicate protection lasts 7 days. The server refuses to deliver a `sending`
thought more than 6 days after its first attempt. The row then reads "This may
already be in <chat>. Open the chat to check." and offers Open chat and
Discard only.

A busy chat queues the message in memory. A server restart loses that queue,
as it does for every queued chat send.

## Destinations

Eligible candidates are recent resumable web chats (the existing seven-day
window), the latest chat at each eligible landmark even when older, and old
chats explicitly retained by the rubric. New conversations in each landmark
and a new general conversation are separate choices. Background landmarks
need an explicit rubric entry to participate. Telegram, document triage,
jobs, and non-chat destinations are not candidates. Jev favors a plausible
recent or general chat, with a new general chat at the root as the fallback
when no other destination fits.

Recent messages are the primary routing evidence. Total history entries and
the latest available message timestamp are supporting context. A longer
conversation does not outweigh a better match in recent messages. History
entries are not a count of user turns. Choices for an existing chat show its
landmark next to the chat title.

## Maintain the rubric

Box agents have [packaged rubric instructions](../box/quick-chat.md).

The optional box file `_config/chat-routing.yaml` contains authored rules.
The boxholder or a box agent can edit it. It is plain YAML, not a card and
not an automatically rewritten summary. An absent file means no additional
rules; the live catalog still supplies conversation facts.

```yaml
destinations:
  - target: /_content/Garden/Garden.landmark.card
    when: Vegetable growing, planting decisions, and garden layout
    avoid: Scheduling general household repairs
    examples:
      - Let's use raised beds after all
  - target: /_content/chat/web/Planning.chat.card
    when: Follow-ups to the long-term garden redesign
    keepEligible: true
```

Use the actual landmark or active web-chat card path. Box-absolute refs start
with `/`; relative refs resolve from `_config/chat-routing.yaml`. Query and
fragment refs are not supported. Landmark rules apply to its new-chat choice
and its eligible existing chats. A chat rule applies to that specific chat;
`keepEligible: true` keeps it eligible beyond the recency window, provided it
still exists and is resumable. A missing or invalid target stops routing:
each thought then waits as `routing-unavailable` until the rubric is fixed.

## Requirements, data, and limits

Sorting requires an `openrouter` key granted to the box in the machine
secret store. It is an optional service, not a configured chat model. Without
a key, every thought waits for the person to choose. Do not put provider keys
in the rubric.

The request goes to OpenRouter's Decisions API and is pinned to TypeSafe Jev.
It includes the thought, candidate identities and activity, rubric rules, and
recent conversation text. See [security report §3](../security-report.md#3-data-egress).
The current bounds are:

- Thought: 12,000 characters; text only, with no attachments.
- Candidate context: a recent history window covering at least two real user
  messages when available, user/assistant text only, capped at 2,000
  characters per chat and 32,000 across chats. Labeled excerpts prioritize
  the latest user message and recent reply before older text. Serialized
  candidates stay within 60,000 characters; labels are capped at 300
  characters. The candidate budget also shrinks to fit the complete
  serialized message, choices, and instructions.
- Rubric: at most 100 entries; `when` at most 2,000 characters, `avoid` at
  most 1,000, and at most five examples of 500 characters each.
- Judgment: at most 255 choices, 80,000 serialized request characters, and a
  30-second request timeout. Overflow stores the thought as
  `routing-unavailable`; it does not drop eligible destinations.

Records are private files with mode 0600. A record in `needs-choice` or
`sending` is at `.beebox/quick-chat/open/<UUID>.json`. A `sent` or
`discarded` record is at `.beebox/quick-chat/<UUID>.json`. Each record keeps
the text, candidate snapshots, probabilities, selection, and state. The box
screen never shows the probabilities; they are kept for calibrating the post
floor. Every operation on a thought takes the lock
`.beebox/quick-chat/<UUID>.json.lock`. There is no automatic expiry. These
records support live evaluation and are not repository test fixtures.

## Implementation owners

- Selection and the post-or-ask policy: `src/core/chat/routing/policy.ts`.
- Records, states, and views: `src/core/chat/routing/quick-chat-record.ts`
  and `quick-chat-store.ts`.
- Catalog, judgment, submit, choose, and discard:
  `src/core/chat/routing/quick-chat-submit/`.
- Box screen data: `src/core/chat/routing/quick-chat-home.ts`.
- Provider contract: `src/services/jev.ts`.
- Authenticated procedures: `src/webapp/trpc/routers/quick-chat.ts`.
- Shared sender: `src/webapp/routes/chat/user-message-sender.ts`.
- Web box screen: `src/frontend/src/pages/box-screen/` and
  `src/frontend/src/components/box-screen/`.
- Native box screen, outbox, and launch rule, in the monorepo:
  `ios-app/BeeBox/Views/BoxScreenView.swift`,
  `ios-app/BeeBox/Storage/QuickChatOutbox.swift`, and
  `ios-app/BeeBox/Models/RootSurface.swift`.
