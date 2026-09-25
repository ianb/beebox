---
read-when: Maintaining Quick chat destination rules or keeping an older conversation eligible for routing.
---
# Quick chat routing rules

Quick chat chooses among landmark chats and recent resumable web chats, then
sends the captured text before showing the result. New chat in a landmark and
continuing an existing conversation are different actions. Prefer continuing
an existing conversation when the topic fits; creating a new session does not
mean creating a new landmark.

Maintain authored destination rules in the box file
`_config/chat-routing.yaml`. It is plain YAML, not a card. Preserve the
boxholder's `when`, `avoid`, and `examples` text. Do not replace those rules
with generated titles, recency, or conversation summaries: the router reads
current session metadata and bounded transcript context separately each time.

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

Use actual landmark or active web-chat card paths; the examples are not
universal paths. Prefer box-absolute refs starting with `/`. Relative refs
resolve from the rubric file; query and fragment refs are invalid. A landmark
rule applies to that place's eligible existing chats and its new-chat option.
A chat rule applies only to that chat. Set `keepEligible: true` on the chat
entry to keep an older existing conversation eligible beyond the recent-chat
window; its card and resumable session must still exist. Missing targets stop
routing visibly. Background landmarks need explicit rubric entries.

Do not put credentials in this file. Quick chat uses the box-granted
OpenRouter key and sends captured text, candidate facts, rules, and bounded
conversation text through OpenRouter to TypeSafe Jev. It handles text only.
The result links open the selected chat with the original text staged in its
composer. Opening another destination does not send a second copy, undo agent
actions, or move the original transcript.
