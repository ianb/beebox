# Writing Style Guide

How to write the architecture docs. This captures patterns and corrections from the writing process — read it before writing or editing sections.

## Structure

Each section follows the same pattern:

1. **Vignettes first.** Open with stories from the Lund-Vega family that show the system in action. These aren't illustrations of technical concepts — they're the primary content. The reader should understand what the system does and feels like before any architecture is explained.

2. **Architecture second.** After the stories, a section that explicitly names the architectural components and connects them to what the reader just saw. Use bold terms and refer back to the vignettes. The architecture should feel like it *explains* the stories, not like the stories were decorating the architecture.

3. **Cross-link.** Bold terms in the architecture section should correspond to things visible in the stories. "This is how the schedule conflict got sorted out overnight" — tie the abstract to the concrete.

4. **Separate narrative from architecture visually.** When a section mixes vignette and technical explanation, wrap the architecture paragraphs in `<div style="background: rgba(147, 197, 253, 0.3); border-radius: 8px; padding: 16px; margin: 16px 0;">...</div>`. These render with a light transparent blue background to visually distinguish "here's what happened" from "here's how the system makes that work." Dedicated architecture sections (with their own `##` heading) don't need this — the heading already signals the shift.

## Tone

**This is not a Pixar movie.** Avoid cliché sentimentality — the grandmother's kitchen in Oaxaca with the wood-fired stove and the smell of chocolate, the warm light through the doorway. The uncle who drove a bus and knew every street by the old businesses. That's movie-trailer emotional shorthand — charming details designed to tug at you. It's the dad joke of sentimentalism. Keep things specific and ordinary. Rosa is recording a conversation, not narrating a flashback scene. She might be talking about a specific visit, or an argument someone had, or just ordinary stuff that happened. Not everything needs to be charming.

**No AIisms.** This is the single biggest pitfall. Avoid:
- "This isn't just X — it's Y" (the rhetorical escalation pattern)
- "That's not a display preference — it's asking the box to do something new" (over-dramatizing a simple point)
- Stock phrases: "Great question!", "Let me unpack that", "That's a real tension"
- Breathless enthusiasm about features
- Punchline sentences that try to be profound

**Be plain and specific.** "The box parsed James's schedule and noticed a conflict with Tuesday's swim drop-off" is better than "The system intelligently detected a scheduling collision." Specificity is warmth. Say what actually happened, with the actual people and actual things involved.

**Don't describe pictures.** When a section opens near an illustration, the text shouldn't narrate what's in the image. The image and text should complement each other, not duplicate. If the image shows the kitchen on Saturday morning, the text should tell you what's happening, not that Sofia's hair is wet and Mateo is squinting.

## The family

Characters are introduced through how they use the system, not through biographical summaries. The reader meets Diana because she's checking the group chat at the counter. They meet James because he sends schedule photos. Each person's introduction *is* a feature vignette.

**Everyone participates.** Don't make anyone a complete opt-out. Mateo is less interested in household coordination, but he uses the box for his own things — D&D, music, school. Rosa has private uses alongside group participation. Sofia is both a user and an unwitting data source.

**Rosa's private uses.** Not everything goes in the group. Rosa records conversation topics for her next call with her sister — that's private to her. The box holds private things alongside shared things.

**Keep details grounded.** Rosa records a list of things to bring up when she calls her sister. That's more real than "recording messages for her sister." Sofia asks whatever she's curious about this week — don't lock it to one example like "suspension bridges" that feels generic.

## The system

**Web chat is the primary surface.** Telegram (and potentially SMS, other platforms) are additional channels into the same conversation. Don't lead with Telegram as the main thing.

**Group-oriented, but not exclusively.** The group conversation is the primary shared surface, but one-on-one chat with the box is also available. Some things naturally belong in the group (schedule changes, grocery list, family logistics). Others are clearly one-on-one (personal goals, private questions, Rosa's call list for her sister). Use whichever fits the example. The group is still the default and the thing that makes the system distinctive — but don't force everything through it.

**Notifications come from the family's inputs.** When the box reaches out (reminders, alerts, schedule changes), what it's surfacing comes from things the family put in. It's connecting dots, not generating from nothing. This is worth noting explicitly.

**Capture pages are for bulk input.** Walking through the kitchen narrating the pantry. Recording stories one after another. Photographing a posted schedule. They're for getting a lot of stuff in, not for sending a single message.

**Some things are aspirational.** Mark features that don't exist yet but are one step away. Don't present them as working, but don't wall them off either. The reader should understand what's real and what's next.

## Structured comments

HTML comments (`<!-- ... -->`) above sections, examples, and vignettes carry structured metadata that connects the writing to its motivations. These are not visible to readers but are used for analysis, testing, and quality control.

Comment fields (include whichever are relevant):

- **example**: Tag this as a concrete example. Brief description of what it demonstrates.
- **how-to-do-it**: Could someone actually do this with the system today? What would they need to set up? What are the holes?
- **prerequisites**: What concepts does the reader need to understand to follow this section? List anything a general audience wouldn't know. (Used to analyze reading flows and identify gaps.)
- **spirit**: Which values from spirit.md does this section express or depend on? (e.g., "inspectable history", "messy is expected", "not deficiency thinking")
- **status**: `working`, `aspirational`, or `design-exploration`. Is this real today or one step away?

Example:

```markdown
<!-- example: Rosa's voice memo → transcription → story pipeline
     how-to-do-it: transcription is built-in via inbox processing; story cleanup would require a custom procedure with specific instructions; word-level sidecar exists for whisper transcriptions
     prerequisites: cards, procedures, sidecar files
     spirit: best stuff comes from the people, see the gears
     status: transcription=working, story pipeline=aspirational -->
```

These comments will eventually be machine-readable for analysis (e.g., "show me all examples and their status" or "what prerequisites does section 3 assume?"). For now, just include them as you write.

## Glossary candidates

When you use a term that an average reader might not know, note it as a glossary candidate in a comment:

```markdown
<!-- glossary: card, schema, sidecar file, procedure -->
```

Collect these per section. We'll eventually build a glossary from them and use the per-section lists to analyze whether terms are introduced before they're used.

## What goes wrong (patterns to avoid)

- **Opening paragraphs that describe the illustration.** Write the story, not a caption.
- **Locking characters to one example.** Sofia doesn't only care about suspension bridges. Rosa doesn't only tell stories. Keep examples varied or general enough to suggest range.
- **Making the architecture section a disconnected list.** Each architecture point should reference something from the stories. "This is how..." or "When Diana..." — keep it connected.
- **Over-explaining simple things.** If the box needs to create a weekly task, just say that. Don't editorialize about how significant it is.
- **Treating Telegram as the primary interface.** It's one channel. The web chat is primary.
