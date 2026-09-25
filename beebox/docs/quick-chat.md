# Quick chat

Quick chat accepts a thought, chooses a conversation with Jev, and sends it
through ordinary chat. It is an evaluation surface: the destination and
probabilities remain visible so the boxholder can judge the routing.

## Open and send

Choose **Quick chat** in the box selector. Its standalone page is
`/<box>/quick-chat` (behind the normal worktree/server prefix). On iOS, the
explicit Quick chat action opens that page in a separate sheet using the
paired box's authentication. The native chat and composer remain behind it;
closing the sheet returns to them. There is no automatic cold-start rule.

Enter text and press **Send**. Routing and chat delivery happen without a
confirmation step. The result shows **Sent to** or **Queued in**, an **Open
chat** link when the session address is available, and Jev's three strongest
choices with their probabilities. A send acknowledgment is not a claim that
the agent finished successfully.

The standalone form saves its draft and submission ID in browser storage,
separately from the normal chat draft. Use **Recover or retry send** after an
interrupted attempt. The same submission reuses its recorded destination;
it does not ask Jev again. **Another message** clears that form for new input.

The result lists the strongest alternatives as direct links. Clicking one opens
that chat with the original text staged in its composer; it does not send a
second copy automatically. This is the recovery path when the first destination
was wrong, and it does not move transcript history or undo actions the first
chat has taken.

## Destinations and preference

Eligible candidates are recent resumable web chats (the existing seven-day
window), the latest chat at each eligible landmark even when older, and old
chats explicitly retained by the rubric. New conversations in each landmark
and a new general conversation are separate choices. Background landmarks
need an explicit rubric entry to participate. Telegram, document triage,
jobs, and non-chat destinations are outside this version.

The application preserves Jev's original probabilities. If a new conversation
wins by no more than 0.1 over the strongest existing chat, it continues that
existing chat instead and says why. Exact ties favor existing chats. This
margin is provisional, not calibrated evidence that the destination is right.
Uncertainty does not stop delivery. Jev favors a plausible recent or general
chat, with a new general chat at the root as the fallback when no other
destination fits.

## Maintain the rubric

Box agents have [packaged rubric instructions](box/quick-chat.md).

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
still exists and is resumable. Missing or invalid targets stop routing visibly.

## Data and limits

Quick chat requires an `openrouter` key granted to the box in the machine
secret store. It is an optional service, not a configured chat model. A missing
key or failed judgment leaves the text available and does not send a chat
message. Do not put provider keys in the rubric.

The request goes to OpenRouter's Decisions API and is pinned to TypeSafe Jev.
It includes the captured text, candidate identities and activity, rubric rules,
and recent conversation text. See [security report §3](security-report.md#3-data-egress).
The current bounds are:

- Captured message: 12,000 characters; text only, with no attachments.
- Candidate context: the last 12 parsed transcript entries, user/assistant text
  only, capped at 2,000 characters per chat and 32,000 across chats. Serialized
  candidates stay within 60,000 characters. Shortened excerpts are disclosed in
  the result; labels are capped at 300 characters. The candidate budget also
  shrinks to fit the complete serialized message, choices, and instructions.
- Rubric: at most 100 entries; `when` at most 2,000 characters, `avoid` at most
  1,000, and at most five examples of 500 characters each.
- Judgment: at most 255 choices, 80,000 serialized request characters, and a
  30-second request timeout. Overflow fails visibly rather than dropping
  eligible destinations without notice.

Private records in `.beebox/quick-chat/<UUID>.json` retain text, candidate
snapshots, probabilities, selection, and receipts. A correction links to the
original record. Writes use mode 0600; there is no automatic expiry yet.
These records support live evaluation and are not repository test fixtures.

## Implementation owners

Catalog and selection: `src/core/chat/routing/`. Provider contract:
`src/services/jev.ts`. Authenticated prepare/receipt operations:
`src/webapp/trpc/routers/quick-chat.ts`. Standalone form:
`src/frontend/src/pages/quick-chat/QuickChatPage.tsx`. Native entry:
`ios-app/BeeBox/Views/RootView.swift` in the monorepo.
