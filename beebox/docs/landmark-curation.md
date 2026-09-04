# Landmark Curation

How to decide what becomes a landmark. The decision is a user-facing one, not a tidying-up exercise. The box's file layout exists to keep things organized for the system; landmarks exist to orient that organization toward the *user's* mental model — the places they actually inhabit.

For the design and schema of the card itself, see `docs/landmarks.md` and `docs/generated/card-landmark.md`.

## What landmarks are for

A landmark is a bookmark for the user, planted at a directory they return to. The Landmarks page is short by design — the value is in being able to glance at a half-dozen tiles and recognize the shape of one's life inside the box. A long Landmarks page is a failed Landmarks page.

The user does not curate landmarks alone. Most of the time, the agent notices the recurrence pattern first, because the agent sees the same kind of question across sessions while the user only experiences the latest one.

## What makes something landmark-worthy

A landmark is the right call when the user **keeps returning** to a particular spot through the box. Look for:

- **Recurrence in conversation.** The same topic comes up across sessions: "what's on my todo list," "my recipe collection," "how's the kids' schedule looking." If you've answered a variant of the same question multiple times, the underlying place is a candidate.
- **Recurring asks that are navigational, not search.** "Show me my recipes" is navigational — it points at a place. "What did I capture last Tuesday" is search, not navigation; it doesn't argue for a landmark.
- **Active engagement.** The user isn't just storing here; they're touching it. A directory of currently-pursued recipes is landmark territory, even if it has three files. A directory of years-old archived voice memos isn't, even if it's huge.

## What doesn't make something landmark-worthy

- **Size or volume.** The biggest directory in the box probably isn't a landmark if the user never opens it. The smallest might be one if it's where they live.
- **Technical importance.** `_bookkeeping/jobs/` is critical infrastructure but isn't a landmark — the user doesn't navigate there for their own purposes.
- **Completeness instinct.** Don't add a landmark for every reasonable directory. Resist the urge to "fill out the map." If you're suggesting a landmark because something feels incomplete without one, that's the wrong reason.

## When to suggest one

When you notice the recurrence pattern — the user has asked about this place enough times that you can predict the next ask — surface the observation as a question, not as a fait accompli. Something like:

> "You've come back to your recipes a few times this week. Want me to put a landmark on that directory so it's a tap away from the home screen?"

The user decides. You do not quietly create landmarks. The point of a landmark is that the user has consciously claimed a spot in their box; an agent-conjured landmark defeats that.

## When to suggest removing one

A landmark that no longer matches the user's life is clutter. If a landmark hasn't been mentioned, opened, or referenced in a long time, and the directory behind it has gone quiet, raise the question of retiring it. Same posture as creation — the agent observes, the user decides.

## What goes inside one

Once the user agrees, the landmark itself is small editorial work:

- **Label** — the bookmark name. A tab, not a sentence. Match how the user refers to the spot in conversation, not how the directory is named on disk.
- **Symbol** — iconic, recognizable at a glance. Pick something the user would associate with the spot from their own life, not a generic placeholder.
- **Curated links** — the *handful* of cards in that directory that the user actually reaches for, in the order they'd think about them. Many landmarks won't need any internal links at all — the bookmark itself, plus the directory it points at, is the value. Don't pad the list to make it feel substantive.

The schema details and the `expand` field for templated link lists are documented in `docs/generated/card-landmark.md`.
